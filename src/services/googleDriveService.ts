/**
 * Google Drive API v3 + Google Identity Services (GIS), tutto client-side (nessun backend).
 *
 * Scope: drive.file → l'app vede SOLO i file che ha creato o che l'utente le ha aperto esplicitamente (Picker).
 * Per questo il secondo membro della casa, per collegarsi a un file creato da un altro account, deve
 * selezionarlo con il Google Picker (che concede all'app l'accesso a quel singolo file): inserire solo l'ID
 * funziona se il file è già stato aperto/creato dall'app con quell'account, altrimenti Drive risponde 404.
 */
import type { AppDatabase } from '../types'
import { parseDb } from './dbSchema'

export const DB_FILE_NAME = 'meal-duo-db.json'
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const GAPI_SRC = 'https://apis.google.com/js/api.js'
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

export class DriveError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface DriveMeta {
  id: string
  name: string
  /** headRevisionId se disponibile, altrimenti `version`: cambia a ogni scrittura */
  revision: string
  modifiedTime?: string
  canEdit: boolean
}

export interface DriveConfig {
  clientId: string
  apiKey?: string
  appId?: string
}

/* ---------------- caricamento script ---------------- */

const loading = new Map<string, Promise<void>>()
function loadScript(src: string): Promise<void> {
  const cached = loading.get(src)
  if (cached) return cached
  const p = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => { loading.delete(src); reject(new Error('Impossibile caricare gli script Google (sei offline?).')) }
    document.head.appendChild(s)
  })
  loading.set(src, p)
  return p
}

/* ---------------- autenticazione (GIS token client) ---------------- */

interface Token { accessToken: string; expiresAt: number }
let token: Token | null = null
let tokenClient: google.accounts.oauth2.TokenClient | null = null
let tokenClientId = ''
let pending: { resolve: (t: Token) => void; reject: (e: Error) => void } | null = null

const TOKEN_KEY = 'mealduo:token'

function loadStoredToken(): Token | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY)
    if (!raw) return null
    const t = JSON.parse(raw) as Token
    return t.expiresAt > Date.now() + 30_000 ? t : null
  } catch { return null }
}

export function hasValidToken(): boolean {
  token ??= loadStoredToken()
  return !!token && token.expiresAt > Date.now() + 30_000
}

async function ensureTokenClient(clientId: string): Promise<google.accounts.oauth2.TokenClient> {
  await loadScript(GIS_SRC)
  if (tokenClient && tokenClientId === clientId) return tokenClient
  tokenClientId = clientId
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: DRIVE_SCOPE,
    callback: (resp) => {
      if (resp.error || !resp.access_token) {
        pending?.reject(new Error(resp.error_description || resp.error || 'Accesso Google annullato'))
      } else {
        const t: Token = { accessToken: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000 }
        token = t
        try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t)) } catch { /* ignore */ }
        pending?.resolve(t)
      }
      pending = null
    },
    error_callback: (err) => {
      pending?.reject(new Error(err.type === 'popup_closed' ? 'Finestra di accesso chiusa' : `Accesso Google non riuscito (${err.type})`))
      pending = null
    },
  })
  return tokenClient
}

/**
 * Ottiene un access token. `interactive: true` va chiamato da un gesto dell'utente (click) per evitare
 * il blocco dei popup; senza interazione prova il rinnovo silenzioso (prompt: '').
 */
export async function getAccessToken(clientId: string, interactive: boolean): Promise<string> {
  token ??= loadStoredToken()
  if (token && token.expiresAt > Date.now() + 30_000) return token.accessToken
  if (!clientId) throw new DriveError(0, 'Imposta prima il Google Client ID (Famiglia → Sincronizzazione).')
  const client = await ensureTokenClient(clientId)
  const t = await new Promise<Token>((resolve, reject) => {
    pending = { resolve, reject }
    client.requestAccessToken({ prompt: interactive ? (hasEverConsented() ? '' : 'consent') : '' })
  })
  markConsented()
  return t.accessToken
}

const CONSENT_KEY = 'mealduo:consented'
const hasEverConsented = (): boolean => { try { return localStorage.getItem(CONSENT_KEY) === '1' } catch { return false } }
const markConsented = (): void => { try { localStorage.setItem(CONSENT_KEY, '1') } catch { /* ignore */ } }

export function signOut(): void {
  if (token) { try { google.accounts.oauth2.revoke(token.accessToken, () => {}) } catch { /* ignore */ } }
  token = null
  try { sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(CONSENT_KEY) } catch { /* ignore */ }
}

/* ---------------- chiamate REST ---------------- */

async function request(cfg: DriveConfig, url: string, init: RequestInit = {}, interactive = false): Promise<Response> {
  const run = async (): Promise<Response> => {
    const t = await getAccessToken(cfg.clientId, interactive)
    return fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${t}` } })
  }
  let res = await run()
  if (res.status === 401) {
    token = null
    try { sessionStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
    res = await run()
  }
  if (!res.ok) {
    let msg = res.statusText
    try { msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg } catch { /* ignore */ }
    throw new DriveError(res.status, friendlyError(res.status, msg))
  }
  return res
}

function friendlyError(status: number, msg: string): string {
  if (status === 404) return 'File non trovato o non accessibile all\'app. Se il file è di un altro account, selezionalo con "Scegli da Drive" (Picker).'
  if (status === 403) return `Permesso negato da Drive: ${msg}`
  if (status === 401) return 'Sessione Google scaduta: accedi di nuovo.'
  return `Errore Drive (${status}): ${msg}`
}

const META_FIELDS = 'id,name,version,headRevisionId,modifiedTime,capabilities/canEdit,trashed'

interface RawMeta { id: string; name: string; version?: string; headRevisionId?: string; modifiedTime?: string; capabilities?: { canEdit?: boolean }; trashed?: boolean }
const toMeta = (r: RawMeta): DriveMeta => ({
  id: r.id,
  name: r.name,
  revision: r.headRevisionId ?? r.version ?? r.modifiedTime ?? '',
  modifiedTime: r.modifiedTime,
  canEdit: r.capabilities?.canEdit !== false,
})

export async function getMeta(cfg: DriveConfig, fileId: string): Promise<DriveMeta> {
  const res = await request(cfg, `${API}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(META_FIELDS)}&supportsAllDrives=true`)
  const raw = (await res.json()) as RawMeta
  if (raw.trashed) throw new DriveError(404, 'Il file del database è nel cestino di Drive.')
  return toMeta(raw)
}

export async function findDbFiles(cfg: DriveConfig): Promise<DriveMeta[]> {
  const q = encodeURIComponent(`name='${DB_FILE_NAME}' and trashed=false`)
  const res = await request(cfg, `${API}/files?q=${q}&fields=${encodeURIComponent(`files(${META_FIELDS})`)}&orderBy=modifiedTime desc&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true`)
  return (((await res.json()) as { files?: RawMeta[] }).files ?? []).map(toMeta)
}

export async function downloadDb(cfg: DriveConfig, fileId: string): Promise<AppDatabase> {
  const res = await request(cfg, `${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`)
  const text = await res.text()
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new DriveError(422, 'Il file su Drive non contiene JSON valido.') }
  return parseDb(raw)
}

export async function createDbFile(cfg: DriveConfig, db: AppDatabase, interactive = true): Promise<DriveMeta> {
  const boundary = `mealduo${Math.random().toString(36).slice(2)}`
  const metadata = { name: DB_FILE_NAME, mimeType: 'application/json' }
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(db)}\r\n--${boundary}--`
  const res = await request(cfg, `${UPLOAD}/files?uploadType=multipart&fields=${encodeURIComponent(META_FIELDS)}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  }, interactive)
  return toMeta((await res.json()) as RawMeta)
}

export async function uploadDb(cfg: DriveConfig, fileId: string, db: AppDatabase): Promise<DriveMeta> {
  const res = await request(cfg, `${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=${encodeURIComponent(META_FIELDS)}&supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(db),
  })
  return toMeta((await res.json()) as RawMeta)
}

/** Condivide il file con un familiare (ruolo "writer"); Drive invia l'email di invito. */
export async function shareWithEmail(cfg: DriveConfig, fileId: string, email: string): Promise<void> {
  await request(cfg, `${API}/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=true&supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email.trim() }),
  })
}

export async function getAccountEmail(cfg: DriveConfig): Promise<string | undefined> {
  const res = await request(cfg, `${API}/about?fields=user(emailAddress,displayName)`)
  const u = ((await res.json()) as { user?: { emailAddress?: string; displayName?: string } }).user
  return u?.emailAddress ?? u?.displayName
}

/* ---------------- Google Picker (concede all'app l'accesso al singolo file) ---------------- */

export const pickerAvailable = (cfg: DriveConfig): boolean => !!(cfg.apiKey && cfg.appId)

export async function pickDbFile(cfg: DriveConfig): Promise<string | null> {
  if (!pickerAvailable(cfg)) throw new Error('Per il Picker servono API Key e App ID (numero del progetto Google Cloud): vedi README.')
  const accessToken = await getAccessToken(cfg.clientId, true)
  await loadScript(GAPI_SRC)
  await new Promise<void>((resolve, reject) => {
    gapi.load('picker', { callback: () => resolve(), onerror: () => reject(new Error('Impossibile caricare il Picker.')) })
  })
  return new Promise<string | null>((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
    view.setMimeTypes('application/json')
    view.setIncludeFolders(false)
    const shared = new google.picker.DocsView(google.picker.ViewId.DOCS)
    shared.setMimeTypes('application/json')
    shared.setOwnedByMe(false)
    new google.picker.PickerBuilder()
      .setDeveloperKey(cfg.apiKey!)
      .setAppId(cfg.appId!)
      .setOAuthToken(accessToken)
      .addView(view)
      .addView(shared)
      .setTitle('Scegli meal-duo-db.json')
      .setLocale('it')
      .setCallback((data: google.picker.ResponseObject) => {
        if (data.action === google.picker.Action.PICKED) resolve(data.docs?.[0]?.id ?? null)
        else if (data.action === google.picker.Action.CANCEL) resolve(null)
      })
      .build()
      .setVisible(true)
  })
}

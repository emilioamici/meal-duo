import { t } from '../lib/text'
/** Wrapper minimale della Drive REST API v3 (tutte le funzioni ricevono il token d'accesso). */

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
export const DB_FILE_NAME = 'meal-duo-db.json'
/** Marcatore pubblico (`properties`) per riconoscere i database Meal Duo anche se il file viene rinominato. */
export const DB_PROPERTY = { key: 'mealduo', value: 'db' }

export class DriveError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export interface DriveFile {
  id: string
  name: string
  /** cambia a ogni scrittura: serve al controllo di concorrenza */
  version: string
  modifiedTime: string
  ownedByMe?: boolean
  owners?: Array<{ emailAddress?: string; displayName?: string }>
  parents?: string[]
  properties?: Record<string, string>
  capabilities?: { canEdit?: boolean; canShare?: boolean }
}

const FIELDS = 'id,name,version,modifiedTime,ownedByMe,owners(emailAddress,displayName),parents,properties,capabilities(canEdit,canShare)'
const enc = encodeURIComponent

async function call(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })
  if (!r.ok) {
    let msg = r.statusText
    try { msg = ((await r.json()) as { error?: { message?: string } }).error?.message || msg } catch { /* corpo non JSON */ }
    throw new DriveError(r.status, msg)
  }
  return r
}

export async function about(token: string): Promise<{ email: string; name: string }> {
  const j = (await (await call(token, `${API}/about?fields=user(displayName,emailAddress)`)).json()) as { user: { displayName: string; emailAddress: string } }
  return { email: j.user.emailAddress, name: j.user.displayName }
}

export const isDatabaseFile = (f: DriveFile): boolean => f.properties?.[DB_PROPERTY.key] === DB_PROPERTY.value || /^meal-?duo-db/i.test(f.name)

/**
 * File accessibili all'app: propri e condivisi. Con lo scope `drive.file` Drive restituisce solo quelli creati dall'app
 * o già aperti con il Picker; con lo scope completo anche quelli condivisi da altri.
 */
export async function listCandidates(token: string): Promise<DriveFile[]> {
  const query = enc(`(properties has { key='${DB_PROPERTY.key}' and value='${DB_PROPERTY.value}' } or name contains 'meal-duo') and trashed = false and mimeType != 'application/vnd.google-apps.folder'`)
  const url = `${API}/files?q=${query}&orderBy=modifiedTime desc&pageSize=30&fields=files(${FIELDS})&supportsAllDrives=true&includeItemsFromAllDrives=true`
  return ((await (await call(token, url)).json()) as { files: DriveFile[] }).files
}

export async function getMeta(token: string, id: string): Promise<DriveFile> {
  return (await call(token, `${API}/files/${enc(id)}?fields=${FIELDS}&supportsAllDrives=true`)).json()
}

export async function download(token: string, id: string): Promise<unknown> {
  return (await call(token, `${API}/files/${enc(id)}?alt=media&supportsAllDrives=true`)).json()
}

/** Crea il database (nella cartella scelta, null = radice). `writersCanShare: false`: solo il proprietario può invitare. */
export async function createFile(token: string, content: string, name: string, folderId: string | null): Promise<DriveFile> {
  const b = 'mealduo' + Math.random().toString(36).slice(2)
  const metadata = {
    name, mimeType: 'application/json', writersCanShare: false,
    properties: { [DB_PROPERTY.key]: DB_PROPERTY.value },
    ...(folderId && folderId !== 'root' ? { parents: [folderId] } : {}),
  }
  const body =
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n--${b}--`
  const r = await call(token, `${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}&supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${b}` },
    body,
  })
  return r.json()
}

export async function updateFile(token: string, id: string, content: string): Promise<DriveFile> {
  const r = await call(token, `${UPLOAD}/files/${enc(id)}?uploadType=media&fields=${FIELDS}&supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: content,
  })
  return r.json()
}

/** Invita un account Google con permesso di modifica (Drive manda l'email di invito). */
export async function shareFile(token: string, id: string, email: string, message: string): Promise<void> {
  await call(token, `${API}/files/${enc(id)}/permissions?sendNotificationEmail=true&emailMessage=${enc(message)}&supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
  })
}

/** Revoca l'accesso a un account (false se non aveva permessi). */
export async function removeShare(token: string, id: string, email: string): Promise<boolean> {
  const j = (await (await call(token, `${API}/files/${enc(id)}/permissions?fields=permissions(id,emailAddress,role,type)&supportsAllDrives=true`)).json()) as {
    permissions: Array<{ id: string; emailAddress?: string; role: string }>
  }
  const hit = j.permissions.filter((p) => p.emailAddress?.toLowerCase() === email.toLowerCase() && p.role !== 'owner')
  for (const p of hit) await call(token, `${API}/files/${enc(id)}/permissions/${enc(p.id)}?supportsAllDrives=true`, { method: 'DELETE' })
  return hit.length > 0
}

/** Accetta un ID o un link Drive (…/d/<id>/… oppure ?id=<id>). */
export function parseFileId(input: string): string | null {
  const s = input.trim()
  const m = s.match(/\/d\/([\w-]{20,})/) || s.match(/[?&]id=([\w-]{20,})/) || s.match(/^([\w-]{20,})$/)
  return m ? m[1] : null
}

export const friendly = (e: DriveError): string =>
  e.status === 404 ? t('File non trovato o non accessibile all\'app.') : e.status === 403 ? t('Permesso negato da Drive: {m}', { m: e.message }) : t('Errore Google Drive ({status}): {message}', { status: e.status, message: e.message })

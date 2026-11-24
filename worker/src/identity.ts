import { HttpError, type Env } from './index'

/**
 * Chi sta chiamando? Il server non si fida del client: ogni richiesta porta un token Google che si verifica con `tokeninfo`
 * (emesso per questa app e con il solo permesso `drive.file`) e da cui si ricava l'email con `drive/v3/about`.
 * Il token non si salva mai: nella cache in memoria (al massimo 60 secondi, mai oltre la scadenza del token) ci sono solo
 * l'impronta del token e l'email. I permessi sul file NON si mettono in cache: si ricontrollano a ogni chiamata.
 */

export const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file'
const DRIVE_FULL = 'https://www.googleapis.com/auth/drive'
const CACHE_MS = 60_000
const CACHE_MAX = 500

const google = (env: Env) => env.GOOGLE_API || 'https://www.googleapis.com'
const oauth = (env: Env) => env.GOOGLE_OAUTH_API || 'https://oauth2.googleapis.com'

/** Client ID accettati: quello del Worker più gli eventuali `ALLOWED_CLIENT_IDS`. Vuoto = nessun controllo possibile (solo notifiche). */
export const clientIds = (env: Env): string[] =>
  [env.GOOGLE_CLIENT_ID, ...(env.ALLOWED_CLIENT_IDS ?? '').split(',')].map((s) => (s ?? '').trim()).filter(Boolean)

const cache = new Map<string, { email: string; exp: number }>()
/** Solo per i test. */
export const clearAuthCache = (): void => cache.clear()

async function fingerprint(token: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function bearerOf(req: Request): string {
  const token = /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '')?.[1]
  if (!token) throw new HttpError(401, 'Accesso mancante')
  return token
}

export async function verifyToken(env: Env, token: string): Promise<{ email: string }> {
  const fp = await fingerprint(token)
  const hit = cache.get(fp)
  if (hit && hit.exp > Date.now()) return { email: hit.email }

  let ttl = CACHE_MS
  if (clientIds(env).length) {
    const r = await fetch(`${oauth(env)}/tokeninfo?access_token=${encodeURIComponent(token)}`)
    if (r.status === 400 || r.status === 401) throw new HttpError(401, 'Sessione Google non valida o scaduta')
    if (!r.ok) throw new HttpError(502, 'Google non risponde')
    const j = (await r.json()) as { aud?: string; azp?: string; scope?: string; expires_in?: string | number }
    const ids = clientIds(env)
    if (!ids.includes(j.aud ?? '') && !ids.includes(j.azp ?? '')) throw new HttpError(401, 'Token non emesso per questa app')
    const scopes = String(j.scope ?? '').split(/\s+/)
    if (!scopes.includes(DRIVE_FILE) || scopes.includes(DRIVE_FULL)) throw new HttpError(401, 'Permesso Google non valido: riconnettiti per concedere solo l’accesso ai file di Meal Duo.')
    const left = Number(j.expires_in)
    if (Number.isFinite(left)) ttl = Math.max(0, Math.min(CACHE_MS, left * 1000 - 5000))
  }
  const about = await fetch(`${google(env)}/drive/v3/about?fields=user(emailAddress)`, { headers: { Authorization: `Bearer ${token}` } })
  if (about.status === 401) throw new HttpError(401, 'Sessione Google non valida o scaduta')
  if (!about.ok) throw new HttpError(502, 'Google non risponde')
  const email = ((await about.json()) as { user?: { emailAddress?: string } }).user?.emailAddress
  if (!email) throw new HttpError(401, 'Account Google non riconosciuto')
  const out = email.toLowerCase()
  if (ttl > 0) {
    if (cache.size >= CACHE_MAX) cache.clear()
    cache.set(fp, { email: out, exp: Date.now() + ttl })
  }
  return { email: out }
}

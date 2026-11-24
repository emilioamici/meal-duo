import { HttpError, readJson, validFileId, authenticate, type Env } from './index'
import { bearerOf, verifyToken } from './identity'
import { authConfigured, seal, unseal } from './auth'

/**
 * Ponte verso il database su Drive per chi non ha (ancora) accesso diretto al file.
 *
 * Con il permesso ristretto `drive.file` un file condiviso da altri si può aprire solo dopo il Selettore di Google,
 * che su iPhone spesso non funziona (cookie). Qui il file viene letto e scritto dal Worker con l'accesso di chi ha creato
 * la famiglia: ma solo per gli account che compaiono tra le condivisioni del file su Drive, che restano l'unica fonte
 * dell'autorizzazione (invitare e togliere un membro = condividere e togliere la condivisione su Drive).
 * Il contenuto del database passa dal Worker ma non viene mai salvato né registrato.
 */

const MAX_FAMILIES_PER_USER = 10
const BIG_BODY = 6_000_000
const hkey = (fileId: string) => `house:${fileId}`
const ikey = (email: string) => `inv:${email.toLowerCase()}`
const google = (env: Env) => env.GOOGLE_API || 'https://www.googleapis.com'
const oauth = (env: Env) => env.GOOGLE_OAUTH_API || 'https://oauth2.googleapis.com'
const FIELDS = 'id,name,version,modifiedTime'

interface House { rt: string; email: string }
export interface Perm { emailAddress?: string; role: string }

/** Ruoli Drive che possono modificare il file (reader e commenter possono solo leggere). */
const WRITE_ROLES = new Set(['owner', 'organizer', 'fileOrganizer', 'writer'])

export const bridgeEnabled = (env: Env): boolean => authConfigured(env)

async function loadHouse(env: Env, fileId: string): Promise<House | null> {
  const v = await env.SUBS.get(hkey(fileId))
  return v ? unseal<House>(env, v) : null
}

/** Token d'accesso di chi ha registrato la famiglia. Se Google ha revocato il suo accesso il collegamento si cancella. */
async function houseToken(env: Env, fileId: string, house: House): Promise<string> {
  const r = await fetch(`${oauth(env)}/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: house.rt, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, grant_type: 'refresh_token' }),
  })
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string }
    if (err.error === 'invalid_grant') { await env.SUBS.delete(hkey(fileId)); throw new HttpError(410, 'La famiglia non è più collegata: chi l’ha creata deve riaprire l’app.') }
    throw new HttpError(502, 'Google non risponde')
  }
  const t = (await r.json()) as { access_token?: string }
  if (!t.access_token) throw new HttpError(502, 'Risposta di Google non valida')
  return t.access_token
}

export async function permissionsOf(env: Env, token: string, fileId: string): Promise<Perm[]> {
  const r = await fetch(`${google(env)}/drive/v3/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(emailAddress,role)&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) throw new HttpError(502, 'Google non risponde')
  return ((await r.json()) as { permissions?: Perm[] }).permissions ?? []
}

/** Per `authenticate` (che ha già verificato il token): chi non ha accesso diretto al file passa se la famiglia è registrata e il file è condiviso con lui. */
export async function bridgeAccess(env: Env, email: string, fileId: string): Promise<boolean> {
  if (!bridgeEnabled(env)) return false
  const house = await loadHouse(env, fileId)
  if (!house) return false
  const perms = await permissionsOf(env, await houseToken(env, fileId, house), fileId)
  return perms.some((p) => p.emailAddress?.toLowerCase() === email.toLowerCase())
}

async function whoami(env: Env, req: Request): Promise<{ token: string; email: string }> {
  const token = bearerOf(req)
  return { token, email: (await verifyToken(env, token)).email }
}

async function readBigJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.text()
    if (text.length > BIG_BODY) throw new HttpError(413, 'Database troppo grande')
    const o = JSON.parse(text)
    if (!o || typeof o !== 'object') throw new Error()
    return o as Record<string, unknown>
  } catch (e) { throw e instanceof HttpError ? e : new HttpError(400, 'Richiesta non valida') }
}

/**
 * POST /house/register {fileId, session}: chi ha accesso diretto al file (di norma chi ha creato la famiglia) affida al Worker
 * il collegamento al database, usando la sua sessione di accesso persistente. Aggiorna anche l'elenco delle famiglie di ogni invitato.
 */
export async function houseRegister(env: Env, req: Request): Promise<unknown> {
  if (!bridgeEnabled(env)) throw new HttpError(503, 'Il ponte non è configurato sul server')
  const body = await readJson(req)
  if (!validFileId(body.fileId)) throw new HttpError(400, 'File non valido')
  if (typeof body.session !== 'string' || !/^[\w-]{30,80}$/.test(body.session)) throw new HttpError(400, 'Sessione non valida')
  const email = await authenticate(env, req, body.fileId, true) // accesso diretto al file, non via ponte
  const stored = await env.SUBS.get(`sess:${body.session}`)
  const sess = stored ? await unseal<{ rt: string; email: string }>(env, stored) : null
  if (!sess || sess.email.toLowerCase() !== email) throw new HttpError(403, 'La sessione non corrisponde all’account')
  const house: House = { rt: sess.rt, email }
  const perms = await permissionsOf(env, await houseToken(env, body.fileId, house), body.fileId)
  // il ponte scrive con l'accesso di chi registra: lo può fare solo il proprietario del file (non un invitato con ruolo di modifica).
  // Si verifica PRIMA di salvare, così un invitato non può sovrascrivere la registrazione del proprietario.
  if (perms.find((p) => p.emailAddress?.toLowerCase() === email)?.role !== 'owner') throw new HttpError(403, 'Solo chi ha creato la famiglia può collegarla al ponte.')
  const existing = await loadHouse(env, body.fileId)
  if (!existing || existing.rt !== house.rt) await env.SUBS.put(hkey(body.fileId), await seal(env, house))
  for (const p of perms) {
    if (!p.emailAddress) continue
    const k = ikey(p.emailAddress)
    let list: string[] = []
    try { list = JSON.parse((await env.SUBS.get(k)) ?? '[]') as string[] } catch { list = [] }
    if (!list.includes(body.fileId)) await env.SUBS.put(k, JSON.stringify([body.fileId, ...list].slice(0, MAX_FAMILIES_PER_USER)))
  }
  return { ok: true, members: perms.length }
}

/** Tetto di account con cui una famiglia può essere condivisa (proprietario compreso). */
export const MAX_MEMBERS = 20

/**
 * POST /house/join {fileId}: il CODICE è l'ID del file. Chi lo presenta (con un token valido per questa app) viene aggiunto dal Worker,
 * con l'accesso di chi ha creato la famiglia, tra gli scrittori del file, senza email di notifica.
 *
 * Compromesso di sicurezza: chi conosce il codice può entrare, e il codice non si può cambiare. Per togliere qualcuno si toglie il
 * suo account dalla condivisione su Drive, ma con il codice potrebbe rientrare: se il codice è trapelato, va creata una nuova famiglia.
 * Chi ha già un permesso sul file (anche di sola lettura) non viene toccato: l'unione non promuove nessuno e ripeterla non duplica nulla.
 */
export async function houseJoin(env: Env, req: Request): Promise<unknown> {
  if (!bridgeEnabled(env)) throw new HttpError(503, 'Il ponte non è configurato sul server')
  const body = await readJson(req)
  if (!validFileId(body.fileId)) throw new HttpError(400, 'File non valido')
  const { email } = await whoami(env, req) // l'email viene solo dal token verificato, mai dal corpo della richiesta
  const house = await loadHouse(env, body.fileId)
  if (!house) throw new HttpError(404, 'Codice sconosciuto, oppure chi ha creato la famiglia deve riaprire l’app con l’accesso persistente.')
  const token = await houseToken(env, body.fileId, house)
  const perms = await permissionsOf(env, token, body.fileId)
  let joined = false
  if (!perms.some((p) => p.emailAddress?.toLowerCase() === email)) {
    if (perms.filter((p) => p.emailAddress).length >= MAX_MEMBERS) throw new HttpError(403, `La famiglia è al completo (massimo ${MAX_MEMBERS} account).`)
    const r = await fetch(`${google(env)}/drive/v3/files/${encodeURIComponent(body.fileId)}/permissions?sendNotificationEmail=false&supportsAllDrives=true`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
    })
    if (!r.ok) throw new HttpError(502, 'Impossibile aggiungerti alla famiglia')
    joined = true
  }
  const k = ikey(email)
  let list: string[] = []
  try { list = JSON.parse((await env.SUBS.get(k)) ?? '[]') as string[] } catch { list = [] }
  if (!list.includes(body.fileId)) await env.SUBS.put(k, JSON.stringify([body.fileId, ...list].slice(0, MAX_FAMILIES_PER_USER)))
  return { ok: true, joined }
}

/** POST /house/mine: le famiglie a cui l'account è stato invitato (file condivisi con lui e collegati al ponte). */
export async function houseMine(env: Env, req: Request): Promise<unknown> {
  if (!bridgeEnabled(env)) return { houses: [] }
  const { email } = await whoami(env, req)
  let ids: string[] = []
  try { ids = JSON.parse((await env.SUBS.get(ikey(email))) ?? '[]') as string[] } catch { ids = [] }
  const houses: Array<{ id: string; name: string; modifiedTime: string }> = []
  const keep: string[] = []
  for (const id of ids.slice(0, MAX_FAMILIES_PER_USER)) {
    const house = await loadHouse(env, id)
    if (!house) continue
    try {
      const t = await houseToken(env, id, house)
      if (!(await permissionsOf(env, t, id)).some((p) => p.emailAddress?.toLowerCase() === email)) continue
      const m = await fetch(`${google(env)}/drive/v3/files/${encodeURIComponent(id)}?fields=${FIELDS}&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${t}` } })
      if (!m.ok) continue
      const meta = (await m.json()) as { name: string; modifiedTime: string }
      houses.push({ id, name: meta.name, modifiedTime: meta.modifiedTime }); keep.push(id)
    } catch { keep.push(id) /* errore passeggero: si riprova alla prossima */ }
  }
  if (keep.length !== ids.length) await (keep.length ? env.SUBS.put(ikey(email), JSON.stringify(keep)) : env.SUBS.delete(ikey(email)))
  return { houses }
}

async function asHouse(env: Env, req: Request, fileId: unknown, write = false): Promise<{ token: string; id: string }> {
  if (!validFileId(fileId)) throw new HttpError(400, 'File non valido')
  const email = await authenticate(env, req, fileId) // accesso diretto oppure condivisione via ponte
  const house = await loadHouse(env, fileId)
  if (!house) throw new HttpError(404, 'Famiglia non collegata al ponte: chi l’ha creata deve riaprire l’app.')
  const token = await houseToken(env, fileId, house)
  if (write) {
    // scrivere richiede il ruolo di modifica sul file: un account con sola lettura o commento non può modificare il database
    const mine = (await permissionsOf(env, token, fileId)).find((p) => p.emailAddress?.toLowerCase() === email)
    if (!mine || !WRITE_ROLES.has(mine.role)) throw new HttpError(403, 'Hai solo accesso in lettura al database: serve il ruolo Editor.')
  }
  return { token, id: fileId }
}

const getMeta = async (env: Env, token: string, id: string) => {
  const r = await fetch(`${google(env)}/drive/v3/files/${encodeURIComponent(id)}?fields=${FIELDS}&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })
  if (r.status === 404) throw new HttpError(404, 'File non trovato')
  if (!r.ok) throw new HttpError(502, 'Google non risponde')
  return (await r.json()) as { id: string; name: string; version: string; modifiedTime: string }
}

/** POST /db/read {fileId} → {meta, db} */
export async function dbRead(env: Env, req: Request): Promise<unknown> {
  const body = await readJson(req)
  const { token, id } = await asHouse(env, req, body.fileId)
  const meta = await getMeta(env, token, id) // prima i metadati: una scrittura nel frattempo farà scattare il conflitto
  const r = await fetch(`${google(env)}/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) throw new HttpError(r.status === 404 ? 404 : 502, 'Impossibile leggere il database')
  return { meta, db: await r.json() }
}

/** POST /db/write {fileId, db, expectedVersion}: scrive solo se la versione coincide (altrimenti 409 e l'app fa il merge). */
export async function dbWrite(env: Env, req: Request): Promise<unknown> {
  const body = await readBigJson(req)
  const db = body.db as { schema?: unknown; members?: unknown; foodCatalog?: unknown; plans?: unknown; shopping?: unknown } | undefined
  const obj = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v)
  if (!db || db.schema !== 'meal-duo-db' || !Array.isArray(db.members) || !Array.isArray(db.foodCatalog) || !obj(db.plans) || !obj(db.shopping)) throw new HttpError(400, 'Database non valido')
  if (typeof body.expectedVersion !== 'string') throw new HttpError(400, 'Versione mancante')
  const { token, id } = await asHouse(env, req, body.fileId, true)
  const current = await getMeta(env, token, id)
  if (current.version !== body.expectedVersion) throw new HttpError(409, 'Versione cambiata')
  const r = await fetch(`${google(env)}/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&fields=${FIELDS}&supportsAllDrives=true`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(db),
  })
  if (!r.ok) throw new HttpError(502, 'Impossibile scrivere il database')
  return { meta: await r.json() }
}

/** POST /db/meta {fileId} → {meta}: solo i metadati (versione), senza scaricare il database. */
export async function dbMeta(env: Env, req: Request): Promise<unknown> {
  const body = await readJson(req)
  const { token, id } = await asHouse(env, req, body.fileId)
  return { meta: await getMeta(env, token, id) }
}

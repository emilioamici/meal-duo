import { HttpError, authenticate, pushToUser, readJson, validFileId, type Env, type PushOutcome } from './index'
import { houseToken, loadHouse, permissionsOf } from './bridge'
import { b64u } from './webpush'

/**
 * Promemoria dei pasti: la notifica «è ora di Pranzo» arriva come push, anche con l'app chiusa.
 *  - A ORARIO: un Cron Trigger (ogni 5 minuti, vedi wrangler.example.toml) controlla le regole salvate in KV (`rem:<file>:<email>`).
 *    Il fuso orario è quello dell'utente (IANA, calcolato con `Intl` a ogni giro, quindi regge l'ora legale).
 *  - A EVENTO: un indirizzo personale (come per Apple Wallet in MoneyDuo) che un'automazione dell'iPhone (app Comandi) può chiamare quando
 *    succede qualcosa (fine di un allenamento, apertura di un'app…): `POST /reminder/in/<token>?meal=Pranzo`. Il token è l'unica credenziale,
 *    sul server resta solo il suo hash e si può rigenerare. La risposta contiene solo dei numeri, mai il piano.
 * Il contenuto dei pasti non viene copiato in KV: si legge dal database (ponte) solo quando un promemoria scatta, dopo aver riverificato
 * che l'account sia ancora tra le condivisioni del file. Se la famiglia non è collegata al ponte il testo è generico.
 */

const MAX_RULES = 12
const WINDOW_MIN = 10          // finestra di recupero: se un giro del cron salta, il promemoria parte al successivo
const TRIGGERS_PER_HOUR = 12
const MAX_DOCS_PER_TICK = 40
const OP_BUDGET = 45           // operazioni (KV + rete) per esecuzione: il piano gratuito ne ammette 50 per richiesta
const HEARTBEAT_EVERY_MS = 55 * 60_000
const DEFAULT_TEXTS = { title: 'È ora di {meal}', titleAny: 'È ora di mangiare', generic: 'Apri Meal Duo per vedere cosa mangiare.' }

const remKey = (fileId: string, email: string) => `rem:${fileId}:${email}`
const tokKey = (hash: string) => `rt:${hash}`
const userKey = (fileId: string, email: string) => `ru:${fileId}:${email}`
const firedKey = (fileId: string, email: string, ruleId: string, date: string) => `rf:${fileId}:${email}:${ruleId}:${date}`
const HEARTBEAT = 'rem-hb'

const sha = async (s: string) => b64u.enc(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))))
const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '')
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export interface Rule { id: string; meal: string; time: string; days: number[]; on: boolean }
export interface Texts { title: string; titleAny: string; generic: string }
export interface Doc { tz: string; texts: Texts; rules: Rule[]; updatedAt: number }

const validTz = (tz: unknown): string => {
  if (typeof tz !== 'string' || !tz || tz.length > 60) return 'UTC'
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return tz } catch { return 'UTC' }
}
const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** Data, giorno della settimana (lunedì = 0) e minuti dall'inizio della giornata, nel fuso dell'utente. */
export function localParts(at: Date, tz: string): { date: string; dow: number; min: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(at).map((x) => [x.type, x.value]))
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday)
  return { date: `${p.year}-${p.month}-${p.day}`, dow, min: Number(p.hour) * 60 + Number(p.minute) }
}

function parseDoc(raw: string | null): Doc | null {
  if (!raw) return null
  try {
    const d = JSON.parse(raw) as Doc
    return d && Array.isArray(d.rules) ? d : null
  } catch { return null }
}

function sanitizeRules(v: unknown): Rule[] {
  if (!Array.isArray(v)) throw new HttpError(400, 'Promemoria non validi')
  if (v.length > MAX_RULES) throw new HttpError(400, `Massimo ${MAX_RULES} promemoria`)
  return v.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>
    const time = typeof o.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.time) ? o.time : null
    const meal = clean(o.meal, 60)
    const id = typeof o.id === 'string' && /^[\w-]{2,40}$/.test(o.id) ? o.id : null
    if (!time || !meal || !id) throw new HttpError(400, 'Promemoria non valido: servono pasto, orario (HH:MM) e id')
    const days = Array.isArray(o.days) ? [...new Set(o.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : []
    return { id, meal, time, days: days.length === 7 ? [] : days, on: o.on !== false }
  })
}

async function userOf(env: Env, req: Request): Promise<{ fileId: string; email: string; body: Record<string, unknown> }> {
  const body = await readJson(req)
  if (!validFileId(body.fileId)) throw new HttpError(400, 'File non valido')
  return { fileId: body.fileId, email: await authenticate(env, req, body.fileId), body }
}

/* ---------------- gestione (con l'accesso Google dell'app) ---------------- */

/** POST /reminders/get → le regole salvate, se c'è un indirizzo per gli eventi e quando il cron ha girato l'ultima volta. */
export async function remindersGet(env: Env, req: Request): Promise<unknown> {
  const { fileId, email } = await userOf(env, req)
  const doc = parseDoc(await env.SUBS.get(remKey(fileId, email)))
  const hb = Number(await env.SUBS.get(HEARTBEAT)) || 0
  return { ok: true, doc, hasToken: !!(await env.SUBS.get(userKey(fileId, email))), lastRunAt: hb || null, house: !!(await loadHouse(env, fileId)) }
}

/** POST /reminders/save {fileId, tz, texts, rules} */
export async function remindersSave(env: Env, req: Request): Promise<unknown> {
  const { fileId, email, body } = await userOf(env, req)
  const rules = sanitizeRules(body.rules)
  const t = (body.texts ?? {}) as Record<string, unknown>
  const texts: Texts = { title: clean(t.title, 80) || DEFAULT_TEXTS.title, titleAny: clean(t.titleAny, 80) || DEFAULT_TEXTS.titleAny, generic: clean(t.generic, 120) || DEFAULT_TEXTS.generic }
  const doc: Doc = { tz: validTz(body.tz), texts, rules, updatedAt: Date.now() }
  if (!rules.length && !(await env.SUBS.get(userKey(fileId, email)))) await env.SUBS.delete(remKey(fileId, email))
  else await env.SUBS.put(remKey(fileId, email), JSON.stringify(doc))
  return { ok: true, rules: rules.length }
}

/** POST /reminders/token {fileId, rotate?}: crea l'indirizzo per gli eventi. Il token si vede una volta sola (sul server resta l'hash). */
export async function remindersToken(env: Env, req: Request): Promise<unknown> {
  const { fileId, email, body } = await userOf(env, req)
  const old = await env.SUBS.get(userKey(fileId, email))
  if (old && body.rotate !== true) return { ok: true, exists: true }
  if (old) await env.SUBS.delete(tokKey(old))
  const token = b64u.enc(crypto.getRandomValues(new Uint8Array(24)))
  const hash = await sha(token)
  await env.SUBS.put(tokKey(hash), JSON.stringify({ fileId, email }))
  await env.SUBS.put(userKey(fileId, email), hash)
  // senza regole salvate serve comunque un documento per i testi: lo crea il primo salvataggio, qui basta il token
  return { ok: true, exists: false, token }
}

async function dropToken(env: Env, fileId: string, email: string): Promise<void> {
  const old = await env.SUBS.get(userKey(fileId, email))
  if (old) await env.SUBS.delete(tokKey(old))
  await env.SUBS.delete(userKey(fileId, email))
}

/** POST /reminders/revoke {fileId, all?}: l'indirizzo smette di funzionare (con `all`, anche gli orari vengono cancellati). */
export async function remindersRevoke(env: Env, req: Request): Promise<unknown> {
  const { fileId, email, body } = await userOf(env, req)
  await dropToken(env, fileId, email)
  if (body.all === true) await env.SUBS.delete(remKey(fileId, email))
  return { ok: true }
}

/* ---------------- il messaggio ---------------- */

interface FileCtx { house: boolean; revoked: boolean; db?: any; token?: string }
type Cache = Map<string, FileCtx>
interface Ops { left: number }
const spend = (ops: Ops, n = 1): boolean => { if (ops.left < n) return false; ops.left -= n; return true }

/** Verifica con l'accesso di chi ha creato la famiglia che l'account sia ancora tra le condivisioni e legge il database (una volta per file e per giro). */
async function fileCtx(env: Env, fileId: string, email: string, cache: Cache, ops: Ops): Promise<FileCtx> {
  const hit = cache.get(fileId)
  if (hit && (hit.revoked || hit.db !== undefined || !hit.house)) return hit
  const ctx: FileCtx = { house: false, revoked: false }
  cache.set(fileId, ctx)
  try {
    if (!spend(ops, 3)) return ctx
    const house = await loadHouse(env, fileId)
    if (!house) return ctx
    ctx.house = true
    const token = await houseToken(env, fileId, house)
    const perms = await permissionsOf(env, token, fileId)
    // l'elenco delle condivisioni è del file: vale per tutti gli account di quel file
    ctx.token = token
    ;(ctx as FileCtx & { emails?: Set<string> }).emails = new Set(perms.map((p) => (p.emailAddress ?? '').toLowerCase()).filter(Boolean))
    if (!spend(ops)) return ctx
    const r = await fetch(`${env.GOOGLE_API || 'https://www.googleapis.com'}/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })
    if (r.ok) ctx.db = await r.json()
  } catch { /* famiglia non collegata o Google non risponde: testo generico */ }
  const emails = (ctx as FileCtx & { emails?: Set<string> }).emails
  if (ctx.house && emails && !emails.has(email)) ctx.revoked = true
  return ctx
}

const fmtQty = (q: number, unit: string): string => {
  const n = Math.round(q * 100) / 100
  return `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(n)}${unit === 'pz' ? ' pz' : unit}`
}

export interface Built { title: string; body: string; personalised: boolean; revoked: boolean }

/** Il testo del promemoria per `meal` (vuoto = «è ora di mangiare»). Con il piano leggibile elenca gli alimenti del pasto. */
async function buildMessage(env: Env, a: { fileId: string; email: string; doc: Doc | null; meal: string; at: Date }, cache: Cache, ops: Ops): Promise<Built> {
  const texts = a.doc?.texts ?? DEFAULT_TEXTS
  const tz = a.doc?.tz ?? 'UTC'
  const ctx = await fileCtx(env, a.fileId, a.email, cache, ops)
  const title = a.meal ? texts.title.replace('{meal}', a.meal) : texts.titleAny
  if (ctx.revoked) return { title, body: '', personalised: false, revoked: true }
  let body = texts.generic
  let personalised = false
  const db = ctx.db
  if (a.meal && db && Array.isArray(db.members) && db.plans && typeof db.plans === 'object') {
    const me = db.members.find((m: any) => !m.deleted && typeof m.email === 'string' && m.email.toLowerCase() === a.email)
    const day = me && db.plans[me.id]?.days?.[localParts(a.at, tz).dow]
    const meal = day && Array.isArray(day.meals) ? day.meals.find((m: any) => norm(String(m.name)) === norm(a.meal)) : null
    if (meal && Array.isArray(meal.items) && meal.items.length) {
      const foods = new Map<string, string>((db.foodCatalog ?? []).map((f: any) => [f.id, f.name]))
      const parts = meal.items.map((it: any) => `${foods.get(it.foodId) ?? '?'} ${fmtQty(Number(it.quantity) || 0, String(it.unit ?? ''))}`)
      body = (parts.length > 6 ? [...parts.slice(0, 6), `+${parts.length - 6}`] : parts).join(' · ').slice(0, 180)
      personalised = true
    }
  }
  return { title, body, personalised, revoked: false }
}

/** L'account non è più tra le condivisioni: si cancellano orari e indirizzo (non si invia nulla). */
async function purge(env: Env, fileId: string, email: string): Promise<void> {
  await dropToken(env, fileId, email)
  await env.SUBS.delete(remKey(fileId, email))
}

/** POST /reminders/test {fileId, meal?}: manda subito il promemoria ai dispositivi di chi chiede (con l'anteprima del testo). */
export async function remindersTest(env: Env, req: Request): Promise<unknown> {
  const { fileId, email, body } = await userOf(env, req)
  const doc = parseDoc(await env.SUBS.get(remKey(fileId, email)))
  const m = await buildMessage(env, { fileId, email, doc, meal: clean(body.meal, 60), at: new Date() }, new Map(), { left: OP_BUDGET })
  const out = await pushToUser(env, fileId, email, { title: m.title, body: m.body, tag: 'meal-reminder-test' })
  return { ok: true, ...counts(out), preview: { title: m.title, body: m.body }, personalised: m.personalised }
}

const counts = (o: PushOutcome) => (o.codes.length ? { sent: o.sent, failed: o.failed, removed: o.removed, codes: o.codes } : { sent: o.sent, failed: o.failed, removed: o.removed })

/* ---------------- a evento: l'automazione dell'iPhone ---------------- */

/** `POST|GET /reminder/in/<token>?meal=Pranzo`: il token nell'indirizzo è l'unica credenziale. La risposta contiene solo numeri. */
export async function remindersIngest(env: Env, req: Request, token: string): Promise<{ status: number; body: unknown }> {
  const hash = await sha(token)
  const rec = await env.SUBS.get(tokKey(hash))
  if (!rec) return { status: 404, body: { error: 'Token non valido o revocato' } }
  let who: { fileId: string; email: string }
  try { who = JSON.parse(rec) } catch { return { status: 404, body: { error: 'Token non valido o revocato' } } }

  // un indirizzo trapelato non deve poter inondare di notifiche
  const bucket = Math.floor(Date.now() / 3_600_000)
  const rk = `rl:${hash}:${bucket}`
  const used = Number(await env.SUBS.get(rk)) || 0
  if (used >= TRIGGERS_PER_HOUR) return { status: 429, body: { error: 'Troppe chiamate: riprova tra un po\'' } }
  await env.SUBS.put(rk, String(used + 1), { expirationTtl: 7200 })

  let meal = clean(new URL(req.url).searchParams.get('meal'), 60)
  if (!meal && req.method === 'POST') {
    try {
      const text = await req.text()
      if (text.length > 2000) return { status: 413, body: { error: 'Richiesta troppo grande' } }
      let f: Record<string, unknown> = {}
      try { const j = JSON.parse(text); if (j && typeof j === 'object') f = j as Record<string, unknown> } catch { f = Object.fromEntries(new URLSearchParams(text)) }
      meal = clean(f.meal ?? f.Meal ?? f.pasto, 60)
    } catch { return { status: 400, body: { error: 'Richiesta non valida' } } }
  }
  const doc = parseDoc(await env.SUBS.get(remKey(who.fileId, who.email)))
  const m = await buildMessage(env, { ...who, doc, meal, at: new Date() }, new Map(), { left: OP_BUDGET })
  if (m.revoked) { await purge(env, who.fileId, who.email); return { status: 404, body: { error: 'Token non valido o revocato' } } }
  const out = await pushToUser(env, who.fileId, who.email, { title: m.title, body: m.body, tag: 'meal-reminder-' + (norm(meal) || 'any') })
  return { status: 200, body: { ok: true, ...counts(out) } }
}

/* ---------------- a orario: il Cron Trigger ---------------- */

/** Un giro del cron (ogni 5 minuti): invia i promemoria arrivati all'orario. `scheduledTime` in ms (l'orologio finto dei test). */
export async function runScheduled(env: Env, scheduledTime: number): Promise<{ fired: number }> {
  const now = new Date(scheduledTime)
  const ops: Ops = { left: OP_BUDGET }
  // il battito dice all'app che il cron sta girando (senza, gli orari non partono mai: manca `crons` in wrangler.toml)
  if (spend(ops)) {
    const hb = Number(await env.SUBS.get(HEARTBEAT)) || 0
    if (scheduledTime - hb > HEARTBEAT_EVERY_MS && spend(ops)) await env.SUBS.put(HEARTBEAT, String(scheduledTime))
  }
  if (!spend(ops)) return { fired: 0 }
  const keys = (await env.SUBS.list({ prefix: 'rem:', limit: MAX_DOCS_PER_TICK })).keys
  const cache: Cache = new Map()
  let fired = 0
  for (const k of keys) {
    if (!spend(ops)) break
    const doc = parseDoc(await env.SUBS.get(k.name))
    const m = /^rem:([\w-]+):(.+)$/.exec(k.name)
    if (!doc || !m) continue
    const [, fileId, email] = m
    const tz = validTz(doc.tz)
    const local = localParts(now, tz)
    for (const rule of doc.rules) {
      if (!rule.on || (rule.days.length && !rule.days.includes(local.dow))) continue
      const since = local.min - minutesOf(rule.time)
      if (since < 0 || since >= WINDOW_MIN) continue
      const fk = firedKey(fileId, email, rule.id, local.date)
      if (!spend(ops)) return { fired }
      if (await env.SUBS.get(fk)) continue   // già inviato oggi: costa una sola lettura
      if (!spend(ops, 2)) return { fired }
      await env.SUBS.put(fk, '1', { expirationTtl: 2 * 86400 }) // prima il segno, poi l'invio: un giro ripetuto non manda due volte
      const msg = await buildMessage(env, { fileId, email, doc: { ...doc, tz }, meal: rule.meal, at: now }, cache, ops)
      if (msg.revoked) { await purge(env, fileId, email); break }
      if (!spend(ops, 2)) return { fired }
      await pushToUser(env, fileId, email, { title: msg.title, body: msg.body, tag: 'meal-reminder-' + (norm(rule.meal) || 'any') })
      fired++
    }
  }
  return { fired }
}

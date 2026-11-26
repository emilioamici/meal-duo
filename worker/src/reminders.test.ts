import { createECDH, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env, type KV } from './index'
import { seal } from './auth'
import { clearAuthCache } from './identity'
import { b64u } from './webpush'
import { localParts } from './reminders'

const require = createRequire(import.meta.url)
const ece = require('http_ece') as { decrypt: (body: Buffer, p: Record<string, unknown>) => Buffer }

const ORIGIN = 'https://utente.github.io'
const FILE = 'file_id_1234567890'
const FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
class MemKV implements KV {
  data = new Map<string, string>()
  async get(k: string) { return this.data.get(k) ?? null }
  async put(k: string, v: string) { this.data.set(k, v) }
  async delete(k: string) { this.data.delete(k) }
  async list(o: { prefix: string; limit?: number }) { return { keys: [...this.data.keys()].filter((k) => k.startsWith(o.prefix)).slice(0, o.limit ?? 1000).map((name) => ({ name })) } }
}
const EMAILS: Record<string, string> = { 'tok-anna': 'anna@example.com', 'tok-bruno': 'bruno@example.com', 'tok-house': 'anna@example.com', 'tok-eve': 'eve@example.com' }
const PLAN_DB = (days: number) => ({
  schema: 'meal-duo-db', version: 1, houseName: 'F',
  members: [{ id: 'm1', name: 'Anna', email: 'anna@example.com' }, { id: 'm2', name: 'Bruno', email: 'bruno@example.com' }],
  foodCatalog: [{ id: 'f1', name: 'Riso basmati' }, { id: 'f2', name: 'Petto di pollo' }, { id: 'f3', name: 'Olio EVO' }],
  plans: { m1: { days: Array.from({ length: days }, () => ({ meals: [{ name: 'Pranzo', items: [{ foodId: 'f1', quantity: 90, unit: 'g' }, { foodId: 'f2', quantity: 150, unit: 'g' }, { foodId: 'f3', quantity: 10, unit: 'ml' }] }, { name: 'Colazione', items: [] }] })) } },
  shopping: { checks: {}, extras: [], resetAt: 'x' },
})

let env: Env, kv: MemKV
let shared: string[]
let revokedGrant: boolean
let pushed: Array<{ url: string; body: Uint8Array }>
let devices: Record<string, ReturnType<typeof device>>

function device(host = 'fcm.googleapis.com') {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys(); const auth = randomBytes(16)
  return { ecdh, auth, sub: { endpoint: `https://${host}/send/${randomBytes(4).toString('hex')}`, keys: { p256dh: b64u.enc(ecdh.getPublicKey()), auth: b64u.enc(auth) } } }
}
const decrypt = (d: ReturnType<typeof device>, body: Uint8Array) => JSON.parse(ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: d.ecdh, authSecret: d.auth }).toString())
const last = () => decrypt(devices.anna, pushed[pushed.length - 1].body)

beforeEach(async () => {
  clearAuthCache()
  kv = new MemKV(); shared = ['anna@example.com', 'bruno@example.com']; revokedGrant = false; pushed = []; devices = {}
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair
  env = {
    SUBS: kv, ALLOWED_ORIGINS: ORIGIN, VAPID_SUBJECT: 'https://utente.github.io/meal-duo/',
    VAPID_PUBLIC_KEY: b64u.enc(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))), VAPID_PRIVATE_KEY: ((await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey).d!,
    GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec', SESSION_KEY: Buffer.from(new Uint8Array(32).fill(7)).toString('base64url'),
  } as unknown as Env
  kv.data.set(`house:${FILE}`, await seal(env, { rt: 'rt1', email: 'anna@example.com' }))
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const u = new URL(url)
    const bearer = /^Bearer (.+)$/.exec(new Headers(init?.headers).get('Authorization') ?? '')?.[1] ?? ''
    const ok = (o: unknown) => new Response(JSON.stringify(o))
    if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/token') return revokedGrant ? new Response('{"error":"invalid_grant"}', { status: 400 }) : ok({ access_token: 'tok-house' })
    if (u.pathname === '/tokeninfo') return ok({ aud: 'cid', scope: FILE_SCOPE, expires_in: '3000' })
    if (u.hostname === 'www.googleapis.com') {
      if (u.pathname.endsWith('/about')) return EMAILS[bearer] ? ok({ user: { emailAddress: EMAILS[bearer] } }) : new Response('{}', { status: 401 })
      if (u.pathname.endsWith('/permissions')) return ok({ permissions: shared.map((emailAddress, i) => ({ emailAddress, role: i ? 'writer' : 'owner' })) })
      if (u.pathname.includes('/files/')) {
        if (bearer !== 'tok-house' && bearer !== 'tok-anna') return new Response('{}', { status: 404 })
        return u.searchParams.get('alt') === 'media' ? ok(PLAN_DB(7)) : ok({ id: FILE })
      }
    }
    pushed.push({ url, body: init!.body as Uint8Array })
    return new Response(null, { status: 201 })
  }))
})
afterEach(() => vi.unstubAllGlobals())

const call = (path: string, body: unknown, token = 'tok-anna', origin: string | null = ORIGIN) =>
  worker.fetch(new Request('https://w.example' + path, { method: 'POST', headers: { ...(origin ? { Origin: origin } : {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env)
const json = async (r: Response) => (await r.json()) as any
const trigger = (token: string, query = '', method = 'POST', body?: string) =>
  worker.fetch(new Request(`https://w.example/reminder/in/${token}${query}`, { method, ...(body ? { body, headers: { 'Content-Type': 'application/json' } } : {}) }), env) // nessuna origine: arriva da Comandi
const addDevice = async (who: 'anna' | 'bruno' = 'anna') => { devices[who] = device(); await call('/subscribe', { fileId: FILE, subscription: devices[who].sub }, `tok-${who}`) }
const rule = (o: Partial<{ id: string; meal: string; time: string; days: number[]; on: boolean }> = {}) => ({ id: 'r1', meal: 'Pranzo', time: '13:00', days: [], on: true, ...o })
const save = (rules: unknown[], tz = 'Europe/Rome', token = 'tok-anna') => call('/reminders/save', { fileId: FILE, tz, texts: { title: 'È ora di {meal}', titleAny: 'È ora di mangiare', generic: 'Apri Meal Duo' }, rules }, token)
const tick = (iso: string) => worker.scheduled({ scheduledTime: Date.parse(iso) }, env)

describe('regole', () => {
  it('si salvano e si rileggono; servono l\'accesso Google e dati validi; massimo 12', async () => {
    expect((await save([rule(), rule({ id: 'r2', meal: 'Cena', time: '20:30', days: [0, 1, 2, 3, 4] })])).status).toBe(200)
    const g = await json(await call('/reminders/get', { fileId: FILE }))
    expect(g.doc.tz).toBe('Europe/Rome'); expect(g.doc.rules.map((r: any) => [r.meal, r.time, r.days])).toEqual([['Pranzo', '13:00', []], ['Cena', '20:30', [0, 1, 2, 3, 4]]])
    expect(g.hasToken).toBe(false); expect(g.house).toBe(true); expect(g.lastRunAt).toBeNull()
    expect((await save([rule({ time: '25:00' })])).status).toBe(400)
    expect((await save([rule({ meal: '' })])).status).toBe(400)
    expect((await save(Array.from({ length: 13 }, (_, i) => rule({ id: 'r' + i })))).status).toBe(400)
    expect((await call('/reminders/get', { fileId: FILE }, 'tok-eve')).status).toBe(403)   // non ha accesso al file
    expect((await call('/reminders/get', { fileId: FILE }, 'tok-alieno')).status).toBe(401)
    expect((await call('/reminders/get', { fileId: FILE }, 'tok-anna', 'https://evil.test')).status).toBe(403)
  })
  it('tutti i giorni selezionati = ogni giorno; fuso sconosciuto → UTC', async () => {
    await save([rule({ days: [0, 1, 2, 3, 4, 5, 6] })], 'Marte/Olympus')
    const g = await json(await call('/reminders/get', { fileId: FILE }))
    expect(g.doc.rules[0].days).toEqual([]); expect(g.doc.tz).toBe('UTC')
  })
})

describe('a evento: indirizzo personale per l\'automazione dell\'iPhone', () => {
  it('il token si vede una volta, sul server resta solo l\'hash; si rigenera (il vecchio smette) e si revoca', async () => {
    const a = await json(await call('/reminders/token', { fileId: FILE }))
    expect(a.exists).toBe(false); expect(a.token).toMatch(/^[\w-]{30,}$/)
    expect([...kv.data.keys(), ...kv.data.values()].some((x) => x.includes(a.token))).toBe(false)
    expect((await json(await call('/reminders/token', { fileId: FILE }))).exists).toBe(true)
    const b = await json(await call('/reminders/token', { fileId: FILE, rotate: true }))
    expect(b.token).not.toBe(a.token)
    expect((await trigger(a.token)).status).toBe(404)
    expect((await trigger(b.token)).status).toBe(200)
    await call('/reminders/revoke', { fileId: FILE })
    expect((await trigger(b.token)).status).toBe(404)
  })
  it('funziona senza origine (Comandi), con POST o GET, e il pasto è un parametro: più automazioni, un solo indirizzo', async () => {
    await addDevice(); const { token } = await json(await call('/reminders/token', { fileId: FILE }))
    const r = await trigger(token, '?meal=Pranzo')
    expect(r.status).toBe(200)
    expect(last().title).toBe('È ora di Pranzo')
    expect((await trigger(token, '?meal=Colazione', 'GET')).status).toBe(200)
    expect(last().title).toBe('È ora di Colazione')
    await trigger(token, '', 'POST', JSON.stringify({ meal: 'Cena' }))
    expect(last().title).toBe('È ora di Cena')
    await trigger(token)
    expect(last().title).toBe('È ora di mangiare')
    expect((await trigger('x'.repeat(30))).status).toBe(404)
    expect((await trigger('corto')).status).not.toBe(200) // nemmeno una rotta valida
  })
  it('la risposta contiene solo numeri: l\'indirizzo non è una credenziale di lettura del piano', async () => {
    await addDevice(); const { token } = await json(await call('/reminders/token', { fileId: FILE }))
    const r = await json(await trigger(token, '?meal=Pranzo'))
    expect(Object.keys(r).sort()).toEqual(['failed', 'ok', 'removed', 'sent'])
    expect(JSON.stringify(r)).not.toMatch(/Riso|pollo|basmati/)
    expect(r.sent).toBe(1)
  })
  it('la notifica elenca gli alimenti del pasto di chi ha l\'indirizzo (letti dal database solo in quel momento)', async () => {
    await addDevice(); const { token } = await json(await call('/reminders/token', { fileId: FILE }))
    await trigger(token, '?meal=pranzo') // maiuscole e accenti non contano
    expect(last().body).toBe('Riso basmati 90g · Petto di pollo 150g · Olio EVO 10ml')
    expect([...kv.data.values()].some((v) => v.includes('basmati'))).toBe(false)   // il piano non finisce in KV
  })
  it('famiglia non collegata al ponte: testo generico, nessun contenuto', async () => {
    kv.data.delete(`house:${FILE}`)
    await addDevice(); const { token } = await json(await call('/reminders/token', { fileId: FILE }))
    await trigger(token, '?meal=Pranzo')
    expect(last()).toMatchObject({ title: 'È ora di Pranzo', body: 'Apri Meal Duo per vedere cosa mangiare.' })
  })
  it('chi non è più tra le condivisioni: niente invio, indirizzo e orari cancellati', async () => {
    await addDevice('bruno'); await call('/subscribe', { fileId: FILE, subscription: devices.bruno.sub }, 'tok-bruno')
    const { token } = await json(await call('/reminders/token', { fileId: FILE }, 'tok-bruno'))
    await save([rule()], 'Europe/Rome', 'tok-bruno')
    shared = ['anna@example.com'] // Anna toglie Bruno da Drive
    pushed.length = 0
    expect((await trigger(token, '?meal=Pranzo')).status).toBe(404)
    expect(pushed).toHaveLength(0)
    expect([...kv.data.keys()].some((k) => k.startsWith('rem:') || k.startsWith('ru:') || k.startsWith('rt:'))).toBe(false)
  })
  it('limite di chiamate all\'ora per indirizzo', async () => {
    await addDevice(); const { token } = await json(await call('/reminders/token', { fileId: FILE }))
    const codes: number[] = []
    for (let i = 0; i < 14; i++) codes.push((await trigger(token, '?meal=Pranzo')).status)
    expect(codes.filter((c) => c === 200)).toHaveLength(12); expect(codes.slice(12)).toEqual([429, 429])
  })
  it('prova dall\'app: manda ai propri dispositivi e mostra l\'anteprima; con nessun dispositivo iscritto lo dice (sent: 0)', async () => {
    let r = await json(await call('/reminders/test', { fileId: FILE, meal: 'Pranzo' }))
    expect(r).toMatchObject({ ok: true, sent: 0 }); expect(r.preview.title).toBe('È ora di Pranzo'); expect(r.personalised).toBe(true)
    await addDevice(); r = await json(await call('/reminders/test', { fileId: FILE, meal: 'Pranzo' }))
    expect(r.sent).toBe(1)
  })
})

describe('a orario: il cron', () => {
  it('parte all\'ora giusta nel fuso dell\'utente, una volta sola, anche se il giro si ripete', async () => {
    await addDevice(); await save([rule({ time: '13:00' })])
    await tick('2026-11-25T11:50:00Z')                     // 12:50 a Roma (CET): non ancora
    expect(pushed).toHaveLength(0)
    expect((await tick('2026-11-25T12:00:00Z')).fired).toBe(1)   // 13:00 CET
    expect(last().title).toBe('È ora di Pranzo')
    expect((await tick('2026-11-25T12:00:00Z')).fired).toBe(0)   // stesso giro ripetuto
    expect((await tick('2026-11-25T12:05:00Z')).fired).toBe(0)   // giro successivo, già inviato oggi
    expect(pushed).toHaveLength(1)
    expect((await tick('2026-11-26T12:00:00Z')).fired).toBe(1)   // il giorno dopo di nuovo
  })
  it('finestra di recupero: un giro saltato non perde il promemoria, ma oltre 10 minuti non parte', async () => {
    await addDevice(); await save([rule({ time: '13:00' })])
    expect((await tick('2026-11-25T12:07:00Z')).fired).toBe(1)    // 13:07
    await save([rule({ id: 'r2', time: '14:00' })])
    expect((await tick('2026-11-25T13:10:00Z')).fired).toBe(0)    // 14:10: fuori finestra
  })
  it('giorni della settimana e promemoria spento', async () => {
    await addDevice(); await save([rule({ days: [0] }), rule({ id: 'r2', meal: 'Cena', time: '13:00', on: false })]) // solo lunedì
    expect((await tick('2026-11-25T12:00:00Z')).fired).toBe(0)    // mercoledì
    expect((await tick('2026-11-23T12:00:00Z')).fired).toBe(1)    // lunedì: solo la regola accesa
    expect(pushed).toHaveLength(1)
  })
  it('ora legale a Roma: le 8:00 locali sono le 06:00 UTC d\'estate e le 07:00 d\'inverno, anche nei giorni del cambio', async () => {
    await addDevice(); await save([rule({ time: '08:00', meal: 'Colazione' })])
    const at = async (iso: string) => (await tick(iso)).fired
    expect(await at('2026-07-15T06:00:00Z')).toBe(1)    // CEST
    expect(await at('2026-07-16T07:00:00Z')).toBe(0)    // 09:00 locale: no
    expect(await at('2026-01-15T07:00:00Z')).toBe(1)    // CET
    expect(await at('2026-03-28T07:00:00Z')).toBe(1)    // sabato prima del cambio: CET
    expect(await at('2026-03-29T06:00:00Z')).toBe(1)    // domenica del cambio (02:00→03:00): da qui CEST, 8:00 = 06:00Z
    expect(await at('2026-03-29T07:00:00Z')).toBe(0)    // 09:00 locale
    expect(await at('2026-10-24T06:00:00Z')).toBe(1)    // sabato prima del ritorno all'ora solare: CEST
    expect(await at('2026-10-25T07:00:00Z')).toBe(1)    // domenica del cambio (03:00→02:00): da qui CET, 8:00 = 07:00Z
    expect(await at('2026-10-26T06:00:00Z')).toBe(0)
  })
  it('localParts: data, giorno (lunedì = 0) e minuti nel fuso', () => {
    expect(localParts(new Date('2026-11-23T23:30:00Z'), 'Europe/Rome')).toEqual({ date: '2026-11-24', dow: 1, min: 30 })   // già martedì a Roma
    expect(localParts(new Date('2026-11-23T23:30:00Z'), 'America/Los_Angeles')).toEqual({ date: '2026-11-23', dow: 0, min: 15 * 60 + 30 })
  })
  it('il testo è personalizzato con il pasto del giorno; famiglia non collegata → generico', async () => {
    await addDevice(); await save([rule()])
    await tick('2026-11-25T12:00:00Z')
    expect(last().body).toBe('Riso basmati 90g · Petto di pollo 150g · Olio EVO 10ml')
    kv.data.delete(`house:${FILE}`); pushed.length = 0; kv.data.forEach((_, k) => k.startsWith('rf:') && kv.data.delete(k))
    await tick('2026-11-25T12:00:00Z')
    expect(last().body).toBe('Apri Meal Duo')
  })
  it('un account tolto da Drive non riceve nulla e i suoi orari e indirizzi si cancellano', async () => {
    await addDevice('bruno'); await save([rule()], 'Europe/Rome', 'tok-bruno'); await call('/reminders/token', { fileId: FILE }, 'tok-bruno')
    shared = ['anna@example.com']
    expect((await tick('2026-11-25T12:00:00Z')).fired).toBe(0)
    expect(pushed).toHaveLength(0)
    expect([...kv.data.keys()].some((k) => k.startsWith('rem:') || k.startsWith('ru:') || k.startsWith('rt:'))).toBe(false)
  })
  it('accesso del proprietario revocato su Google: testo generico (non si può rileggere il piano) e la famiglia si scollega', async () => {
    await addDevice(); await save([rule()]); revokedGrant = true
    await tick('2026-11-25T12:00:00Z')
    expect(last().body).toBe('Apri Meal Duo')
    expect(kv.data.has(`house:${FILE}`)).toBe(false)
  })
  it('il battito si scrive al massimo una volta all\'ora e l\'app lo legge', async () => {
    await save([rule()])
    const writes: string[] = []; const put = kv.put.bind(kv); kv.put = async (k: string, v: string) => { writes.push(k); return put(k, v) }
    await tick('2026-11-25T10:00:00Z'); await tick('2026-11-25T10:05:00Z'); await tick('2026-11-25T10:10:00Z')
    expect(writes.filter((k) => k === 'rem-hb')).toHaveLength(1)
    await tick('2026-11-25T11:00:00Z')
    expect(writes.filter((k) => k === 'rem-hb')).toHaveLength(2)
    expect((await json(await call('/reminders/get', { fileId: FILE }))).lastRunAt).toBe(Date.parse('2026-11-25T11:00:00Z'))
  })
  it('a ogni giro il lavoro è limitato (piano gratuito): tanti promemoria insieme non superano il budget e il resto parte al giro dopo', async () => {
    const keys: string[] = []; const get = kv.get.bind(kv); let ops = 0
    kv.get = async (k: string) => { ops++; keys.push(k); return get(k) }
    shared = ['anna@example.com', ...Array.from({ length: 30 }, (_, i) => `u${i}@example.com`)]
    for (let i = 0; i < 30; i++) kv.data.set(`rem:${FILE}:u${i}@example.com`, JSON.stringify({ tz: 'UTC', texts: { title: 'T {meal}', titleAny: 'T', generic: 'G' }, rules: [rule({ id: 'r' + i, time: '12:00' })], updatedAt: 1 }))
    const first = (await tick('2026-11-25T12:00:00Z')).fired
    expect(ops).toBeLessThanOrEqual(45)
    const second = (await tick('2026-11-25T12:05:00Z')).fired
    expect(first).toBeGreaterThan(0); expect(first).toBeLessThan(30); expect(second).toBeGreaterThan(0)
  })
})

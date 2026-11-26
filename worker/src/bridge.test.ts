import { beforeEach, describe, expect, it } from 'vitest'
import worker, { type Env } from './index'
import { seal } from './auth'
import { clearAuthCache } from './identity'

const SID = 'S'.repeat(40)
const FILE = 'FILEID12345'
const EMAILS: Record<string, string> = { 'tok-owner': 'owner@example.com', 'tok-house': 'owner@example.com', 'tok-sara': 'sara@example.com', 'tok-eve': 'eve@example.com', 'tok-alien': 'sara@example.com', 'tok-wide': 'sara@example.com', 'tok-reader': 'reader@example.com', 'tok-sara-direct': 'sara@example.com' }
const FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const DB = { schema: 'meal-duo-db', version: 1, houseName: 'Famiglia', members: [{ id: 'm1' }], foodCatalog: [], plans: {}, shopping: { checks: {}, extras: [], resetAt: 'x' } } as Record<string, unknown>

function setup(opts: { shared?: Array<[string, string]> } = {}) {
  const kv = new Map<string, string>()
  const state = { version: '5', db: structuredClone(DB), revoked: false, patches: 0, aboutCalls: 0, tokeninfoCalls: 0, created: [] as Array<Record<string, unknown>>, createQuery: '' }
  const shared = opts.shared ?? [['owner@example.com', 'owner'], ['sara@example.com', 'writer'], ['reader@example.com', 'reader']]
  const env = {
    SUBS: {
      get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v), delete: async (k: string) => void kv.delete(k),
      list: async ({ prefix }: { prefix: string }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
    },
    VAPID_PUBLIC_KEY: 'x', VAPID_PRIVATE_KEY: 'y', ALLOWED_ORIGINS: 'https://utente.github.io',
    GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec', SESSION_KEY: Buffer.from(new Uint8Array(32).fill(7)).toString('base64url'),
  } as unknown as Env
  const tokeninfo = (t: string) => new Response(JSON.stringify({ aud: t === 'tok-alien' ? 'altra-app' : 'cid', scope: t === 'tok-wide' ? 'https://www.googleapis.com/auth/drive' : FILE_SCOPE, expires_in: '3000' }))
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input))
    const bearer = /^Bearer (.+)$/.exec(new Headers(init?.headers).get('Authorization') ?? '')?.[1] ?? ''
    const ok = (o: unknown) => new Response(JSON.stringify(o))
    if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/token') return state.revoked ? new Response('{"error":"invalid_grant"}', { status: 400 }) : ok({ access_token: 'tok-house' })
    if (u.pathname === '/tokeninfo') { state.tokeninfoCalls++; return tokeninfo(u.searchParams.get('access_token')!) }
    if (u.pathname.endsWith('/about')) state.aboutCalls++
    if (u.pathname.endsWith('/about')) return EMAILS[bearer] ? ok({ user: { emailAddress: EMAILS[bearer] } }) : new Response('{}', { status: 401 })
    // con `drive.file` solo chi ha creato il file lo vede direttamente
    const direct = bearer === 'tok-owner' || bearer === 'tok-house' || bearer === 'tok-sara-direct'
    if (u.pathname.endsWith('/permissions') && init?.method === 'POST') {
      if (bearer !== 'tok-house') return new Response('{}', { status: 404 }) // solo con l'accesso del proprietario
      const b = JSON.parse(String(init.body)); state.created.push(b); state.createQuery = u.search
      shared.push([String(b.emailAddress), String(b.role)]); return ok({ id: 'perm' })
    }
    if (u.pathname.endsWith('/permissions')) return direct ? ok({ permissions: shared.map(([emailAddress, role]) => ({ emailAddress, role })) }) : new Response('{}', { status: 404 })
    if (u.pathname.startsWith('/upload/')) { if (!direct) return new Response('{}', { status: 404 }); state.patches++; state.version = String(Number(state.version) + 1); state.db = JSON.parse(String(init?.body)); return ok({ id: FILE, name: 'meal-duo-db.json', version: state.version, modifiedTime: 'now' }) }
    if (u.pathname.includes('/files/')) {
      if (!direct) return new Response('{}', { status: 404 })
      if (u.searchParams.get('alt') === 'media') return ok(state.db)
      return ok({ id: FILE, name: 'meal-duo-db.json', version: state.version, modifiedTime: 'now' })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  const call = async (path: string, token: string, body: unknown) => {
    const res = await worker.fetch(new Request(`https://w.example${path}`, { method: 'POST', headers: { Origin: 'https://utente.github.io', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env)
    return { status: res.status, json: (await res.json()) as any }
  }
  const seed = async () => void kv.set(`sess:${SID}`, await seal(env, { rt: 'rt1', email: 'owner@example.com', touched: Date.now() }))
  return { env, kv, state, call, seed, shared }
}

beforeEach(() => clearAuthCache())

describe('ponte verso il database', () => {
  it('/health dichiara il ponte solo se l\'accesso persistente è configurato', async () => {
    const { env } = setup()
    expect(((await (await worker.fetch(new Request('https://w.example/health'), env)).json()) as any).bridge).toBe(true)
    delete (env as any).SESSION_KEY
    expect(((await (await worker.fetch(new Request('https://w.example/health'), env)).json()) as any).bridge).toBe(false)
  })

  it('la registrazione richiede accesso diretto al file e la sessione dello stesso account; il token resta cifrato', async () => {
    const t = setup(); await t.seed()
    expect((await t.call('/house/register', 'tok-sara', { fileId: FILE, session: SID })).status).toBe(403) // niente accesso diretto (drive.file)
    const other = setup(); other.kv.set(`sess:${SID}`, await seal(other.env, { rt: 'rt1', email: 'qualcun.altro@example.com', touched: 1 }))
    expect((await other.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })).status).toBe(403) // sessione di un altro
    const ok = await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    expect(ok.status).toBe(200)
    expect(t.kv.get(`house:${FILE}`)).not.toContain('rt1')
    expect(JSON.parse(t.kv.get('inv:sara@example.com')!)).toEqual([FILE])
  })

  it('un account con la famiglia condivisa legge e scrive; chi non è condiviso o ha il token di un\'altra app no', async () => {
    const t = setup(); await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    expect((await t.call('/house/mine', 'tok-sara', {})).json.houses.map((h: any) => h.id)).toEqual([FILE])
    const meta = await t.call('/db/meta', 'tok-sara', { fileId: FILE })
    expect(meta.status).toBe(200); expect(meta.json.meta.version).toBe('5'); expect(meta.json.db).toBeUndefined() // solo metadati
    const read = await t.call('/db/read', 'tok-sara', { fileId: FILE })
    expect(read.status).toBe(200); expect(read.json.db.houseName).toBe('Famiglia')
    const db = { ...read.json.db, houseName: 'Nuova' }
    const w = await t.call('/db/write', 'tok-sara', { fileId: FILE, db, expectedVersion: '5' })
    expect(w.status).toBe(200); expect(w.json.meta.version).toBe('6'); expect(t.state.db.houseName).toBe('Nuova')
    expect((await t.call('/db/write', 'tok-sara', { fileId: FILE, db, expectedVersion: '5' })).status).toBe(409) // versione cambiata
    expect(t.state.patches).toBe(1)
    expect((await t.call('/db/read', 'tok-eve', { fileId: FILE })).status).toBe(403) // non condiviso
    expect((await t.call('/db/read', 'tok-alien', { fileId: FILE })).status).toBe(401) // token emesso per un'altra app
    expect((await t.call('/db/read', 'tok-wide', { fileId: FILE })).status).toBe(401) // permesso più ampio di drive.file
    expect((await t.call('/house/mine', 'tok-eve', {})).json.houses).toEqual([])
  })

  it('un invitato con ruolo di modifica non può collegare la famiglia al ponte né sovrascrivere la registrazione del proprietario', async () => {
    const t = setup(); await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    const before = t.kv.get(`house:${FILE}`)
    const SID2 = 'T'.repeat(40)
    t.kv.set(`sess:${SID2}`, await seal(t.env, { rt: 'rt-sara', email: 'sara@example.com', touched: Date.now() }))
    const r = await t.call('/house/register', 'tok-sara-direct', { fileId: FILE, session: SID2 })
    expect(r.status).toBe(403)
    expect(t.kv.get(`house:${FILE}`)).toBe(before)
  })

  it('chi ha solo lettura (reader) può leggere ma non scrivere', async () => {
    const t = setup(); await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    expect((await t.call('/db/read', 'tok-reader', { fileId: FILE })).status).toBe(200)
    const w = await t.call('/db/write', 'tok-reader', { fileId: FILE, db: DB, expectedVersion: '5' })
    expect(w.status).toBe(403); expect(t.state.patches).toBe(0)
  })

  it('scrive solo database Meal Duo validi', async () => {
    const t = setup(); await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    for (const bad of [{}, { ...DB, schema: 'altro' }, { ...DB, members: 'x' }, { ...DB, plans: [] }, { members: [], rooms: [], tasks: [] }]) {
      expect((await t.call('/db/write', 'tok-sara', { fileId: FILE, db: bad, expectedVersion: '5' })).status).toBe(400)
    }
    expect((await t.call('/db/write', 'tok-sara', { fileId: FILE, db: DB })).status).toBe(400) // versione mancante
    expect(t.state.patches).toBe(0)
  })

  it('tolta la condivisione su Drive l\'accesso si chiude; revocato l\'accesso del proprietario la famiglia si scollega', async () => {
    const shared: Array<[string, string]> = [['owner@example.com', 'owner'], ['sara@example.com', 'writer']]
    const t = setup({ shared }); await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    shared.pop()
    expect((await t.call('/db/read', 'tok-sara', { fileId: FILE })).status).toBe(403)
    shared.push(['sara@example.com', 'writer'])
    expect((await t.call('/db/read', 'tok-sara', { fileId: FILE })).status).toBe(200)
    t.state.revoked = true
    expect((await t.call('/db/read', 'tok-sara', { fileId: FILE })).status).toBe(410)
    expect(t.kv.has(`house:${FILE}`)).toBe(false)
  })

  it('senza famiglia registrata non c\'è accesso via ponte', async () => {
    const t = setup()
    expect((await t.call('/db/read', 'tok-sara', { fileId: FILE })).status).toBe(403)
  })

  it('l\'invitato via ponte può anche iscriversi alle notifiche (autenticazione condivisa)', async () => {
    const t = setup(); await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } }
    expect((await t.call('/subscribe', 'tok-sara', { fileId: FILE, subscription: sub })).status).toBe(200)
    expect((await t.call('/subscribe', 'tok-eve', { fileId: FILE, subscription: sub })).status).toBe(403)
  })

  /* ---------- il codice (ID del file) ---------- */

  it('/house/join: con il codice l\'account viene condiviso come scrittore dal Worker e poi legge e scrive; ripetere non duplica', async () => {
    const t = setup({ shared: [['owner@example.com', 'owner']] }); await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    expect((await t.call('/db/read', 'tok-sara', { fileId: FILE })).status).toBe(403) // prima del codice non entra
    const j = await t.call('/house/join', 'tok-sara', { fileId: FILE })
    expect(j.status).toBe(200); expect(j.json).toEqual({ ok: true, joined: true })
    expect(t.state.created).toEqual([{ type: 'user', role: 'writer', emailAddress: 'sara@example.com' }])
    expect(t.state.createQuery).toContain('sendNotificationEmail=false')
    expect(t.shared).toContainEqual(['sara@example.com', 'writer'])
    const read = await t.call('/db/read', 'tok-sara', { fileId: FILE })
    expect(read.status).toBe(200)
    expect((await t.call('/db/write', 'tok-sara', { fileId: FILE, db: { ...read.json.db, houseName: 'Da Sara' }, expectedVersion: '5' })).status).toBe(200)
    expect((await t.call('/house/mine', 'tok-sara', {})).json.houses.map((h: any) => h.id)).toEqual([FILE]) // compare tra gli inviti
    const again = await t.call('/house/join', 'tok-sara', { fileId: FILE })
    expect(again.json).toEqual({ ok: true, joined: false })
    expect(t.state.created).toHaveLength(1)
    expect(t.shared.filter(([e]) => e === 'sara@example.com')).toHaveLength(1)
  })

  it('/house/join: codice sconosciuto o famiglia non collegata → 404; senza token valido 401; l\'email non si prende dal corpo', async () => {
    const t = setup({ shared: [['owner@example.com', 'owner']] })
    expect((await t.call('/house/join', 'tok-sara', { fileId: FILE })).status).toBe(404) // nessuna famiglia registrata
    await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    expect((await t.call('/house/join', 'tok-sara', { fileId: 'ALTROCODICE99' })).status).toBe(404)
    expect((await t.call('/house/join', 'tok-sara', { fileId: 'corto' })).status).toBe(400)
    expect((await t.call('/house/join', 'token-inventato', { fileId: FILE })).status).toBe(401)
    expect((await t.call('/house/join', 'tok-alien', { fileId: FILE })).status).toBe(401) // token di un'altra app
    await t.call('/house/join', 'tok-sara', { fileId: FILE, emailAddress: 'eve@example.com', email: 'eve@example.com' })
    expect(t.state.created.map((c) => c.emailAddress)).toEqual(['sara@example.com'])
    expect(t.shared.some(([e]) => e === 'eve@example.com')).toBe(false)
  })

  it('/house/join: chi ha già un permesso non viene promosso (un lettore resta lettore); tetto di 20 account', async () => {
    const t = setup(); await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    expect((await t.call('/house/join', 'tok-reader', { fileId: FILE })).json.joined).toBe(false)
    expect(t.shared.find(([e]) => e === 'reader@example.com')![1]).toBe('reader')
    expect(t.state.created).toHaveLength(0)
    const full: Array<[string, string]> = [['owner@example.com', 'owner'], ...Array.from({ length: 19 }, (_, i): [string, string] => [`u${i}@example.com`, 'writer'])]
    const f = setup({ shared: full }); await f.seed(); await f.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    const r = await f.call('/house/join', 'tok-sara', { fileId: FILE })
    expect(r.status).toBe(403); expect(r.json.error).toMatch(/al completo/)
    expect(f.state.created).toHaveLength(0)
  })

  it('/house/join: tolto l\'account da Drive l\'accesso si chiude subito (ma con il codice può rientrare)', async () => {
    const t = setup({ shared: [['owner@example.com', 'owner']] }); await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    await t.call('/house/join', 'tok-sara', { fileId: FILE })
    expect((await t.call('/db/read', 'tok-sara', { fileId: FILE })).status).toBe(200)
    t.shared.splice(t.shared.findIndex(([e]) => e === 'sara@example.com'), 1) // il proprietario la toglie da Drive
    expect((await t.call('/db/read', 'tok-sara', { fileId: FILE })).status).toBe(403)
    expect((await t.call('/house/join', 'tok-sara', { fileId: FILE })).json.joined).toBe(true) // limite noto del codice come segreto condiviso
  })

  it('proprietario con accesso revocato su Google: il codice risponde 410 e il collegamento si cancella', async () => {
    const t = setup({ shared: [['owner@example.com', 'owner']] }); await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    t.state.revoked = true
    expect((await t.call('/house/join', 'tok-sara', { fileId: FILE })).status).toBe(410)
    expect(t.kv.has(`house:${FILE}`)).toBe(false)
  })

  /* ---------- identità ---------- */

  it('la verifica del token si mette in cache per al più 60 s (solo identità, mai i permessi)', async () => {
    const t = setup(); await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    clearAuthCache(); t.state.aboutCalls = 0; t.state.tokeninfoCalls = 0
    for (let i = 0; i < 3; i++) await t.call('/house/mine', 'tok-sara', {})
    expect(t.state.tokeninfoCalls).toBe(1); expect(t.state.aboutCalls).toBe(1)
    // i permessi si rileggono a ogni chiamata: tolta la condivisione l'accesso cade anche con l'identità in cache
    t.shared.splice(t.shared.findIndex(([e]) => e === 'sara@example.com'), 1)
    expect((await t.call('/db/read', 'tok-sara', { fileId: FILE })).status).toBe(403)
    const real = Date.now; try { Date.now = () => real() + 61_000; await t.call('/house/mine', 'tok-sara', {}) } finally { Date.now = real }
    expect(t.state.tokeninfoCalls).toBe(2)
  })

  it('/subscribe e /notify verificano anche loro il token (app giusta, solo drive.file)', async () => {
    const t = setup(); await t.seed(); await t.call('/house/register', 'tok-owner', { fileId: FILE, session: SID })
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } }
    expect((await t.call('/subscribe', 'tok-alien', { fileId: FILE, subscription: sub })).status).toBe(401)
    expect((await t.call('/subscribe', 'tok-wide', { fileId: FILE, subscription: sub })).status).toBe(401)
    expect((await t.call('/notify', 'tok-alien', { fileId: FILE, recipients: ['sara@example.com'], title: 'T' })).status).toBe(401)
  })

  it('/health: push, auth e bridge', async () => {
    const { env } = setup()
    expect(await (await worker.fetch(new Request('https://w.example/health'), env)).json()).toEqual({ ok: true, auth: true, push: true, bridge: true, reminders: true })
    ;(env as any).VAPID_PRIVATE_KEY = ''
    expect(((await (await worker.fetch(new Request('https://w.example/health'), env)).json()) as any).push).toBe(false)
  })
})

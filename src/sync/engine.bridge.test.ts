import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDatabase } from '../types'
import { fixtureDb } from '../test-helpers'
import { addExtra, toggleCheck } from '../services/dbOps'

/** Famiglia «remota» con versione incrementale. Accesso diretto e ponte sono interruttori. */
const { R, DriveError, S } = vi.hoisted(() => {
  class DriveError extends Error { status: number; constructor(s: number, m: string) { super(m); this.status = s } }
  const R = { db: null as unknown, version: 1, direct: false, bridge: true, bridgeAvail: true, writes: 0, bridgeWrites: 0, bridgeReads: 0, metaCalls: 0, picker: true, picked: null as string | null, shared: [] as unknown[], registered: 0, conflictOnce: false }
  return { R, DriveError, S: { session: true } }
})
const file = (extra: object = {}) => ({ id: 'FAMILYID12345', name: 'meal-duo-db.json', version: String(R.version), modifiedTime: 'now', ...extra })

vi.mock('./drive', () => ({
  DB_FILE_NAME: 'meal-duo-db.json',
  DriveError,
  parseFileId: (s: string) => (/^[\w-]{10,100}$/.test(s.trim()) ? s.trim() : null),
  isDatabaseFile: () => true,
  getMeta: vi.fn(async () => { R.metaCalls++; if (!R.direct) throw new DriveError(404, 'File not found'); return file({ ownedByMe: true, capabilities: { canShare: true, canEdit: true }, owners: [{ emailAddress: 'a@x.it' }] }) }),
  download: vi.fn(async () => { if (!R.direct) throw new DriveError(404, 'x'); return structuredClone(R.db) }),
  updateFile: vi.fn(async (_t: string, _id: string, content: string) => { R.writes++; R.db = JSON.parse(content); R.version++; return file() }),
  createFile: vi.fn(async (_t: string, content: string) => { R.db = JSON.parse(content); R.version = 1; R.direct = true; return file() }),
  shareFile: vi.fn(async (_t: string, _id: string, email: string, message: string) => { R.shared.push({ email, message }) }),
  removeShare: vi.fn(async () => true),
  about: vi.fn(async () => ({ email: 'a@x.it', name: 'Anna' })),
  listCandidates: vi.fn(async () => []),
  folderName: vi.fn(async () => 'F'),
  moveFile: vi.fn(async () => file()),
}))
vi.mock('./bridge', () => {
  class ConflictError extends Error {}
  const noAccess = () => { throw new DriveError(404, 'Nessun accesso al database della famiglia') }
  return {
    ConflictError,
    bridgeAvailable: async () => R.bridgeAvail,
    bridgeMeta: vi.fn(async () => { if (!R.bridge) noAccess(); return file() }),
    bridgeRead: vi.fn(async () => { R.bridgeReads++; if (!R.bridge) noAccess(); return { meta: file(), db: structuredClone(R.db) } }),
    bridgeWrite: vi.fn(async (_t: string, _id: string, db: AppDatabase, expected: string) => {
      if (expected !== String(R.version) || R.conflictOnce) { R.conflictOnce = false; throw new ConflictError() }
      R.bridgeWrites++; R.db = structuredClone(db); R.version++; return file()
    }),
    registerFamily: vi.fn(async () => { R.registered++; return true }),
    myFamilies: vi.fn(async () => (R.bridge ? [{ id: 'FAMILYID12345', name: 'meal-duo-db.json', modifiedTime: 'now' }] : [])),
  }
})
vi.mock('./invite', () => ({ inviteLink: (id: string) => `https://app.example/#join=${id}` }))
vi.mock('./google', () => ({
  GoogleAuthError: class extends Error {}, cachedToken: () => 'tok', clearToken: () => undefined, requestToken: async () => 'tok', revokeToken: () => undefined, setToken: () => undefined, tokenRemainingMs: () => 3_000_000,
}))
vi.mock('./auth', () => ({
  SessionExpired: class extends Error {}, brokerAvailable: async () => false, hasSession: () => S.session, logoutBroker: async () => undefined, refreshAccessToken: async () => null, startBrokerLogin: () => undefined, sessionId: () => 'S'.repeat(40),
}))
vi.mock('./picker', () => ({
  pickerConfigured: () => R.picker,
  pickDatabase: vi.fn(async () => (R.picked ? { id: R.picked, name: 'meal-duo-db.json' } : null)),
  pickFolder: async () => null,
}))

import { NeedsPickerError, SyncEngine } from './engine'

const store = new Map<string, string>()
const sleep = () => new Promise((r) => setTimeout(r, 3))
beforeEach(() => {
  store.clear(); S.session = true
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('window', { addEventListener: () => undefined })
  vi.stubGlobal('document', { addEventListener: () => undefined, visibilityState: 'visible' })
  vi.stubGlobal('setInterval', () => 0)
  Object.assign(R, { db: fixtureDb() as unknown, version: 1, direct: false, bridge: true, bridgeAvail: true, writes: 0, bridgeWrites: 0, bridgeReads: 0, metaCalls: 0, picker: true, picked: null, shared: [], registered: 0, conflictOnce: false })
})
const mk = (local: AppDatabase = structuredClone(R.db as AppDatabase)) => {
  const e = new SyncEngine()
  const host = { db: local, getDb: () => host.db, applyDb: (fn: (p: AppDatabase) => AppDatabase) => { host.db = fn(host.db) } }
  e.attach(host as never)
  return { e, host }
}
const idle = async (e: SyncEngine) => { for (let i = 0; i < 30 && e.getSnapshot().status === 'syncing'; i++) await sleep() }

describe('apertura di una famiglia: diretto → ponte → Picker ristretto', () => {
  it('accesso diretto: non serve il ponte', async () => {
    R.direct = true
    const { e } = mk()
    const r = await e.resolveFamily('FAMILYID12345')
    expect(r.bridged).toBe(false); expect(R.bridgeReads).toBe(0)
  })
  it('senza accesso diretto entra dal ponte (nessun Picker, nessun ID da incollare oltre al link)', async () => {
    const { e } = mk()
    const r = await e.resolveFamily('FAMILYID12345')
    expect(r.bridged).toBe(true); expect(r.remote.members).toHaveLength(2)
  })
  it('né diretto né ponte: con il Picker serve un tocco (NeedsPickerError), poi apre quel file', async () => {
    R.bridge = false
    const { e } = mk()
    await expect(e.resolveFamily('FAMILYID12345')).rejects.toBeInstanceOf(NeedsPickerError)
    R.picked = 'FAMILYID12345'; R.direct = true // il tocco concede l'accesso diretto
    const r = await e.resolveFamily('FAMILYID12345', true)
    expect(r.bridged).toBe(false)
  })
  it('senza ponte né Picker: errore chiaro; ID non valido rifiutato', async () => {
    R.bridge = false; R.bridgeAvail = false; R.picker = false
    const { e } = mk()
    await expect(e.resolveFamily('FAMILYID12345')).rejects.toThrow(/Non riesco ad aprire la famiglia/)
    await expect(e.resolveFamily('x')).rejects.toThrow(/ID famiglia non valido/)
  })
  it('il messaggio del ponte (es. «chi l\'ha creata deve riaprire l\'app») arriva all\'utente se non c\'è il Picker', async () => {
    R.bridge = false; R.picker = false
    const { e } = mk()
    await expect(e.resolveFamily('FAMILYID12345')).rejects.toThrow(/Nessun accesso al database della famiglia/)
  })
  it('listFamilies unisce file diretti e famiglie del ponte senza duplicati', async () => {
    const { e } = mk()
    const l = await e.listFamilies()
    expect(l).toEqual([{ id: 'FAMILYID12345', name: 'meal-duo-db.json', modifiedTime: 'now', bridged: true }])
  })
})

describe('sincronizzazione dal ponte', () => {
  async function joined() {
    const base = structuredClone(R.db as AppDatabase)
    const { e, host } = mk(base)
    const r = await e.resolveFamily('FAMILYID12345')
    await e.link(r.file, r.remote, 'replace', r.bridged)
    await idle(e)
    return { e, host }
  }
  it('chi entra dal ponte: bridged, non può invitare né gestire la cartella; usa solo /db/*', async () => {
    const { e } = await joined()
    expect(e.getSnapshot()).toMatchObject({ bridged: true, canShare: false, status: 'synced' })
    await expect(e.invite('b@x.it', 'F')).rejects.toThrow(/Solo chi ha creato la famiglia/)
    await expect(e.revoke('b@x.it')).rejects.toThrow(/Solo chi ha creato la famiglia/)
    expect(await e.currentFolder()).toBeNull()
    const direct = R.metaCalls
    await e.syncNow(); await idle(e)
    expect(R.metaCalls).toBe(direct) // dopo l'ingresso nessuna chiamata diretta a Drive: solo /db/*
  })
  it('modifica locale → scrittura dal ponte con la versione attesa', async () => {
    const { e, host } = await joined()
    host.db = toggleCheck(host.db, 'riso|g', true); e.markDirty()
    await e.syncNow(); await idle(e)
    expect(R.bridgeWrites).toBe(1); expect(R.writes).toBe(0)
    expect((R.db as AppDatabase).shopping.checks['riso|g'].checked).toBe(true)
    expect(e.getSnapshot()).toMatchObject({ dirty: false, status: 'synced' })
  })
  it('409 dal ponte (qualcuno ha scritto nel frattempo): rilegge, fa il merge e riprova senza perdere nulla', async () => {
    const { e, host } = await joined()
    await sleep()
    R.db = addExtra(R.db as AppDatabase, 'Scritto da altri'); R.version++ // l'altro ha scritto
    await sleep()
    host.db = toggleCheck(host.db, 'riso|g', true); e.markDirty()
    await e.syncNow(); await idle(e)
    expect((R.db as AppDatabase).shopping.extras.map((x) => x.name)).toEqual(['Scritto da altri'])
    expect((R.db as AppDatabase).shopping.checks['riso|g'].checked).toBe(true)
    expect(host.db.shopping.extras).toHaveLength(1)
  })
  it('conflitto forzato (409 alla prima scrittura): ripete il ciclo', async () => {
    const { e, host } = await joined()
    host.db = toggleCheck(host.db, 'riso|g', true); e.markDirty()
    R.conflictOnce = true
    await e.syncNow(); await idle(e)
    expect(R.bridgeWrites).toBe(1)
    expect(e.getSnapshot().status).toBe('synced')
  })
  it('invito tolto su Drive (il ponte risponde «nessun accesso»): errore con il messaggio del server', async () => {
    const { e, host } = await joined()
    R.bridge = false
    host.db = toggleCheck(host.db, 'riso|g', true); e.markDirty()
    await e.syncNow(); await idle(e)
    expect(e.getSnapshot().status).toBe('error')
    expect(e.getSnapshot().error).toMatch(/Nessun accesso al database della famiglia/)
  })
})

describe('registrazione sul ponte e inviti (lato proprietario)', () => {
  async function owner() {
    const { e, host } = mk(fixtureDb())
    await e.createHouse({ houseName: 'Famiglia', memberName: 'Anna', folderId: null, keepLocal: false })
    await idle(e)
    return { e, host }
  }
  it('creando la famiglia la affida al ponte (con l\'accesso persistente)', async () => {
    await owner(); await sleep()
    expect(R.registered).toBeGreaterThanOrEqual(1)
  })
  it('la registrazione periodica non si ripete prima di 3 giorni; l\'invito la forza e porta il link', async () => {
    const { e } = await owner(); await sleep()
    const n = R.registered
    expect(await e.registerBridge()).toBe(false); expect(R.registered).toBe(n)
    await e.invite('bruno@x.it', 'Famiglia'); await sleep()
    expect(R.registered).toBe(n + 1) // forzata: l'elenco degli invitati si aggiorna solo alla registrazione
    expect(R.shared).toEqual([{ email: 'bruno@x.it', message: expect.stringContaining('#join=FAMILYID12345') }])
  })
  it('senza accesso persistente non registra', async () => {
    S.session = false
    const { e } = await owner(); await sleep()
    expect(R.registered).toBe(0)
    expect(await e.registerBridge(true)).toBe(false)
  })
  it('chi è entrato dal ponte non registra mai (non è il proprietario)', async () => {
    const { e } = mk()
    const r = await e.resolveFamily('FAMILYID12345')
    await e.link(r.file, r.remote, 'replace', true); await idle(e); await sleep()
    expect(await e.registerBridge(true)).toBe(false)
  })
})

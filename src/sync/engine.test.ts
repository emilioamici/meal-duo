import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDatabase } from '../types'
import { fixtureDb } from '../test-helpers'
import { addExtra, emptyDb, toggleCheck } from '../services/dbOps'

/** Finto Drive in memoria con versione incrementale. */
const remote = { db: null as AppDatabase | null, version: 1, canEdit: true, onGetMeta: null as null | (() => void), uploads: 0, downloads: 0 }
const file = () => ({ id: 'f1', name: 'meal-duo-db.json', version: String(remote.version), modifiedTime: new Date().toISOString(), ownedByMe: true, owners: [{ emailAddress: 'a@x.it' }], capabilities: { canEdit: remote.canEdit, canShare: true } })
vi.mock('./drive', () => ({
  DB_FILE_NAME: 'meal-duo-db.json',
  DriveError: class DriveError extends Error { status: number; constructor(s: number, m: string) { super(m); this.status = s } },
  getMeta: vi.fn(async () => { remote.onGetMeta?.(); return file() }),
  download: vi.fn(async () => { remote.downloads++; return structuredClone(remote.db) }),
  updateFile: vi.fn(async (_t: string, _id: string, content: string) => { remote.uploads++; remote.db = JSON.parse(content); remote.version++; return file() }),
  createFile: vi.fn(async (_t: string, content: string) => { remote.db = JSON.parse(content); remote.version = 1; return file() }),
  about: vi.fn(async () => ({ email: 'a@x.it', name: 'Anna' })),
  listCandidates: vi.fn(async () => [file()]),
}))
vi.mock('./google', () => ({
  GoogleAuthError: class GoogleAuthError extends Error {},
  cachedToken: () => 'tok', clearToken: () => undefined, requestToken: async () => 'tok', revokeToken: () => undefined, setToken: () => undefined, tokenRemainingMs: () => 3_000_000,
}))
vi.mock('./auth', () => ({
  SessionExpired: class SessionExpired extends Error {}, brokerAvailable: async () => false, hasSession: () => false, logoutBroker: async () => undefined, refreshAccessToken: async () => null, startBrokerLogin: () => undefined,
}))
vi.mock('./picker', () => ({ pickDatabase: async () => null, pickFolder: async () => null, pickerConfigured: () => false }))

import { SyncEngine } from './engine'

const store = new Map<string, string>()
const sleep = () => new Promise((r) => setTimeout(r, 3))
beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('window', { addEventListener: () => undefined })
  vi.stubGlobal('document', { addEventListener: () => undefined, visibilityState: 'visible' })
  vi.stubGlobal('setInterval', () => 0)
  Object.assign(remote, { db: fixtureDb(), version: 1, canEdit: true, onGetMeta: null, uploads: 0, downloads: 0 })
})

/** Motore collegato al file f1, con copia locale = quella remota (stato dopo una sync riuscita). */
function linked(local: AppDatabase = structuredClone(remote.db!)) {
  store.set('mealduo:sync', JSON.stringify({ fileId: 'f1', fileName: 'meal-duo-db.json', email: 'a@x.it', ownerEmail: 'a@x.it', canShare: true, remoteVersion: '1', lastSyncAt: null, dirty: false }))
  const e = new SyncEngine()
  const host = { db: local, notified: 0, remoteSeen: 0, getDb: () => host.db, applyDb: (fn: (p: AppDatabase) => AppDatabase, _d: boolean, src?: 'remote') => { host.db = fn(host.db); if (src === 'remote') host.remoteSeen++ }, afterSync: () => { host.notified++ } }
  e.attach(host as never)
  return { e, host }
}
const idle = async (e: SyncEngine) => { for (let i = 0; i < 20 && e.getSnapshot().status === 'syncing'; i++) await sleep() }

describe('SyncEngine.syncNow', () => {
  it('nulla da fare: versione invariata e non sporco → nessun download né upload', async () => {
    const { e } = linked()
    await e.syncNow(); await idle(e)
    expect(remote.downloads).toBe(0); expect(remote.uploads).toBe(0)
    expect(e.getSnapshot().status).toBe('synced')
  })
  it('modifica locale: markDirty + sync → upload e nuova versione; afterSync notifica (coda push)', async () => {
    const { e, host } = linked()
    await idle(e)                                                          // sync iniziale di attach()
    host.db = toggleCheck(host.db, 'riso|g', true)
    e.markDirty()
    expect(e.getSnapshot().status).toBe('pending')
    await e.syncNow(); await idle(e)
    expect(remote.uploads).toBe(1)
    expect(remote.db!.shopping.checks['riso|g'].checked).toBe(true)
    expect(e.getSnapshot()).toMatchObject({ status: 'synced', dirty: false, remoteVersion: '2' })
    expect(host.notified).toBeGreaterThan(0)
  })
  it('remoto cambiato da un altro: scarica, fa il merge (source=remote) e ricarica entrambe le modifiche', async () => {
    const base = structuredClone(remote.db!)
    await sleep()
    remote.db = addExtra(base, 'Carta forno'); remote.version = 2       // l'altro ha aggiunto un extra
    await sleep()
    const { e, host } = linked(toggleCheck(base, 'riso|g', true))       // io ho spuntato il riso
    e.markDirty()
    await e.syncNow(); await idle(e)
    expect(host.remoteSeen).toBe(1)                                      // il DB è arrivato "da altri": possibili notifiche
    expect(host.db.shopping.extras.map((x) => x.name)).toEqual(['Carta forno'])
    expect(remote.db!.shopping.extras).toHaveLength(1)
    expect(remote.db!.shopping.checks['riso|g'].checked).toBe(true)
  })
  it('solo il remoto è cambiato: scarica senza ricaricare', async () => {
    const base = structuredClone(remote.db!)
    remote.db = addExtra(base, 'Sale'); remote.version = 2
    const { e, host } = linked(base)
    await e.syncNow(); await idle(e)
    expect(host.db.shopping.extras).toHaveLength(1)
    expect(remote.uploads).toBe(0)
    expect(e.getSnapshot().remoteVersion).toBe('2')
  })
  it('race: il remoto cambia tra la lettura e la scrittura → rifà il merge e non perde nulla', async () => {
    const base = structuredClone(remote.db!)
    await sleep()
    const { e, host } = linked(toggleCheck(base, 'riso|g', true))
    e.markDirty()
    let calls = 0
    remote.onGetMeta = () => { if (++calls === 2) { remote.db = addExtra(remote.db!, 'Scritto nel frattempo'); remote.version++ } } // 2° getMeta = controllo pre-scrittura
    await e.syncNow(); await idle(e)
    expect(remote.db!.shopping.extras.map((x) => x.name)).toEqual(['Scritto nel frattempo'])
    expect(remote.db!.shopping.checks['riso|g'].checked).toBe(true)
    expect(host.db.shopping.extras).toHaveLength(1)
  })
  it('sola lettura sul file → errore chiaro, nessun upload', async () => {
    remote.canEdit = false
    const { e, host } = linked()
    host.db = toggleCheck(host.db, 'riso|g', true); e.markDirty()
    await e.syncNow(); await idle(e)
    expect(e.getSnapshot().status).toBe('error')
    expect(e.getSnapshot().error).toMatch(/permessi di scrittura/)
    expect(remote.uploads).toBe(0)
  })
  it('offline: stato offline e nessuna chiamata', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const { e } = linked()
    await e.syncNow()
    expect(e.getSnapshot().status).toBe('offline')
    expect(remote.downloads + remote.uploads).toBe(0)
  })
})

describe('copia locale persa o datata (non sovrascrive mai Drive)', () => {
  it('copia mancante: si adotta Drive così com\'è e NON si invia nulla', async () => {
    const real = addExtra(structuredClone(remote.db!), 'Dati veri su Drive'); remote.db = real; remote.version = 2
    store.set('mealduo:sync', JSON.stringify({ fileId: 'f1', email: 'a@x.it', remoteVersion: '2', dirty: true }))
    const e = new SyncEngine()
    const host = { db: emptyDb(), getDb: () => host.db, applyDb: (fn: (p: AppDatabase) => AppDatabase) => { host.db = fn(host.db) } }
    e.checkCache('missing')
    e.attach(host as never)
    await e.syncNow(); await idle(e)
    expect(host.db.shopping.extras.map((x) => x.name)).toEqual(['Dati veri su Drive'])
    expect(remote.uploads).toBe(0)
    expect(remote.db).toEqual(real)
  })
  it('copia datata: si rilegge Drive e si uniscono i due stati', async () => {
    const base = structuredClone(remote.db!)
    await sleep()
    remote.db = addExtra(base, 'Su Drive'); remote.version = 2
    store.set('mealduo:sync', JSON.stringify({ fileId: 'f1', email: 'a@x.it', remoteVersion: '1', dirty: false }))
    const e = new SyncEngine()
    const host = { db: toggleCheck(base, 'riso|g', true), getDb: () => host.db, applyDb: (fn: (p: AppDatabase) => AppDatabase) => { host.db = fn(host.db) } }
    e.checkCache('stale')
    e.attach(host as never)
    await e.syncNow(); await idle(e)
    expect(host.db.shopping.extras).toHaveLength(1)
    expect(host.db.shopping.checks['riso|g'].checked).toBe(true)
  })
})

describe('createHouse / link / unlink', () => {
  it('createHouse da demo: casa nuova con me come primo membro (email), file creato, collegato', async () => {
    const e = new SyncEngine()
    const host = { db: fixtureDb(), getDb: () => host.db, applyDb: (fn: (p: AppDatabase) => AppDatabase) => { host.db = fn(host.db) } }
    e.attach(host as never)
    await e.createHouse({ houseName: 'Casa Rossi', memberName: 'Anna', folderId: null, keepLocal: false })
    expect(e.getSnapshot()).toMatchObject({ fileId: 'f1', canShare: true, status: 'synced', ownerEmail: 'a@x.it' })
    expect(host.db.houseName).toBe('Casa Rossi')
    expect(host.db.members).toMatchObject([{ name: 'Anna', email: 'a@x.it' }])
    expect(remote.db!.houseName).toBe('Casa Rossi')
  })
  it('link merge unisce i dati locali; replace li scarta; unlink dimentica il file', async () => {
    const e = new SyncEngine()
    const local = addExtra(fixtureDb(), 'Locale')
    const host = { db: local, getDb: () => host.db, applyDb: (fn: (p: AppDatabase) => AppDatabase) => { host.db = fn(host.db) } }
    e.attach(host as never)
    const { file: f } = { file: file() }
    await e.link(f, structuredClone(remote.db!), 'replace')
    expect(host.db.shopping.extras).toHaveLength(0)
    e.unlink()
    expect(e.getSnapshot()).toMatchObject({ fileId: null, status: 'off' })
  })
})

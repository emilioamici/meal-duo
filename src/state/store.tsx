/**
 * Store dei dati: database in memoria + cache locale (localStorage) + sincronizzazione con Google Drive.
 *  - la cache locale è sempre la fonte per il rendering (l'app funziona offline);
 *  - ogni mutazione marca `dirty` e pianifica una sync (debounce);
 *  - la sync parte anche all'apertura, quando si torna online/visibili, ogni 30 s e dal pulsante "Sync".
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppDatabase, Member } from '../types'
import { createDemoDb } from '../data/demo'
import { emptyDb, liveMembers } from '../services/dbOps'
import { parseDb } from '../services/dbSchema'
import { mergeDatabases } from '../services/merge'
import { syncWithDrive } from '../services/syncEngine'
import * as drive from '../services/googleDriveService'
import type { DriveConfig } from '../services/googleDriveService'

export type SyncStatus = 'local' | 'idle' | 'syncing' | 'synced' | 'offline' | 'error' | 'auth'

interface Meta {
  dirty: boolean
  demo: boolean
  fileId?: string
  revision: string
  lastSyncAt?: string
  account?: string
}
interface Cfg { clientId: string; apiKey: string; appId: string }

const K_DB = 'mealduo:db'
const K_META = 'mealduo:meta'
const K_CFG = 'mealduo:cfg'

const ENV_CFG: Cfg = {
  clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
  apiKey: import.meta.env.VITE_GOOGLE_API_KEY ?? '',
  appId: import.meta.env.VITE_GOOGLE_APP_ID ?? '',
}

function readJson<T>(key: string): T | null {
  try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : null } catch { return null }
}
function writeJson(key: string, v: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* quota / private mode */ }
}

function loadInitial(): { db: AppDatabase; meta: Meta; cfg: Cfg } {
  let db: AppDatabase | null = null
  try { const raw = readJson<unknown>(K_DB); if (raw) db = parseDb(raw) } catch { db = null }
  const meta = readJson<Meta>(K_META)
  const cfg = { ...ENV_CFG, ...(readJson<Partial<Cfg>>(K_CFG) ?? {}) }
  if (!db) return { db: createDemoDb(), meta: { dirty: false, demo: true, revision: '' }, cfg }
  return { db, meta: meta ?? { dirty: false, demo: false, revision: '' }, cfg }
}

export interface Store {
  db: AppDatabase
  members: Member[]
  commit: (fn: (db: AppDatabase) => AppDatabase) => void
  status: SyncStatus
  error?: string
  lastSyncAt?: string
  fileId?: string
  demo: boolean
  account?: string
  dirty: boolean
  cfg: Cfg
  setCfg: (patch: Partial<Cfg>) => void
  syncNow: (interactive?: boolean) => Promise<void>
  connect: () => Promise<void>
  createHouse: (opts: { fresh: boolean }) => Promise<void>
  joinHouse: (fileId: string) => Promise<void>
  pickAndJoin: () => Promise<void>
  disconnect: () => void
  share: (email: string) => Promise<void>
  startFresh: () => void
  importDatabase: (db: AppDatabase) => void
}

const Ctx = createContext<Store | null>(null)
export const useStore = (): Store => {
  const s = useContext(Ctx)
  if (!s) throw new Error('StoreProvider mancante')
  return s
}

const driveCfg = (c: Cfg): DriveConfig => ({ clientId: c.clientId.trim(), apiKey: c.apiKey.trim() || undefined, appId: c.appId.trim() || undefined })

export function StoreProvider({ children }: { children: ReactNode }) {
  const init = useRef(loadInitial())
  const dbRef = useRef(init.current.db)
  const metaRef = useRef(init.current.meta)
  const cfgRef = useRef(init.current.cfg)
  const mutations = useRef(0)
  const syncing = useRef(false)
  const again = useRef(false)
  const timer = useRef<number | undefined>(undefined)

  const [db, setDb] = useState(dbRef.current)
  const [meta, setMeta] = useState(metaRef.current)
  const [cfg, setCfgState] = useState(cfgRef.current)
  const [status, setStatus] = useState<SyncStatus>(metaRef.current.fileId ? 'idle' : 'local')
  const [error, setError] = useState<string | undefined>()

  const persist = useCallback((nextDb: AppDatabase, nextMeta: Meta) => {
    dbRef.current = nextDb
    metaRef.current = nextMeta
    setDb(nextDb)
    setMeta(nextMeta)
    writeJson(K_DB, nextDb)
    writeJson(K_META, nextMeta)
  }, [])

  const syncNow = useCallback(async (interactive = false): Promise<void> => {
    const m = metaRef.current
    if (!m.fileId) return
    if (!navigator.onLine) { setStatus('offline'); return }
    if (syncing.current) { again.current = true; return }
    const dc = driveCfg(cfgRef.current)
    if (!interactive && !drive.hasValidToken()) {
      try { await drive.getAccessToken(dc.clientId, false) } catch { setStatus('auth'); return }
    }
    syncing.current = true
    setStatus('syncing')
    setError(undefined)
    const startMutations = mutations.current
    try {
      if (interactive) await drive.getAccessToken(dc.clientId, true)
      const out = await syncWithDrive({ cfg: dc, fileId: m.fileId, local: dbRef.current, knownRevision: m.revision, dirty: m.dirty })
      // se l'utente ha modificato qualcosa durante la sync, riunisci e resta "sporco"
      const changed = mutations.current !== startMutations
      const finalDb = changed ? mergeDatabases(dbRef.current, out.db) : out.db
      persist(finalDb, { ...metaRef.current, dirty: changed, demo: false, revision: out.revision, lastSyncAt: new Date().toISOString() })
      setStatus('synced')
      if (changed) again.current = true
    } catch (e) {
      const err = e as drive.DriveError
      if (err.status === 401 || /accesso|client id|sessione/i.test(err.message)) setStatus('auth')
      else if (!navigator.onLine || err instanceof TypeError) setStatus('offline')
      else setStatus('error')
      setError(err.message)
    } finally {
      syncing.current = false
      if (again.current) { again.current = false; window.setTimeout(() => void syncNow(false), 400) }
    }
  }, [persist])

  const scheduleSync = useCallback(() => {
    if (!metaRef.current.fileId) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void syncNow(false), 1200)
  }, [syncNow])

  const commit = useCallback((fn: (d: AppDatabase) => AppDatabase) => {
    const next = fn(dbRef.current)
    if (next === dbRef.current) return
    mutations.current++
    persist(next, { ...metaRef.current, dirty: true, demo: false })
    scheduleSync()
  }, [persist, scheduleSync])

  // sync all'apertura, al ritorno online/visibile e ogni 30 s
  useEffect(() => {
    if (metaRef.current.fileId) void syncNow(false)
    const onVisible = () => { if (document.visibilityState === 'visible') void syncNow(false) }
    const onOnline = () => void syncNow(false)
    const onOffline = () => { if (metaRef.current.fileId) setStatus('offline') }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    const iv = window.setInterval(() => { if (document.visibilityState === 'visible' && drive.hasValidToken()) void syncNow(false) }, 30_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.clearInterval(iv)
    }
  }, [syncNow])

  const setCfg = useCallback((patch: Partial<Cfg>) => {
    cfgRef.current = { ...cfgRef.current, ...patch }
    setCfgState(cfgRef.current)
    writeJson(K_CFG, cfgRef.current)
  }, [])

  const run = useCallback(async (fn: () => Promise<void>) => {
    setError(undefined)
    setStatus('syncing')
    try { await fn() } catch (e) {
      setStatus(metaRef.current.fileId ? 'error' : 'local')
      setError((e as Error).message)
      throw e
    }
  }, [])

  const afterAuth = useCallback(async (dc: DriveConfig) => {
    try { const account = await drive.getAccountEmail(dc); persist(dbRef.current, { ...metaRef.current, account }) } catch { /* facoltativo */ }
  }, [persist])

  const connect = useCallback(async () => {
    await run(async () => {
      const dc = driveCfg(cfgRef.current)
      await drive.getAccessToken(dc.clientId, true)
      await afterAuth(dc)
      // se esiste già un DB visibile all'app, collegalo automaticamente
      if (!metaRef.current.fileId) {
        const found = await drive.findDbFiles(dc)
        if (found.length) {
          const remote = await drive.downloadDb(dc, found[0].id)
          persist(remote, { ...metaRef.current, fileId: found[0].id, revision: found[0].revision, dirty: false, demo: false, lastSyncAt: new Date().toISOString() })
        }
      }
      setStatus(metaRef.current.fileId ? 'synced' : 'local')
    })
  }, [run, afterAuth, persist])

  const createHouse = useCallback(async ({ fresh }: { fresh: boolean }) => {
    await run(async () => {
      const dc = driveCfg(cfgRef.current)
      await drive.getAccessToken(dc.clientId, true)
      const base = fresh ? emptyDb(dbRef.current.houseName === 'Casa Demo' ? 'La nostra casa' : dbRef.current.houseName) : dbRef.current
      const meta = await drive.createDbFile(dc, base)
      persist(base, { ...metaRef.current, fileId: meta.id, revision: meta.revision, dirty: false, demo: false, lastSyncAt: new Date().toISOString() })
      await afterAuth(dc)
      setStatus('synced')
    })
  }, [run, persist, afterAuth])

  const joinHouse = useCallback(async (fileId: string) => {
    await run(async () => {
      const dc = driveCfg(cfgRef.current)
      await drive.getAccessToken(dc.clientId, true)
      const id = fileId.trim().replace(/^.*\/d\/([^/?#]+).*$/, '$1')
      const meta = await drive.getMeta(dc, id)
      const remote = await drive.downloadDb(dc, id)
      persist(remote, { ...metaRef.current, fileId: id, revision: meta.revision, dirty: false, demo: false, lastSyncAt: new Date().toISOString() })
      await afterAuth(dc)
      setStatus('synced')
    })
  }, [run, persist, afterAuth])

  const pickAndJoin = useCallback(async () => {
    const dc = driveCfg(cfgRef.current)
    setError(undefined)
    let id: string | null
    try { id = await drive.pickDbFile(dc) } catch (e) { setError((e as Error).message); throw e }
    if (id) await joinHouse(id)
  }, [joinHouse])

  const disconnect = useCallback(() => {
    drive.signOut()
    persist(dbRef.current, { ...metaRef.current, fileId: undefined, revision: '', dirty: false, account: undefined })
    setStatus('local')
    setError(undefined)
  }, [persist])

  const share = useCallback(async (email: string) => {
    const m = metaRef.current
    if (!m.fileId) throw new Error('Crea o collega prima il database su Drive.')
    await drive.shareWithEmail(driveCfg(cfgRef.current), m.fileId, email)
  }, [])

  const startFresh = useCallback(() => {
    mutations.current++
    persist(emptyDb(), { ...metaRef.current, dirty: !!metaRef.current.fileId, demo: false })
    scheduleSync()
  }, [persist, scheduleSync])

  const importDatabase = useCallback((next: AppDatabase) => {
    mutations.current++
    persist(mergeDatabases(dbRef.current, next), { ...metaRef.current, dirty: true, demo: false })
    scheduleSync()
  }, [persist, scheduleSync])

  const members = useMemo(() => liveMembers(db), [db])

  const value: Store = {
    db, members, commit, status, error, cfg, setCfg,
    lastSyncAt: meta.lastSyncAt, fileId: meta.fileId, demo: meta.demo, account: meta.account, dirty: meta.dirty,
    syncNow, connect, createHouse, joinHouse, pickAndJoin, disconnect, share, startFresh, importDatabase,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * Store dei dati (stessa architettura di MoneyDuo): il DB vive in memoria (external store) con copia locale in IndexedDB,
 * il motore di sync (src/sync/engine.ts) lo allinea a Google Drive. Qui anche le notifiche: quelle ricevute (campanella e
 * avvisi di sistema) e quelle da inviare agli altri membri via push (coda che parte dopo l'invio dei dati a Drive).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { AppDatabase, Member } from '../types'
import { t } from '../i18n'
import { createDemoDb } from '../data/demo'
import { emptyDb, liveMembers } from '../services/dbOps'
import { mergeDatabases } from '../services/merge'
import { setActor } from '../lib/actor'
import { diffNotifications, mergeNotifications, type Notif } from '../lib/notifications'
import { engine, type SyncState } from '../sync/engine'
import { PushHttpError, enablePush, pushConfigured, pushSupported, refreshPush, sendPush } from '../sync/push'
import { enqueue, flushQueue, type QueuedPush, type SendResult } from '../sync/pushQueue'
import { cacheState, getCacheHealth, getLoadedCache, subscribeCacheHealth, writeCache } from './cache'

const PREFS_KEY = 'mealduo:prefs'
const NOTIF_PREFIX = 'mealduo:notifs:'

export interface Prefs {
  /** notifiche di sistema attive su questo dispositivo */
  systemNotif: boolean
  /** notifiche push dal server attive su questo dispositivo */
  pushEnabled: boolean
}

export interface Store {
  db: AppDatabase
  members: Member[]
  /** il membro che corrisponde all'account Google con cui si è entrati (null = non ancora associato) */
  me: Member | null
  /** applica una modifica utente: salva in locale e programma la sincronizzazione */
  commit: (fn: (db: AppDatabase) => AppDatabase) => void
  sync: SyncState
  /** false = non riesco a salvare la copia locale */
  cacheOk: boolean
  prefs: Prefs
  setPrefs: (p: Partial<Prefs>) => void
  notifications: Notif[]
  unread: number
  markRead: (id: string) => void
  markAllRead: () => void
  clearNotifications: () => void
  /** ultimo avviso arrivato mentre l'app è in primo piano (si chiude da solo) */
  toast: Notif | null
  dismissToast: () => void
  centerOpen: boolean
  setCenterOpen: (open: boolean) => void
  /** svuota il database (membri, piani, catalogo) */
  startFresh: () => void
  /** unisce un backup ai dati attuali */
  importDatabase: (db: AppDatabase) => void
}

/**
 * Dopo una modifica fatta qui, mette in coda le notifiche push per gli altri membri (stesse regole delle notifiche nell'app).
 * Partono dopo l'invio dei dati a Drive (flushPush), anche se la modifica è stata fatta offline.
 */
function queuePeers(prev: AppDatabase, next: AppDatabase, me: Member | null): void {
  if (!pushConfigured() || !me?.email) return
  const fileId = engine.getSnapshot().fileId
  if (!fileId) return
  const items: QueuedPush[] = []
  for (const m of next.members) {
    if (m.deleted || !m.email || m.id === me.id || m.email.toLowerCase() === me.email.toLowerCase()) continue
    for (const d of diffNotifications(prev, next, m.id)) {
      items.push({ key: `${d.id}|${m.email.toLowerCase()}`, fileId, email: m.email, title: d.title, body: d.body, tag: d.tag, at: Date.now(), txId: d.kind === 'extra' ? d.id.slice('extra:'.length) : undefined })
    }
  }
  enqueue(items)
}

/** Invia le notifiche in coda (i dati sono già su Drive). Errori di rete o del server: si tiene e si riprova al prossimo ciclo. */
async function flushPush(getDb: () => AppDatabase): Promise<void> {
  const snap = engine.getSnapshot()
  const token = engine.currentToken()
  if (!pushConfigured() || !snap.fileId || !token) return
  const db = getDb()
  await flushQueue({
    fileId: snap.fileId,
    // se la voce extra è stata eliminata prima dell'invio, la notifica non ha più senso
    exists: (q) => (q.txId ? db.shopping.extras.some((e) => e.id === q.txId && !e.deleted) : true),
    send: async (q): Promise<SendResult> => {
      try { await sendPush(snap.fileId!, token, { recipients: [q.email], title: q.title, body: q.body, tag: q.tag }); return 'ok' } catch (e) {
        return e instanceof PushHttpError && [400, 403, 404, 413].includes(e.status) ? 'drop' : 'retry'
      }
    },
  })
}

function loadNotifs(key: string): Notif[] {
  try { return JSON.parse(localStorage.getItem(key) || '[]') as Notif[] } catch { return [] }
}

/** Notifica di sistema (Android/desktop/iOS con app installata), mostrata solo se l'app non è in primo piano. */
async function systemNotify(n: Notif): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || document.visibilityState === 'visible') return
  const opts: NotificationOptions = { body: n.body, icon: './icons/pwa-192.png', badge: './icons/pwa-192.png', tag: n.tag }
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) await reg.showNotification(n.title, opts)
    else new Notification(n.title, opts)
  } catch { /* notifiche non disponibili */ }
}

const Ctx = createContext<Store | null>(null)
export const useStore = (): Store => {
  const s = useContext(Ctx)
  if (!s) throw new Error('StoreProvider mancante')
  return s
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const dbRef = useRef<AppDatabase>(null as unknown as AppDatabase)
  if (!dbRef.current) {
    dbRef.current = getLoadedCache().db ?? createDemoDb()
    // se la copia locale manca o è datata, il motore rilegge Drive prima di inviare qualsiasi cosa
    engine.checkCache(cacheState(engine.getSnapshot().remoteVersion))
  }
  const listeners = useRef(new Set<() => void>())
  const subscribeDb = useCallback((l: () => void) => { listeners.current.add(l); return () => { listeners.current.delete(l) } }, [])
  const db = useSyncExternalStore(subscribeDb, () => dbRef.current)

  const meRef = useRef<Member | null>(null)
  const onRemote = useRef<(prev: AppDatabase, next: AppDatabase) => void>(() => undefined)

  const apply = useCallback((fn: (prev: AppDatabase) => AppDatabase, dirty: boolean, source?: 'remote') => {
    const prev = dbRef.current
    const next = fn(prev)
    if (next === prev) return
    dbRef.current = next
    listeners.current.forEach((l) => l())
    writeCache(next, engine.getSnapshot().remoteVersion)
    if (dirty) { engine.markDirty(); queuePeers(prev, next, meRef.current) }
    if (source === 'remote') onRemote.current(prev, next) // dati arrivati da altri: possibili notifiche
  }, [])

  // il motore di sync si collega una sola volta (idempotente con StrictMode)
  const attached = useRef(false)
  if (!attached.current) {
    attached.current = true
    engine.attach({ getDb: () => dbRef.current, applyDb: apply, afterSync: () => { void flushPush(() => dbRef.current) } })
  }

  const commit = useCallback((fn: (d: AppDatabase) => AppDatabase) => apply(fn, true), [apply])
  const sync = useSyncExternalStore(engine.subscribe, engine.getSnapshot)
  const cacheOk = useSyncExternalStore(subscribeCacheHealth, getCacheHealth)

  // quando cambia la versione di Drive a cui corrisponde la copia, si aggiorna anche la copia
  const lastVersion = useRef<string | null>(sync.remoteVersion)
  useEffect(() => {
    if (sync.remoteVersion !== lastVersion.current) { lastVersion.current = sync.remoteVersion; writeCache(dbRef.current, sync.remoteVersion) }
  }, [sync.remoteVersion])

  const [prefs, setPrefsState] = useState<Prefs>(() => {
    try { return { systemNotif: false, pushEnabled: false, ...(JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as Partial<Prefs>) } } catch { return { systemNotif: false, pushEnabled: false } }
  })
  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((old) => {
      const n = { ...old, ...p }
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(n)) } catch { /* noop */ }
      return n
    })
  }, [])
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  const members = useMemo(() => liveMembers(db), [db])
  const me = useMemo(() => {
    const e = sync.email?.toLowerCase()
    return (e && members.find((m) => m.email?.toLowerCase() === e)) || null
  }, [members, sync.email])
  meRef.current = me
  setActor(me?.id) // le modifiche di questo dispositivo portano l'id dell'autore (`by`)

  // push: a ogni apertura si rinnova l'iscrizione; un messaggio dal service worker (app in primo piano) fa sincronizzare subito
  useEffect(() => {
    if (prefs.pushEnabled && sync.fileId && sync.signedIn && pushConfigured()) {
      const tk = engine.currentToken()
      if (tk) void refreshPush(sync.fileId, tk).catch(() => undefined)
    }
  }, [prefs.pushEnabled, sync.fileId, sync.signedIn])
  // notifiche già attive su questo dispositivo ma senza push (il server è stato configurato dopo): le iscrive da sole, una volta per apertura
  const autoPush = useRef(false)
  useEffect(() => {
    if (autoPush.current || !prefs.systemNotif || prefs.pushEnabled || !sync.fileId || !sync.signedIn || !pushConfigured() || !pushSupported()) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const tk = engine.currentToken()
    if (!tk) return
    autoPush.current = true
    void enablePush(sync.fileId, tk).then(() => setPrefs({ pushEnabled: true })).catch(() => undefined)
  }, [prefs.systemNotif, prefs.pushEnabled, sync.fileId, sync.signedIn, setPrefs])
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMsg = (e: MessageEvent) => { if (e.data?.type === 'mealduo-push') void engine.syncNow() }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [])

  // ----- notifiche ricevute (per famiglia e per membro, solo su questo dispositivo)
  const notifKey = sync.fileId && me ? `${NOTIF_PREFIX}${sync.fileId}:${me.id}` : null
  const [notifications, setNotifications] = useState<Notif[]>([])
  const [toast, setToast] = useState<Notif | null>(null)
  const notifKeyRef = useRef<string | null>(null)
  useEffect(() => { notifKeyRef.current = notifKey; setNotifications(notifKey ? loadNotifs(notifKey) : []) }, [notifKey])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t) }, [toast])
  const persistNotifs = useCallback((list: Notif[]) => {
    const key = notifKeyRef.current
    if (key) try { localStorage.setItem(key, JSON.stringify(list)) } catch { /* noop */ }
  }, [])

  onRemote.current = (prev, next) => {
    const meId = meRef.current?.id
    if (!meId || !notifKeyRef.current) return
    const fresh = diffNotifications(prev, next, meId)
    if (!fresh.length) return
    setNotifications((cur) => { const merged = mergeNotifications(cur, fresh); persistNotifs(merged); return merged })
    if (document.visibilityState === 'visible') setToast(fresh[0])
    else if (prefsRef.current.systemNotif) for (const n of fresh.slice(0, 3)) void systemNotify(n)
  }
  const markRead = useCallback((id: string) => setNotifications((cur) => { const n = cur.map((x) => (x.id === id ? { ...x, read: true } : x)); persistNotifs(n); return n }), [persistNotifs])
  const markAllRead = useCallback(() => setNotifications((cur) => { const n = cur.map((x) => ({ ...x, read: true })); persistNotifs(n); return n }), [persistNotifs])
  const clearNotifications = useCallback(() => { setNotifications([]); persistNotifs([]) }, [persistNotifs])
  const dismissToast = useCallback(() => setToast(null), [])
  const [centerOpen, setCenterOpen] = useState(false)
  const unread = useMemo(() => notifications.filter((n) => !n.read).length, [notifications])

  const startFresh = useCallback(() => {
    const keepEmail = meRef.current?.email ?? engine.getSnapshot().email ?? undefined
    apply(() => emptyDb(t('La nostra famiglia'), meRef.current?.name ?? 'Io', keepEmail), true)
  }, [apply])
  const importDatabase = useCallback((next: AppDatabase) => apply((prev) => mergeDatabases(prev, next), true), [apply])

  const value = useMemo<Store>(
    () => ({ db, members, me, commit, sync, cacheOk, prefs, setPrefs, notifications, unread, markRead, markAllRead, clearNotifications, toast, dismissToast, centerOpen, setCenterOpen, startFresh, importDatabase }),
    [db, members, me, commit, sync, cacheOk, prefs, setPrefs, notifications, unread, markRead, markAllRead, clearNotifications, toast, dismissToast, centerOpen, startFresh, importDatabase],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

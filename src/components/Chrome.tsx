import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell, CalendarDays, Cloud, CloudAlert, CloudOff, HousePlus, Loader2, Plus, RefreshCw, ShoppingBasket, Star, Users, UtensilsCrossed } from 'lucide-react'
import type { ComponentType } from 'react'
import { useStore } from '../state/store'
import { engine, type SyncStatus } from '../sync/engine'
import { useUi, type Tab } from '../state/ui'
import { useOverlay } from '../state/overlay'

/* ---------- Sfondo vivo: 3 blob sfocati animati con sole transform (§1.4) ---------- */
export function Background() {
  const blob = (v: string) => ({ background: `rgb(var(--${v}))` })
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-bg">
      <div className="absolute -left-24 -top-24 h-96 w-96 animate-float1 rounded-full blur-3xl" style={blob('blob-a')} />
      <div className="absolute -right-32 top-1/4 h-[28rem] w-[28rem] animate-float2 rounded-full blur-3xl" style={blob('blob-b')} />
      <div className="absolute -bottom-32 left-1/4 h-[30rem] w-[30rem] animate-float3 rounded-full blur-3xl" style={blob('blob-c')} />
    </div>
  )
}

/* ---------- Bottom navigation fluttuante con indicatore "a goccia" (§2.4) ---------- */
const TABS: { id: Tab; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { id: 'today', label: 'Oggi', icon: UtensilsCrossed },
  { id: 'week', label: 'Settimana', icon: CalendarDays },
  { id: 'shop', label: 'Spesa', icon: ShoppingBasket },
  { id: 'family', label: 'Famiglia', icon: Users },
]

export function BottomNav({ shopBadge }: { shopBadge: number }) {
  const { tab, setTab } = useUi()
  return (
    <nav className="glass absolute inset-x-4 bottom-4 z-40 flex items-center justify-between !rounded-full p-1.5"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }} aria-label="Navigazione principale">
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = tab === id
        return (
          <button key={id} onClick={() => setTab(id)} aria-label={label} aria-current={active ? 'page' : undefined}
            className="relative flex flex-1 flex-col items-center gap-0.5 rounded-full py-2 transition active:scale-90">
            {active && (
              <motion.span layoutId="nav-drop" className="glass-active absolute inset-0 rounded-full"
                transition={{ type: 'spring', stiffness: 420, damping: 30, mass: 0.9 }} />
            )}
            <span className={`relative ${active ? 'text-brand' : 'text-muted'}`}>
              <Icon size={22} strokeWidth={active ? 2.6 : 2.1} />
              {id === 'shop' && shopBadge > 0 && (
                <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-exp px-1 text-[10px] font-bold text-onbrand">{shopBadge}</span>
              )}
            </span>
            <span className={`relative text-[10px] font-semibold ${active ? 'text-brand' : 'text-muted'}`}>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}

/* ---------- FAB (portal su #shell-overlay, §2.5) ---------- */
export function Fab({ onClick, label, icon }: { onClick: () => void; label: string; icon?: React.ReactNode }) {
  const host = useOverlay().overlay
  if (!host) return null
  return createPortal(
    <motion.button whileTap={{ scale: 0.9 }} onClick={onClick} aria-label={label}
      className="glass-btn btn-primary pointer-events-auto absolute right-5 !h-14 !w-14 !p-0"
      style={{ bottom: 'calc(5.75rem + env(safe-area-inset-bottom))' }}>
      {icon ?? <Plus size={26} strokeWidth={2.6} />}
    </motion.button>,
    host,
  )
}

/* ---------- Pillola di stato sync + campanella (header) ---------- */
const SYNC_UI: Record<SyncStatus, { label: string; cls: string; icon: ComponentType<{ size?: number; className?: string }> }> = {
  off: { label: 'Locale', cls: 'text-muted', icon: HousePlus },
  pending: { label: 'Da inviare', cls: 'text-brand', icon: RefreshCw },
  syncing: { label: 'Sync…', cls: 'text-brand', icon: Loader2 },
  synced: { label: 'Sincronizzato', cls: 'text-inc', icon: Cloud },
  offline: { label: 'Offline', cls: 'text-muted', icon: CloudOff },
  error: { label: 'Errore', cls: 'text-exp', icon: CloudAlert },
  auth: { label: 'Accedi', cls: 'text-brand', icon: CloudAlert },
}

export function SyncPill() {
  const { sync } = useStore()
  const { setConnectOpen, showToast } = useUi()
  const s = SYNC_UI[sync.status]
  const Icon = s.icon
  const onClick = () => {
    if (!sync.fileId) return setConnectOpen(true)
    if (sync.status === 'auth') return void engine.signIn().catch((e: Error) => showToast(e.message))
    void engine.syncNow()
  }
  return (
    <button onClick={onClick} className={`glass-btn !px-3 !py-1.5 text-xs ${s.cls}`} aria-label={`Sincronizzazione: ${s.label}. Tocca per ${sync.fileId ? 'sincronizzare' : 'collegare Google Drive'}`}>
      <Icon size={15} className={sync.status === 'syncing' ? 'animate-spin' : ''} />
      <span>{s.label}</span>
    </button>
  )
}

export function NotificationBell() {
  const { unread, setCenterOpen } = useStore()
  return (
    <button className="glass-btn relative !h-9 !w-9 !p-0" aria-label={unread ? `Notifiche (${unread} non lette)` : 'Notifiche'} onClick={() => setCenterOpen(true)}>
      <Bell size={17} />
      {unread > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-exp px-1 text-[10px] font-bold text-onbrand">{unread > 9 ? '9+' : unread}</span>}
    </button>
  )
}

/** Azioni a destra dell'header di ogni schermata. */
export function HeaderActions() {
  return <><NotificationBell /><SyncPill /></>
}

/* ---------- Toast ---------- */
export function Toast() {
  const { toast } = useUi()
  return (
    <AnimatePresence>
      {toast && (
        <motion.div key={toast} role="status"
          className="glass-strong absolute inset-x-6 top-4 z-[70] px-4 py-3 text-center text-sm font-semibold"
          style={{ marginTop: 'env(safe-area-inset-top)' }}
          initial={{ opacity: 0, y: -20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12 }}>
          {toast}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ---------- Celebrazione (coriandoli a stella dal punto del tocco, §3.3) ---------- */
const CONFETTI = ['#d9772b', '#e6bb78', '#c0283f', '#2a6b99', '#23764b']
export function Celebration() {
  const { celebration } = useUi()
  return (
    <AnimatePresence>
      {celebration && (
        <div key={celebration.key} className="pointer-events-none fixed inset-0 z-[80]">
          {Array.from({ length: 16 }, (_, i) => {
            const a = (i / 16) * Math.PI * 2 + (i % 3) * 0.3
            const r = 50 + ((i * 37) % 90)
            return (
              <motion.span key={i} className="absolute" style={{ left: celebration.x, top: celebration.y, color: CONFETTI[i % CONFETTI.length] }}
                initial={{ x: 0, y: 0, opacity: 1, scale: 0.4, rotate: 0 }}
                animate={{ x: Math.cos(a) * r, y: Math.sin(a) * r, opacity: 0, scale: 1, rotate: 180 + i * 20 }}
                transition={{ duration: 0.9, ease: 'easeOut' }}>
                <Star size={14} className="fill-current" />
              </motion.span>
            )
          })}
          <motion.div className="absolute -translate-x-1/2 rounded-full bg-brand px-3 py-1 text-sm font-extrabold text-onbrand"
            style={{ left: celebration.x, top: celebration.y }}
            initial={{ y: 0, opacity: 1 }} animate={{ y: -70, opacity: 0 }} transition={{ duration: 1.1 }}>
            {celebration.label}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

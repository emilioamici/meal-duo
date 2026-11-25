import { AnimatePresence, motion } from 'framer-motion'
import { CalendarDays, ShoppingBasket, SquareCheckBig, X } from 'lucide-react'
import { MascotImg } from './Mascots'
import { Sheet } from './ui'
import { useStore } from '../state/store'
import { useUi } from '../state/ui'
import type { Notif } from '../lib/notifications'
import { t, locale } from '../i18n'

const ago = (iso: string): string => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return t('ora')
  if (m < 60) return t('{n} min fa', { n: m })
  if (m < 1440) return t('{n} h fa', { n: Math.round(m / 60) })
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(new Date(iso))
}

const Icon = ({ n }: { n: Notif }) => (
  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${n.kind === 'plan' ? 'bg-brand/15 text-brand' : 'bg-inc/15 text-inc'}`}>
    {n.kind === 'plan' ? <CalendarDays size={18} /> : n.kind === 'check' ? <SquareCheckBig size={18} /> : <ShoppingBasket size={18} />}
  </span>
)

/** Elenco delle notifiche; toccandone una si apre la schermata relativa (spesa o giorno del piano). */
export function NotificationCenter() {
  const { notifications, centerOpen, setCenterOpen, markRead, markAllRead, clearNotifications, unread } = useStore()
  const { setTab, setDay, setMemberId } = useUi()
  const open = (n: Notif) => {
    markRead(n.id)
    setCenterOpen(false)
    if (n.kind === 'plan') { if (n.memberId) setMemberId(n.memberId); if (n.day !== undefined) setDay(n.day); setTab('today') } else setTab('shop')
  }
  return (
    <Sheet open={centerOpen} onClose={() => setCenterOpen(false)} title={t('Notifiche')}>
      {notifications.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted">
          <MascotImg kind="mochi-milk" className="mx-auto mb-3 h-24 w-auto" />
          <p className="font-semibold text-ink">{t('Nessuna notifica')}</p>
          <p className="mx-auto mt-1 max-w-xs">{t('Ti avviso quando un altro membro aggiunge una voce alla spesa, spunta un articolo o modifica il tuo piano.')}</p>
        </div>
      ) : (
        <>
          <ul className="-mx-2 divide-y divide-line/50">
            {notifications.map((n) => (
              <li key={n.id}>
                <button className="flex w-full items-start gap-3 rounded-xl px-2 py-3 text-left active:bg-line/30" onClick={() => open(n)}>
                  <Icon n={n} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${n.read ? 'font-medium' : 'font-bold'}`}>{n.title}</span>
                    <span className="block text-xs text-muted">{n.body}</span>
                    <span className="mt-0.5 block text-[11px] text-muted">{ago(n.at)}</span>
                  </span>
                  {!n.read && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand" aria-label={t('Non letta')} />}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button className="glass-btn flex-1" disabled={unread === 0} onClick={markAllRead}>{t('Segna tutte come lette')}</button>
            <button className="glass-btn" onClick={clearNotifications}>{t('Svuota')}</button>
          </div>
        </>
      )}
    </Sheet>
  )
}

/** Avviso in primo piano quando arriva una nuova notifica mentre l'app è aperta. */
export function NotificationToast() {
  const { toast, dismissToast, setCenterOpen } = useStore()
  return (
    <AnimatePresence>
      {toast && (
        <motion.div key={toast.id} role="status" aria-live="polite"
          className="glass-strong absolute inset-x-4 top-4 z-[65] flex items-start gap-3 p-3 md:inset-x-auto md:right-6 md:top-6 md:w-96" style={{ marginTop: 'env(safe-area-inset-top)' }}
          initial={{ opacity: 0, y: -20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}>
          <button className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => { dismissToast(); setCenterOpen(true) }}>
            <Icon n={toast} />
            <span className="min-w-0"><span className="block text-sm font-bold">{toast.title}</span><span className="block truncate text-xs text-muted">{toast.body}</span></span>
          </button>
          <button className="rounded-full p-1 text-muted active:bg-line/60" aria-label={t('Chiudi')} onClick={dismissToast}><X size={16} /></button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

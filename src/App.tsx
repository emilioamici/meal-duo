import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { Background, BottomNav, Celebration, Toast } from './components/Chrome'
import { StoreProvider, useStore } from './state/store'
import { UiProvider, useUi } from './state/ui'
import { TodayView } from './views/TodayView'
import { WeekView } from './views/WeekView'
import { ShoppingView } from './views/ShoppingView'
import { SettingsView } from './views/SettingsView'
import { OverlayCtx } from './state/overlay'
import { ConnectSheet } from './components/ConnectSheet'
import { IdentityGuard } from './components/IdentityGuard'
import { NotificationCenter, NotificationToast } from './components/Notifications'
import { useLang } from './i18n'
import { Gate } from './components/Gate'
import { isLocalMode } from './lib/localMode'
import { pendingInvite } from './sync/invite'
import { isPristine } from './services/dbOps'
import { buildShoppingList, shoppingProgress } from './services/shoppingListEngine'

function AppShell() {
  const { tab } = useUi()
  const { db } = useStore()
  const { filters } = useUi()
  const scroller = useRef<HTMLDivElement>(null)
  const [overlay, setOverlay] = useState<HTMLElement | null>(null)
  const hosts = useMemo(() => ({ overlay }), [overlay])
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }) }, [tab])

  const badge = useMemo(() => {
    const p = shoppingProgress(db, buildShoppingList(db, filters))
    return p.total - p.done
  }, [db, filters])

  return (
    <OverlayCtx.Provider value={hosts}>
      <Background />
      <div className="mx-auto flex h-full max-w-md items-stretch md:items-center">
        <div className="relative h-full w-full overflow-hidden md:h-[min(52rem,calc(100dvh-2rem))] md:rounded-[2.75rem] md:border md:border-line md:shadow-[0_40px_100px_-20px_rgb(var(--glass-shade))]">
          <div ref={scroller} className="h-full overflow-y-auto overscroll-contain px-4 pt-safe pb-32">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={tab} className="pt-4"
                initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -6, filter: 'blur(6px)' }} transition={{ duration: 0.18 }}>
                {tab === 'today' && <TodayView />}
                {tab === 'week' && <WeekView />}
                {tab === 'shop' && <ShoppingView />}
                {tab === 'settings' && <SettingsView />}
              </motion.div>
            </AnimatePresence>
          </div>
          <div id="shell-overlay" ref={setOverlay} className="pointer-events-none absolute inset-0 z-30" />
          <BottomNav shopBadge={badge} />
          <Toast />
          <NotificationToast />
          <NotificationCenter />
          <ConnectSheet />
          <IdentityGuard />
        </div>
      </div>
      <Celebration />
    </OverlayCtx.Provider>
  )
}

/**
 * Senza un database collegato si passa dal Gate (login Google); con il database collegato l'app funziona anche offline.
 * Sessione scaduta (con famiglia collegata): il Gate di riconnessione copre tutto e i dati non si vedono; l'app resta montata sotto,
 * inerte, così quello che stavi scrivendo non si perde e dopo l'accesso si riprende da dove si era.
 */
function Root() {
  const { sync, db } = useStore()
  useLang() // al cambio lingua si ridisegna tutto
  const [local, setLocal] = useState(() => !pendingInvite() && (isLocalMode() || !isPristine(db))) // chi ha già dati propri non vede il Gate; un invito lo apre sempre
  if (!sync.fileId && !local) return <><Background /><Gate onLocal={() => setLocal(true)} /></>
  const locked = !!sync.fileId && sync.status === 'auth'
  return (
    <>
      <div className="h-full" aria-hidden={locked || undefined} {...(locked ? { inert: true } : {})}><AppShell /></div>
      {locked && <div className="fixed inset-0 z-[100] overflow-y-auto bg-bg" data-testid="login-overlay"><Gate reconnect /></div>}
    </>
  )
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <StoreProvider>
        <UiProvider>
          <Root />
        </UiProvider>
      </StoreProvider>
    </MotionConfig>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { Background, BottomNav, Celebration, SideNav, Toast } from './components/Chrome'
import { StoreProvider, useStore } from './state/store'
import { UiProvider, useUi, type Tab } from './state/ui'
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
  const { tab, setTab } = useUi()
  const { db } = useStore()
  const { filters } = useUi()
  const scroller = useRef<HTMLDivElement>(null)
  const [overlay, setOverlay] = useState<HTMLElement | null>(null)
  const hosts = useMemo(() => ({ overlay }), [overlay])
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }) }, [tab])

  // da tastiera (PC): 1–4 cambiano schermata, se non si sta scrivendo e non c'è un foglio aperto
  useEffect(() => {
    const order: Tab[] = ['today', 'week', 'shop', 'settings']
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      if (document.querySelector('[role="dialog"]')) return
      const i = ['1', '2', '3', '4'].indexOf(e.key)
      if (i >= 0) setTab(order[i])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setTab])

  const badge = useMemo(() => {
    const p = shoppingProgress(db, buildShoppingList(db, filters))
    return p.total - p.done
  }, [db, filters])

  return (
    <OverlayCtx.Provider value={hosts}>
      <Background />
      {/* telefono: una colonna con la barra in basso; da 768 px barra laterale e contenuto a tutta larghezza (colonne su schermi larghi) */}
      <div className="mx-auto flex h-full max-w-md md:max-w-none">
        <SideNav shopBadge={badge} />
        <div className="relative h-full min-w-0 flex-1 overflow-hidden">
          <div ref={scroller} className="h-full overflow-y-auto overscroll-contain px-4 pt-safe pb-32 md:px-8 md:pb-24 lg:px-10">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={tab} className="mx-auto w-full max-w-md pt-4 md:max-w-3xl md:pt-6 lg:max-w-6xl"
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

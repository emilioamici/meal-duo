import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DayIndex, ShoppingFilters } from '../types'
import { todayIndex } from '../lib/ids'

export type Tab = 'today' | 'week' | 'shop' | 'family'

export interface CelebrationEvent { key: number; x: number; y: number; label: string }

interface Ui {
  tab: Tab
  setTab: (t: Tab) => void
  memberId: string | undefined
  setMemberId: (id: string) => void
  day: DayIndex
  setDay: (d: DayIndex) => void
  filters: ShoppingFilters
  setFilters: (f: ShoppingFilters) => void
  grouped: boolean
  setGrouped: (g: boolean) => void
  toast: string | null
  showToast: (msg: string) => void
  celebration: CelebrationEvent | null
  connectOpen: boolean
  setConnectOpen: (o: boolean) => void
  celebrate: (x: number, y: number, label: string) => void
}

const Ctx = createContext<Ui | null>(null)
export const useUi = (): Ui => {
  const c = useContext(Ctx)
  if (!c) throw new Error('UiProvider mancante')
  return c
}

function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : initial } catch { return initial }
  })
  const set = useCallback((n: T) => { setV(n); try { localStorage.setItem(key, JSON.stringify(n)) } catch { /* ignore */ } }, [key])
  return [v, set]
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<Tab>('today')
  const [memberId, setMemberId] = usePersisted<string | undefined>('mealduo:member', undefined)
  const [day, setDay] = useState<DayIndex>(todayIndex())          // focus automatico sul giorno corrente
  const [filters, setFilters] = usePersisted<ShoppingFilters>('mealduo:filters', { excludedMemberIds: [], excludedDays: [] })
  const [grouped, setGrouped] = usePersisted<boolean>('mealduo:grouped', false)
  const [toast, setToast] = useState<string | null>(null)
  const [celebration, setCelebration] = useState<CelebrationEvent | null>(null)
  // dopo il ritorno dal login con il Worker (redirect) si riapre da solo il flusso di collegamento
  const [connectOpen, setConnectOpen] = useState<boolean>(() => {
    try { const r = sessionStorage.getItem('mealduo:resume-connect') === '1'; sessionStorage.removeItem('mealduo:resume-connect'); return r } catch { return false }
  })

  const showToast = useCallback((msg: string) => setToast(msg), [])
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(t)
  }, [toast])

  const celebrate = useCallback((x: number, y: number, label: string) => {
    try { navigator.vibrate?.([18, 40, 24]) } catch { /* iOS: non supportato */ }
    setCelebration({ key: Date.now(), x, y, label })
  }, [])
  useEffect(() => {
    if (!celebration) return
    const t = window.setTimeout(() => setCelebration(null), 1400)
    return () => window.clearTimeout(t)
  }, [celebration])

  const value = useMemo<Ui>(() => ({ tab, setTab, memberId, setMemberId, day, setDay, filters, setFilters, grouped, setGrouped, toast, showToast, celebration, celebrate, connectOpen, setConnectOpen }),
    [tab, memberId, setMemberId, day, filters, setFilters, grouped, setGrouped, toast, showToast, celebration, celebrate, connectOpen])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

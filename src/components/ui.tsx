import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useOverlay } from '../state/overlay'
import { AnimatePresence, motion, useDragControls } from 'framer-motion'
import { ChevronDown, X } from 'lucide-react'
import type { Member } from '../types'

/* ---------- Avatar (colore scelto dall'utente: eccezione hex ammessa, §0.2) ---------- */
export function Avatar({ member, size = 28 }: { member?: Pick<Member, 'name' | 'color'>; size?: number }) {
  return (
    <span aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow-inner"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `linear-gradient(135deg, ${member?.color ?? '#cbd5e1'}, ${member?.color ?? '#cbd5e1'}aa)` }}
    >
      {(member?.name ?? '?').trim().charAt(0).toUpperCase()}
    </span>
  )
}

/* ---------- Barra di progresso ---------- */
export function CleanBar({ pct, height = 8 }: { pct: number; height?: number }) {
  const hue = Math.round((Math.max(0, Math.min(100, pct)) / 100) * 140)
  return (
    <div className="w-full overflow-hidden rounded-full bg-line" style={{ height }}>
      <motion.div className="h-full rounded-full" initial={false}
        animate={{ width: `${pct}%`, backgroundColor: `hsl(${hue} 58% 48%)` }}
        transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
    </div>
  )
}

/* ---------- Segmented ---------- */
export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const lid = `seg-${options.map((x) => x.id).join('-')}`
  return (
    <div className="relative flex rounded-full border border-line bg-line/40 p-1">
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)}
          className="relative flex-1 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold transition active:scale-95">
          {value === o.id && (
            <motion.span layoutId={lid} className="absolute inset-0 rounded-full bg-surface shadow-[0_2px_8px_rgb(var(--ink)/0.15)]"
              transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
          )}
          <span className={`relative ${value === o.id ? '' : 'text-muted'}`}>{o.label}</span>
        </button>
      ))}
    </div>
  )
}

/* ---------- Header (statico, scorre con il contenuto) ---------- */
export function PageHeader({ title, subtitle, left, right }: { title: string; subtitle?: string; left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3 pb-4 pt-2">
      <div className="flex min-w-0 items-center gap-2">
        {left}
        <div className="min-w-0">
          <h1 className="truncate text-3xl font-extrabold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">{right}</div>
    </header>
  )
}

/* ---------- Toggle ---------- */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand' : 'bg-line'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  )
}

/* ---------- Accordion (stato ricordato in localStorage) ---------- */
export function Accordion({ id, title, icon, summary, defaultOpen = false, children }: { id: string; title: string; icon: ReactNode; summary?: string; defaultOpen?: boolean; children: ReactNode }) {
  const key = `mealduo:acc:${id}`
  const [open, setOpen] = useState<boolean>(() => {
    try { const v = localStorage.getItem(key); return v === null ? defaultOpen : v === '1' } catch { return defaultOpen }
  })
  const toggle = () => { setOpen(!open); try { localStorage.setItem(key, open ? '0' : '1') } catch { /* ignore */ } }
  return (
    <section className="card overflow-hidden" data-open={open || undefined}>
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left active:bg-line/30">
        <span className="text-brand">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{title}</span>
          {summary && !open && <span className="block truncate text-xs text-muted">{summary}</span>}
        </span>
        <ChevronDown size={20} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="border-t border-line/60 p-4">{children}</div>}
    </section>
  )
}

/* ---------- Bottom sheet (§3.4) ---------- */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const controls = useDragControls()
  const { sheets } = useOverlay()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!sheets) return null
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center md:absolute">
          <motion.div className="absolute inset-0 bg-ink/30 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            role="dialog" aria-modal="true" aria-label={title}
            className="glass-strong relative z-10 flex max-h-[92%] w-full max-w-md flex-col rounded-b-none"
            initial={{ y: 48, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            drag="y" dragControls={controls} dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, i) => { if (i.offset.y > 120 || i.velocity.y > 600) onClose() }}>
            <div className="flex cursor-grab touch-none justify-center pb-1 pt-3" onPointerDown={(e) => controls.start(e)}>
              <div className="h-1.5 w-10 rounded-full bg-muted/50" />
            </div>
            <div className="flex items-center justify-between px-5 pb-1">
              <h2 className="text-xl font-bold">{title}</h2>
              <button onClick={onClose} className="glass-btn !p-2" aria-label="Chiudi"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto px-5 pb-8 pt-1 pb-safe">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    sheets,
  )
}

/* ---------- Pulsante a due tocchi per azioni distruttive ---------- */
export function ConfirmButton({ label, confirmLabel = 'Tocca ancora per confermare', onConfirm, className = '' }: { label: ReactNode; confirmLabel?: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 3500)
    return () => window.clearTimeout(t)
  }, [armed])
  return (
    <button type="button" className={`glass-btn btn-danger ${className}`} onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>
      {armed ? confirmLabel : label}
    </button>
  )
}

export function EmptyCard({ mascot, title, text }: { mascot: ReactNode; title: string; text: string }) {
  return (
    <div className="card py-8 text-center">
      {mascot}
      <p className="mt-2 font-bold">{title}</p>
      <p className="mx-auto mt-0.5 max-w-[16rem] text-sm text-muted">{text}</p>
    </div>
  )
}

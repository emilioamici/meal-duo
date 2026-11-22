import { useMemo, useState } from 'react'
import { AnimatePresence, motion, useAnimationControls, useMotionValue, useTransform } from 'framer-motion'
import { Check, Plus, RotateCcw, ShoppingCart, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { PageHeader, CleanBar, Segmented, Sheet, ConfirmButton, EmptyCard, Avatar, Accordion } from '../components/ui'
import { Fab, HeaderActions } from '../components/Chrome'
import { MascotImg, MascotPeek } from '../components/Mascots'
import { useStore } from '../state/store'
import { useUi } from '../state/ui'
import { DAY_INDEXES, type DayIndex, type ExtraItem, type Member, type ShoppingLine } from '../types'
import { buildShoppingList, extraChecked, groupByCategory, liveExtras, shoppingProgress } from '../services/shoppingListEngine'
import { addExtra, checkLine, hideLine, removeExtra, resetShopping, restoreLines, setPurchaseQuantity, toggleExtra, uncheckLine } from '../services/dbOps'
import { PantryPanel } from '../components/PantryPanel'
import { formatCompact, formatQuantity, round2 } from '../lib/units'
import { t, dayShort, tp } from '../i18n'

export function ShoppingView() {
  const { db, members, commit } = useStore()
  const { filters, setFilters, grouped, setGrouped, celebrate } = useUi()
  const [extraOpen, setExtraOpen] = useState(false)
  const [mode, setMode] = useState<'list' | 'pantry'>('list')
  const [drafts, setDrafts] = useState<Record<string, string>>({}) // quantità modificate in lista, finché non si spunta

  const lines = useMemo(() => buildShoppingList(db, filters), [db, filters])
  const hiddenKeys = useMemo(() => buildShoppingList(db, filters, true).filter((l) => l.hidden).map((l) => l.key), [db, filters])
  const extras = liveExtras(db)
  const progress = shoppingProgress(db, lines)
  const memberMap = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const sections = grouped ? groupByCategory(lines) : [{ category: '', lines }]

  const toggleMember = (id: string) => setFilters({ ...filters, excludedMemberIds: filters.excludedMemberIds.includes(id) ? filters.excludedMemberIds.filter((x) => x !== id) : [...filters.excludedMemberIds, id] })
  const toggleDay = (d: DayIndex) => setFilters({ ...filters, excludedDays: filters.excludedDays.includes(d) ? filters.excludedDays.filter((x) => x !== d) : [...filters.excludedDays, d] })
  const setDays = (included: DayIndex[]) => setFilters({ ...filters, excludedDays: DAY_INDEXES.filter((d) => !included.includes(d)) })
  const includedDays = DAY_INDEXES.filter((d) => !filters.excludedDays.includes(d))
  const sameDays = (a: DayIndex[]) => a.length === includedDays.length && a.every((d) => includedDays.includes(d))

  const celebrateIfDone = (e: React.MouseEvent, willBeDone: number) => {
    if (progress.total > 0 && willBeDone === progress.total) celebrate(e.clientX, e.clientY, t('Spesa completata!'))
  }
  /** quantità proposta: quanto serve, o quanto manca se in casa ce n'è già un po' */
  const proposed = (l: ShoppingLine) => (l.inPantry > 0 && l.total > l.inPantry ? round2(l.total - l.inPantry) : l.total)
  const purchaseOf = (l: ShoppingLine) => db.pantry.purchases[`${l.key}|${db.shopping.resetAt}`]
  const shownQty = (l: ShoppingLine) => drafts[l.key] ?? String(l.checked ? purchaseOf(l)?.quantity ?? '' : proposed(l))
  const parseQty = (v: string | undefined): number | null => {
    const n = Number((v ?? '').replace(',', '.'))
    return v !== undefined && v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null
  }
  const dropDraft = (key: string) => setDrafts((d) => { const { [key]: _gone, ...rest } = d; return rest })
  const onToggleLine = (e: React.MouseEvent, l: ShoppingLine) => {
    if (l.checked) { dropDraft(l.key); return commit((d) => uncheckLine(d, l.key)) }
    const qty = parseQty(drafts[l.key]) ?? proposed(l) // quanto scritto in lista, altrimenti quanto propone l'app: entra in dispensa
    commit((d) => checkLine(d, l, qty > 0 ? qty : null))
    dropDraft(l.key)
    celebrateIfDone(e, progress.done + 1)
  }
  const onQtyBlur = (l: ShoppingLine) => {
    if (!l.checked || drafts[l.key] === undefined) return
    const n = parseQty(drafts[l.key])
    if (n !== null) commit((d) => setPurchaseQuantity(d, l, n))
    dropDraft(l.key)
  }
  const onToggleExtra = (e: React.MouseEvent, x: ExtraItem) => {
    const was = extraChecked(db, x)
    commit((d) => toggleExtra(d, x.id, !was))
    if (!was) celebrateIfDone(e, progress.done + 1)
  }

  const remaining = progress.total - progress.done
  const filterSummary = `${tp(members.length - filters.excludedMemberIds.length, '{n} persona', '{n} persone', { n: members.length - filters.excludedMemberIds.length })} · ${tp(DAY_INDEXES.length - filters.excludedDays.length, '{n} giorno', '{n} giorni', { n: DAY_INDEXES.length - filters.excludedDays.length })}`
  const excludedCount = filters.excludedMemberIds.length + filters.excludedDays.length

  return (
    <>
      <PageHeader title={t('Spesa')} subtitle={progress.total === 0 ? t('Nessun articolo') : remaining === 0 ? t('Tutto nel carrello!') : t('{n} da comprare', { n: remaining })} right={<HeaderActions />} />

      <Segmented value={mode} onChange={(v) => setMode(v as 'list' | 'pantry')} options={[{ id: 'list', label: t('Lista') }, { id: 'pantry', label: t('Dispensa') }]} />

      {mode === 'pantry' ? <PantryPanel fabOpen /> : <>
      <MascotPeek kind="zenitsu" side="left">
        <div className="card p-4">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-4xl font-extrabold leading-none">{remaining}</p>
              <p className="mt-1 text-sm text-muted">{t('articoli da comprare')}{excludedCount > 0 && <span className="font-semibold text-brand"> {t('· filtri attivi')}</span>}</p>
            </div>
            <p className="text-sm font-semibold text-muted">{progress.done}/{progress.total}</p>
          </div>
          <div className="mt-3"><CleanBar pct={progress.pct} height={10} /></div>
        </div>
      </MascotPeek>

      {/* ---- Barra filtri: escludi membri / giorni ---- */}
      <div className="mt-3">
      <Accordion id="shop-filters" title={t('Filtri di calcolo')} icon={<SlidersHorizontal size={20} />} summary={filterSummary} defaultOpen>
        <p className="label !mt-0">{t('Per chi')}</p>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {members.map((m) => {
            const on = !filters.excludedMemberIds.includes(m.id)
            return (
              <button key={m.id} aria-pressed={on} onClick={() => toggleMember(m.id)} className={`chip !pl-1.5 ${on ? 'chip-active' : 'opacity-70'}`}>
                <Avatar member={m} size={22} />{m.name}{!on && <X size={14} />}
              </button>
            )
          })}
        </div>
        <p className="label">{t('Giorni')}</p>
        <div className="grid grid-cols-7 gap-1.5">
          {DAY_INDEXES.map((d) => {
            const on = !filters.excludedDays.includes(d)
            return <button key={d} aria-pressed={on} onClick={() => toggleDay(d)} className={`chip justify-center !px-0 !text-xs ${on ? 'chip-active' : 'opacity-70'}`}>{dayShort(d)}</button>
          })}
        </div>
        <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
          <button className={`chip !text-xs ${sameDays([0, 1, 2, 3, 4, 5, 6]) ? 'border-brand' : ''}`} onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])}>{t('Tutta la settimana')}</button>
          <button className={`chip !text-xs ${sameDays([0, 1, 2, 3, 4]) ? 'border-brand' : ''}`} onClick={() => setDays([0, 1, 2, 3, 4])}>{t('Senza weekend')}</button>
          <button className={`chip !text-xs ${sameDays([0, 1, 2, 3]) ? 'border-brand' : ''}`} onClick={() => setDays([0, 1, 2, 3])}>{t('Lun–Gio')}</button>
          {excludedCount > 0 && <button className="chip !text-xs text-brand" onClick={() => setFilters({ excludedMemberIds: [], excludedDays: [] })}><RotateCcw size={13} />{t('Azzera filtri')}</button>}
        </div>
        <div className="mt-3">
          <Segmented value={grouped ? 'cat' : 'az'} onChange={(v) => setGrouped(v === 'cat')} options={[{ id: 'az', label: t('A–Z') }, { id: 'cat', label: t('Per categoria') }]} />
        </div>
      </Accordion>
      </div>

      {/* ---- Lista aggregata ---- */}
      <div className="mt-3 space-y-3">
        {lines.length === 0 && (
          <EmptyCard mascot={<MascotImg kind="mochi" className="mx-auto h-16 w-auto" />} title={t('Niente da comprare')}
            text={excludedCount > 0 ? t('I filtri attuali escludono tutti i piani: riattiva qualche membro o giorno.') : t('Aggiungi alimenti ai piani per generare la spesa.')} />
        )}
        {sections.map((s) => (
          <div key={s.category || 'all'}>
            {s.category && <h2 className="mb-2 mt-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted">{t(s.category)}</h2>}
            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {s.lines.map((l) => (
                  <motion.li key={l.key} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 90, scale: 0.92 }} transition={{ type: 'spring', stiffness: 400, damping: 34 }}>
                    <SwipeRow label={t('Rimuovi {name}', { name: l.name })} onDelete={() => commit((d) => hideLine(d, l.key))}>
                      <div className={`card flex items-start gap-3 p-3 ${l.checked ? 'opacity-60' : ''}`}>
                        <CheckButton checked={l.checked} label={t(l.checked ? '{name}: da comprare' : '{name}: preso', { name: l.name })} onClick={(e) => onToggleLine(e, l)} />
                        <div className="min-w-0 flex-1 pt-0.5">
                          <div className="flex items-center justify-between gap-3">
                            <span className={`min-w-0 truncate font-semibold leading-tight ${l.checked ? 'line-through' : ''}`}>{l.name}</span>
                            <span className="flex shrink-0 items-baseline gap-1">
                              <input className="w-[4.5rem] rounded-xl border border-line bg-bg px-2 py-1 text-right font-extrabold" inputMode="decimal" value={shownQty(l)} aria-label={t('Quantità di {name}', { name: l.name })}
                                onPointerDown={(e) => e.stopPropagation()} onFocus={(e) => e.currentTarget.select()}
                                onChange={(e) => setDrafts((d) => ({ ...d, [l.key]: e.target.value }))} onBlur={() => onQtyBlur(l)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
                              <span className="text-sm font-semibold text-muted">{l.unit}</span>
                            </span>
                          </div>
                          <p className="mt-1 text-xs font-semibold text-muted">
                            {t('Servono {qty}', { qty: formatQuantity(l.total, l.unit) })}{l.inPantry > 0 && ` · ${t('In dispensa: {qty}', { qty: formatQuantity(l.inPantry, l.unit) })}`}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {l.perMember.map((p) => <MemberBadge key={p.memberId} member={memberMap.get(p.memberId)} text={formatCompact(p.quantity, l.unit)} />)}
                          </div>
                        </div>
                      </div>
                    </SwipeRow>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        ))}

        {extras.length > 0 && (
          <div>
            <h2 className="mb-2 mt-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted">{t('Extra')}</h2>
            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {extras.map((x) => {
                  const done = extraChecked(db, x)
                  return (
                    <motion.li key={x.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 90, scale: 0.92 }} transition={{ type: 'spring', stiffness: 400, damping: 34 }}>
                      <SwipeRow label={t('Rimuovi {name}', { name: x.name })} onDelete={() => commit((d) => removeExtra(d, x.id))}>
                        <div className={`card flex items-center gap-3 p-3 ${done ? 'opacity-60' : ''}`}>
                          <CheckButton checked={done} label={t(done ? '{name}: da comprare' : '{name}: preso', { name: x.name })} onClick={(e) => onToggleExtra(e, x)} />
                          <span className={`min-w-0 flex-1 truncate font-semibold ${done ? 'line-through' : ''}`}>{x.name}{x.quantity && <span className="ml-2 text-sm font-medium text-muted">{x.quantity}</span>}</span>
                        </div>
                      </SwipeRow>
                    </motion.li>
                  )
                })}
              </AnimatePresence>
            </ul>
          </div>
        )}

        {hiddenKeys.length > 0 && (
          <button className="glass-btn w-full" onClick={() => commit((d) => restoreLines(d, hiddenKeys))}>
            <RotateCcw size={16} />{tp(hiddenKeys.length, '{n} articolo eliminato · Ripristina', '{n} articoli eliminati · Ripristina', { n: hiddenKeys.length })}
          </button>
        )}

        {progress.total > 0 && (
          <ConfirmButton className="w-full" label={<><RotateCcw size={16} />{t('Nuova spesa · resetta spunte')}</>} confirmLabel={t('Tocca ancora: azzera le spunte e gli extra presi')}
            onConfirm={() => commit(resetShopping)} />
        )}
      </div>

      <Fab label={t('Aggiungi voce extra')} onClick={() => setExtraOpen(true)} />
      <ExtraSheet open={extraOpen} onClose={() => setExtraOpen(false)} />
      </>}
    </>
  )
}

/** Pulsante «preso»: a riposo un carrello con un check in trasparenza, da spuntato il check pieno. */
function CheckButton({ checked, label, onClick }: { checked: boolean; label: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <motion.button whileTap={{ scale: 0.82 }} onClick={onClick} role="checkbox" aria-checked={checked} aria-label={label}
      className={`glass-btn !h-10 !w-10 shrink-0 !p-0 ${checked ? 'btn-primary' : ''}`}>
      {checked ? <Check size={20} strokeWidth={3} /> : (
        <span className="relative block h-5 w-5 opacity-40" aria-hidden>
          <ShoppingCart size={20} strokeWidth={2} />
          <Check size={9} strokeWidth={4} className="absolute left-[8px] top-[3.5px]" />
        </span>
      )}
    </motion.button>
  )
}

const SWIPE_OPEN = 84

/** Riga che si trascina verso sinistra per mostrare «elimina». */
function SwipeRow({ children, label, onDelete }: { children: React.ReactNode; label: string; onDelete: () => void }) {
  const x = useMotionValue(0)
  const controls = useAnimationControls()
  const [open, setOpen] = useState(false)
  const reveal = useTransform(x, [-SWIPE_OPEN, -12, 0], [1, 0.2, 0])
  const settle = (to: number) => { setOpen(to !== 0); void controls.start({ x: to, transition: { type: 'spring', stiffness: 500, damping: 40 } }) }
  return (
    <div className="relative">
      <motion.div className="absolute inset-y-0 right-0 flex items-center justify-end" style={{ width: SWIPE_OPEN, opacity: reveal, pointerEvents: open ? 'auto' : 'none' }}>
        <button className="flex h-full w-[4.5rem] items-center justify-center rounded-[1.25rem] bg-exp text-onbrand" aria-label={label} tabIndex={open ? 0 : -1} onClick={onDelete}><Trash2 size={20} /></button>
      </motion.div>
      <motion.div drag="x" dragDirectionLock dragConstraints={{ left: -SWIPE_OPEN, right: 0 }} dragElastic={0.1} dragMomentum={false}
        className="relative z-10" style={{ x, touchAction: 'pan-y' }} animate={controls} onDragEnd={() => settle(x.get() < -SWIPE_OPEN / 2 ? -SWIPE_OPEN : 0)}>
        {children}
      </motion.div>
    </div>
  )
}

function MemberBadge({ member, text }: { member?: Member; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg px-2 py-0.5 text-[11px] font-semibold text-ink">
      <span className="h-2 w-2 rounded-full" style={{ background: member?.color ?? '#cbd5e1' }} />
      {member?.name ?? '?'}: {text}
    </span>
  )
}

function ExtraSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { commit } = useStore()
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  const save = () => {
    if (!name.trim()) return
    commit((d) => addExtra(d, name, qty))
    setName(''); setQty(''); onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} title={t('Voce extra')}
      footer={<button className="glass-btn btn-primary w-full !py-3.5" disabled={!name.trim()} onClick={save}><Plus size={16} />{t('Aggiungi alla spesa')}</button>}>
      <p className="text-sm text-muted">{t('Articoli non legati alla dieta (es. carta forno, detersivo).')}</p>
      <label className="label">{t('Nome')}</label>
      <input className="field" value={name} autoFocus placeholder={t('Carta forno')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      <label className="label">{t('Quantità (facoltativa)')}</label>
      <input className="field" value={qty} placeholder={t('2 rotoli')} onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
    </Sheet>
  )
}

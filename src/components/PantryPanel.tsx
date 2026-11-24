import { useState } from 'react'
import { Minus, Plus, Trash2 } from 'lucide-react'
import { Sheet, EmptyCard, ConfirmButton } from './ui'
import { FoodInput } from './FoodInput'
import { Fab } from './Chrome'
import { MascotImg } from './Mascots'
import { CategoryIcon } from './FoodIcon'
import { useStore } from '../state/store'
import { useUi } from '../state/ui'
import { ensureFood, foodById, liveFoods, setPantryQuantity } from '../services/dbOps'
import { pantryList, type PantryEntry } from '../services/pantry'
import { COMMON_UNITS, cleanUnit, formatQuantity, round2, toBase } from '../lib/units'
import { normalizeName } from '../lib/foodMatch'
import { t } from '../i18n'

/** Vista «Dispensa»: giacenze calcolate dal registro (acquisti dalla spesa − pasti completati ± correzioni). */
export function PantryPanel({ fabOpen }: { fabOpen: boolean }) {
  const { db } = useStore()
  const list = pantryList(db)
  const [edit, setEdit] = useState<PantryEntry | null>(null)
  const [adding, setAdding] = useState(false)
  return (
    <>
      <div className="mt-3 space-y-2">
        {list.length === 0 && (
          <EmptyCard mascot={<MascotImg kind="zenitsu-fish" className="mx-auto h-20 w-auto" />} title={t('Dispensa vuota')}
            text={t('Si riempie quando spunti un articolo nella lista della spesa e si svuota quando completi un pasto.')} />
        )}
        <ul className="space-y-2">
          {list.map((e) => (
            <li key={`${e.foodId}|${e.unit}`}>
              <button className="card flex w-full items-center justify-between gap-3 p-3 text-left active:bg-line/30" onClick={() => setEdit(e)} aria-label={t('Modifica {name} in dispensa', { name: e.name })}>
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand"><CategoryIcon category={e.category} size={18} /></span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold leading-tight">{e.name}</span>
                    <span className="block text-xs text-muted">{t(e.category)}</span>
                  </span>
                </span>
                <span className="shrink-0 font-extrabold">{formatQuantity(e.quantity, e.unit)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {fabOpen && <Fab label={t('Aggiungi alla dispensa')} onClick={() => setAdding(true)} />}
      <EditSheet entry={edit} onClose={() => setEdit(null)} />
      <AddSheet open={adding} onClose={() => setAdding(false)} />
    </>
  )
}

function parseQty(s: string): number {
  return Number(s.replace(',', '.'))
}

function EditSheet({ entry, onClose }: { entry: PantryEntry | null; onClose: () => void }) {
  const { commit } = useStore()
  const { showToast } = useUi()
  const [seed, setSeed] = useState('')
  const [qty, setQty] = useState('')
  const key = entry ? `${entry.foodId}|${entry.unit}` : ''
  if (entry && seed !== key) { setSeed(key); setQty(String(entry.quantity)) }
  if (!entry && seed) setSeed('')
  const n = parseQty(qty)
  const valid = qty.trim() !== '' && Number.isFinite(n) && n >= 0
  const save = (value: number) => {
    if (!entry) return
    commit((d) => setPantryQuantity(d, entry.foodId, entry.unit, value))
    showToast(t('Dispensa aggiornata'))
    onClose()
  }
  const step = entry?.unit === 'pz' ? 1 : entry?.unit === 'g' || entry?.unit === 'ml' ? 100 : 1
  return (
    <Sheet open={!!entry} onClose={onClose} title={entry?.name ?? ''}
      footer={<button className="glass-btn btn-primary w-full !py-3.5" disabled={!valid} onClick={() => save(n)}>{t('Salva')}</button>}>
      <p className="text-sm text-muted">{t('Correggi la quantità presente in casa (in {unit}).', { unit: entry?.unit ?? '' })}</p>
      <label className="label">{t('Quantità')}</label>
      <div className="flex items-center gap-2">
        <button className="glass-btn !h-12 !w-12 shrink-0 !p-0" aria-label={t('Meno')} onClick={() => setQty(String(Math.max(0, round2((valid ? n : 0) - step))))}><Minus size={18} /></button>
        <input className="field text-center" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} aria-label={t('Quantità')} />
        <button className="glass-btn !h-12 !w-12 shrink-0 !p-0" aria-label={t('Più')} onClick={() => setQty(String(round2((valid ? n : 0) + step)))}><Plus size={18} /></button>
      </div>
      <ConfirmButton className="mt-4 w-full" label={<><Trash2 size={16} />{t('Svuota')}</>} confirmLabel={t('Tocca ancora: azzera la giacenza')} onConfirm={() => save(0)} />
    </Sheet>
  )
}

function AddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, commit } = useStore()
  const { showToast } = useUi()
  const [name, setName] = useState('')
  const [foodId, setFoodId] = useState<string | undefined>()
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('g')
  const n = parseQty(qty)
  const valid = name.trim() !== '' && qty.trim() !== '' && Number.isFinite(n) && n > 0
  const save = () => {
    if (!valid) return
    const base = toBase(n, cleanUnit(unit))
    const picked = foodId ? foodById(db, foodId) : undefined
    commit((d) => {
      const r = picked && normalizeName(picked.name) === normalizeName(name) ? { db: d, food: picked } : ensureFood(d, name, cleanUnit(unit))
      const cur = pantryList(r.db).find((e) => e.foodId === r.food.id && e.unit === base.unit)?.quantity ?? 0
      return setPantryQuantity(r.db, r.food.id, base.unit, cur + base.quantity)
    })
    showToast(t('Aggiunto alla dispensa'))
    setName(''); setFoodId(undefined); setQty(''); onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} title={t('Aggiungi alla dispensa')}
      footer={<button className="glass-btn btn-primary w-full !py-3.5" disabled={!valid} onClick={save}><Plus size={16} />{t('Aggiungi')}</button>}>
      <label className="label !mt-2">{t('Alimento')}</label>
      <FoodInput value={name} catalog={liveFoods(db)} autoFocus onChange={(x) => { setName(x); setFoodId(undefined) }} onPick={(f) => { setName(f.name); setFoodId(f.id); setUnit(f.unit) }} />
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">{t('Quantità')}</label><input className="field" inputMode="decimal" value={qty} placeholder="500" onChange={(e) => setQty(e.target.value)} aria-label={t('Quantità')} /></div>
        <div><label className="label">{t('Unità')}</label><input className="field" list="pantryunits" value={unit} onChange={(e) => setUnit(e.target.value)} aria-label={t('Unità di misura')} /><datalist id="pantryunits">{COMMON_UNITS.map((u) => <option key={u} value={u} />)}</datalist></div>
      </div>
    </Sheet>
  )
}

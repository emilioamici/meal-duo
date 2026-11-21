import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { DayIndex, MealItem } from '../types'
import { DAY_INDEXES } from '../types'
import { Sheet, ConfirmButton } from './ui'
import { FoodInput } from './FoodInput'
import { useStore } from '../state/store'
import { variantQuantities } from '../services/variants'
import { addMeal, copyDay, ensureFood, foodById, liveFoods, removeItem, removeMeal, renameMeal, upsertItem } from '../services/dbOps'
import { COMMON_UNITS, cleanUnit, formatQuantity, round2 } from '../lib/units'
import { normalizeName } from '../lib/foodMatch'
import { uid } from '../lib/ids'
import { useUi } from '../state/ui'
import { tb } from '../i18n/rich'
import { t, dayLong, dayShort, tp } from '../i18n'

/* ---------------- Aggiungi / modifica alimento in un pasto ---------------- */
export function ItemSheet({ open, onClose, memberId, day, mealId, item }: {
  open: boolean; onClose: () => void; memberId: string; day: DayIndex; mealId?: string; item?: MealItem
}) {
  const { db, commit } = useStore()
  const { showToast } = useUi()
  const meals = db.plans[memberId]?.days[day]?.meals ?? []
  const [name, setName] = useState('')
  const [foodId, setFoodId] = useState<string | undefined>()
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('g')
  const [targetMeal, setTargetMeal] = useState<string | undefined>(mealId)

  useEffect(() => {
    if (!open) return
    const f = item ? foodById(db, item.foodId) : undefined
    setName(f?.name ?? '')
    setFoodId(item?.foodId)
    setQty(item ? String(item.quantity) : '')
    setUnit(item?.unit ?? 'g')
    setTargetMeal(mealId ?? meals[0]?.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id, mealId])

  const qn = Number(qty.replace(',', '.'))
  const valid = name.trim().length > 0 && qty.trim() !== '' && Number.isFinite(qn) && qn > 0 && !!targetMeal

  const variantOptions = foodId && qn > 0 ? variantQuantities(db, foodId, qn, unit) : []

  const save = () => {
    if (!valid || !targetMeal) return
    const u = cleanUnit(unit)
    const picked = foodId ? foodById(db, foodId) : undefined
    const reuse = picked && normalizeName(picked.name) === normalizeName(name)
    commit((d) => {
      const r = reuse ? { db: d, food: picked } : ensureFood(d, name, u)
      return upsertItem(r.db, memberId, day, targetMeal, { id: item?.id ?? uid('it'), foodId: r.food.id, quantity: qn, unit: u })
    })
    showToast(item ? t('Alimento aggiornato') : t('Alimento aggiunto'))
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={item ? t('Modifica alimento') : t('Aggiungi alimento')}
      footer={<button className="glass-btn btn-primary w-full !py-3.5" disabled={!valid} onClick={save}>{item ? t('Salva') : t('Aggiungi')}</button>}>
      <label className="label !mt-2">{t('Alimento')}</label>
      <FoodInput value={name} catalog={liveFoods(db)} autoFocus={!item}
        onChange={(t) => { setName(t); setFoodId(undefined) }}
        onPick={(f) => { setName(f.name); setFoodId(f.id); setUnit(f.unit) }} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">{t('Quantità')}</label>
          <input className="field" inputMode="decimal" value={qty} placeholder="150" onChange={(e) => setQty(e.target.value)} aria-label={t('Quantità')} />
        </div>
        <div>
          <label className="label">{t('Unità')}</label>
          <input className="field" list="units" value={unit} onChange={(e) => setUnit(e.target.value)} aria-label={t('Unità di misura')} />
          <datalist id="units">{COMMON_UNITS.map((u) => <option key={u} value={u} />)}</datalist>
        </div>
      </div>
      <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
        {['g', 'ml', 'pz'].map((u) => (
          <button key={u} type="button" className={`chip !py-1 !text-xs ${cleanUnit(unit) === u ? 'chip-active' : ''}`} onClick={() => setUnit(u)}>{u}</button>
        ))}
      </div>

      {variantOptions.length > 0 && (
        <>
          <label className="label">{t('Sostituisci con una variante')}</label>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {variantOptions.map(({ option, quantity }) => (
              <button key={option.food.id} type="button" className="chip" onClick={() => { setName(option.food.name); setFoodId(option.food.id); setQty(String(round2(quantity))); setUnit(option.unit) }}>
                {option.food.name} · {formatQuantity(quantity, option.unit)}
              </button>
            ))}
          </div>
        </>
      )}

      <label className="label">{t('Pasto')}</label>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {meals.map((m) => (
          <button key={m.id} type="button" className={`chip ${targetMeal === m.id ? 'chip-active' : ''}`} onClick={() => setTargetMeal(m.id)}>{m.name}</button>
        ))}
        {meals.length === 0 && <p className="text-sm text-muted">{t('Nessun pasto: aggiungine uno dalla schermata Oggi.')}</p>}
      </div>
      {item && (
        <ConfirmButton className="mt-2 w-full" label={<><Trash2 size={16} />{t('Elimina alimento')}</>}
          onConfirm={() => { commit((d) => removeItem(d, memberId, day, item.id)); onClose() }} />
      )}
    </Sheet>
  )
}

/* ---------------- Nuovo pasto / rinomina / elimina ---------------- */
export function MealSheet({ open, onClose, memberId, day, meal }: {
  open: boolean; onClose: () => void; memberId: string; day: DayIndex; meal?: { id: string; name: string }
}) {
  const { commit } = useStore()
  const [name, setName] = useState('')
  useEffect(() => { if (open) setName(meal?.name ?? '') }, [open, meal?.id, meal?.name])
  const save = () => {
    if (!name.trim()) return
    commit((d) => (meal ? renameMeal(d, memberId, day, meal.id, name) : addMeal(d, memberId, day, name)))
    onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} title={meal ? t('Modifica pasto') : t('Nuovo pasto')}
      footer={<button className="glass-btn btn-primary w-full !py-3.5" disabled={!name.trim()} onClick={save}>{meal ? t('Salva') : t('Aggiungi pasto')}</button>}>
      <label className="label !mt-2">{t('Nome')}</label>
      <input className="field" value={name} autoFocus placeholder={t('es. Spuntino serale')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      {!meal && (
        <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
          {['Spuntino serale', 'Pre-workout', 'Post-workout'].map((s) => <button key={s} type="button" className="chip" onClick={() => setName(t(s))}>{t(s)}</button>)}
        </div>
      )}
      {meal && (
        <ConfirmButton className="mt-2 w-full" label={<><Trash2 size={16} />{t('Elimina pasto')}</>}
          onConfirm={() => { commit((d) => removeMeal(d, memberId, day, meal.id)); onClose() }} />
      )}
    </Sheet>
  )
}

/* ---------------- Copia un giorno su altri giorni ---------------- */
export function CopyDaySheet({ open, onClose, memberId, from }: { open: boolean; onClose: () => void; memberId: string; from: DayIndex }) {
  const { commit } = useStore()
  const { showToast } = useUi()
  const [targets, setTargets] = useState<DayIndex[]>([])
  useEffect(() => { if (open) setTargets([]) }, [open, from])
  const toggle = (d: DayIndex) => setTargets((t) => (t.includes(d) ? t.filter((x) => x !== d) : [...t, d]))
  return (
    <Sheet open={open} onClose={onClose} title={t('Copia {day}', { day: dayLong(from) })}
      footer={<button className="glass-btn btn-primary w-full !py-3.5" disabled={targets.length === 0}
        onClick={() => { commit((d) => copyDay(d, memberId, from, targets)); showToast(tp(targets.length, 'Copiato su {n} giorno', 'Copiato su {n} giorni', { n: targets.length })); onClose() }}>
        {targets.length ? tp(targets.length, 'Copia su {n} giorno', 'Copia su {n} giorni', { n: targets.length }) : t('Copia su …')}
      </button>}>
      <p className="text-sm text-muted">{tb('Scegli i giorni su cui copiare pasti e alimenti. I giorni scelti verranno <b>sostituiti</b>.')}</p>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {DAY_INDEXES.filter((d) => d !== from).map((d) => (
          <button key={d} type="button" className={`chip justify-center ${targets.includes(d) ? 'chip-active' : ''}`} onClick={() => toggle(d)}>{dayShort(d)}</button>
        ))}
      </div>
      <button type="button" className="mt-3 text-sm font-semibold text-brand" onClick={() => setTargets(DAY_INDEXES.filter((d) => d !== from))}>{t('Seleziona tutti')}</button>
    </Sheet>
  )
}

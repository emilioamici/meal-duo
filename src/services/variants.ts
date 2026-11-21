/**
 * Varianti: un alimento può essere sostituito da un altro con un fattore di conversione
 * («100 g di pasta = 120 g di riso»). La relazione si dichiara su un solo alimento e vale in entrambe le direzioni.
 */
import type { AppDatabase, FoodCatalogItem, FoodVariant } from '../types'
import { toBase } from '../lib/units'

export interface VariantOption {
  food: FoodCatalogItem
  /** quante unità base di `food` valgono 1 unità base dell'alimento di partenza */
  ratio: number
  /** unità base di `food` */
  unit: string
  /** vera se la dichiarazione sta sull'alimento di partenza (false = dichiarata dall'altro lato) */
  own: boolean
  variant: FoodVariant
}

const live = (db: AppDatabase, id: string) => {
  const f = db.foodCatalog.find((x) => x.id === id)
  return f && !f.deleted ? f : undefined
}

/** Varianti di `foodId` (dichiarate da lui o dagli altri che lo citano), con il rapporto già in unità base. */
export function variantsOf(db: AppDatabase, foodId: string): VariantOption[] {
  const me = live(db, foodId)
  if (!me) return []
  const out: VariantOption[] = []
  const seen = new Set<string>()
  for (const v of me.variants ?? []) {
    const other = live(db, v.foodId)
    if (!other || other.id === me.id || seen.has(other.id)) continue
    const a = toBase(v.amount, me.unit), b = toBase(v.variantAmount, other.unit)
    if (!(a.quantity > 0) || !(b.quantity > 0)) continue
    seen.add(other.id)
    out.push({ food: other, ratio: b.quantity / a.quantity, unit: b.unit, own: true, variant: v })
  }
  for (const other of db.foodCatalog) {
    if (other.deleted || other.id === me.id || seen.has(other.id)) continue
    const v = other.variants?.find((x) => x.foodId === me.id)
    if (!v) continue
    const a = toBase(v.amount, other.unit), b = toBase(v.variantAmount, me.unit)
    if (!(a.quantity > 0) || !(b.quantity > 0)) continue
    seen.add(other.id)
    out.push({ food: other, ratio: a.quantity / b.quantity, unit: a.unit, own: false, variant: v })
  }
  return out.sort((x, y) => x.food.name.localeCompare(y.food.name, 'it'))
}

/** Il corrispondente di `quantity` (unità `unit`) di `foodId` nelle varianti. Vale solo se l'unità base coincide con quella dell'alimento. */
export function variantQuantities(db: AppDatabase, foodId: string, quantity: number, unit: string): { option: VariantOption; quantity: number }[] {
  const me = live(db, foodId)
  if (!me) return []
  const base = toBase(quantity, unit)
  if (base.unit !== toBase(1, me.unit).unit) return []
  return variantsOf(db, foodId).map((option) => ({ option, quantity: base.quantity * option.ratio }))
}

function strip(list: FoodVariant[] | undefined, foodId: string): FoodVariant[] | undefined {
  const rest = (list ?? []).filter((v) => v.foodId !== foodId)
  return rest.length ? rest : undefined
}

/** Dichiara (o aggiorna) la variante tra due alimenti, togliendo eventuali dichiarazioni opposte. */
export function withVariant(foods: FoodCatalogItem[], aId: string, bId: string, amount: number, variantAmount: number, at: string): FoodCatalogItem[] {
  if (aId === bId || !(amount > 0) || !(variantAmount > 0)) return foods
  return foods.map((f) => {
    if (f.id === aId) return { ...f, variants: [...(f.variants ?? []).filter((v) => v.foodId !== bId), { foodId: bId, amount, variantAmount }], updatedAt: at }
    if (f.id === bId && f.variants?.some((v) => v.foodId === aId)) return { ...f, variants: strip(f.variants, aId), updatedAt: at }
    return f
  })
}

export function withoutVariant(foods: FoodCatalogItem[], aId: string, bId: string, at: string): FoodCatalogItem[] {
  return foods.map((f) => {
    if (f.id === aId && f.variants?.some((v) => v.foodId === bId)) return { ...f, variants: strip(f.variants, bId), updatedAt: at }
    if (f.id === bId && f.variants?.some((v) => v.foodId === aId)) return { ...f, variants: strip(f.variants, aId), updatedAt: at }
    return f
  })
}

/**
 * Dispensa. Si riempie quando dalla lista della spesa si spunta un articolo (con la quantità presa) e si svuota
 * quando si completa un pasto che lo contiene. Giacenza = acquisti + correzioni − pasti completati (registro, vedi PantryState).
 */
import type { AppDatabase, ConsumedItem, DayIndex, FoodCategory, MealItem } from '../types'
import { round2, toBase } from '../lib/units'
import { variantsOf } from './variants'

export const stockKey = (foodId: string, unit: string) => `${foodId}|${unit}`

export const mealKey = (memberId: string, date: string, mealId: string) => `${memberId}|${date}|${mealId}`

/** Data locale (YYYY-MM-DD) del giorno `day` della settimana corrente (lunedì = 0). */
export function dateOfDay(day: DayIndex, ref: Date = new Date()): string {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - ((ref.getDay() + 6) % 7) + day)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Giacenza grezza per `foodId|unitBase` (può essere negativa: si azzera solo in visualizzazione). */
export function pantryStock(db: AppDatabase): Map<string, number> {
  const stock = new Map<string, number>()
  const add = (foodId: string, unit: string, q: number) => stock.set(stockKey(foodId, unit), (stock.get(stockKey(foodId, unit)) ?? 0) + q)
  for (const p of Object.values(db.pantry.purchases)) if (!p.deleted) add(p.foodId, p.unit, p.quantity)
  for (const a of Object.values(db.pantry.adjustments)) if (!a.deleted) add(a.foodId, a.unit, a.quantity)
  for (const m of Object.values(db.pantry.meals)) if (m.done && !m.deleted) for (const c of m.consumed) add(c.foodId, c.unit, -c.quantity)
  return stock
}

export interface PantryEntry {
  foodId: string
  name: string
  category: FoodCategory
  unit: string
  quantity: number
}

/** Elenco per la vista Dispensa: solo ciò che c'è (> 0), ordinato per nome. */
export function pantryList(db: AppDatabase): PantryEntry[] {
  const foods = new Map(db.foodCatalog.map((f) => [f.id, f]))
  const out: PantryEntry[] = []
  for (const [key, q] of pantryStock(db)) {
    const [foodId, unit] = key.split('|')
    const food = foods.get(foodId)
    if (!food || food.deleted || !(round2(q) > 0)) continue
    out.push({ foodId, name: food.name, category: food.category, unit, quantity: round2(q) })
  }
  return out.sort((x, y) => x.name.localeCompare(y.name, 'it') || x.unit.localeCompare(y.unit))
}

export interface Consumption { consumed: ConsumedItem[]; missing: number }

/**
 * Cosa scalare dalla dispensa per un pasto: per ogni alimento si usa prima quello stesso; se non basta si ripiega sulle
 * varianti che si hanno in casa (convertite col loro fattore). Ciò che non c'è non viene scalato (e conta come mancante).
 */
export function planConsumption(db: AppDatabase, items: MealItem[]): Consumption {
  const stock = pantryStock(db)
  const consumed = new Map<string, ConsumedItem>()
  let missing = 0
  const take = (foodId: string, unit: string, q: number) => {
    const k = stockKey(foodId, unit)
    stock.set(k, (stock.get(k) ?? 0) - q)
    const c = consumed.get(k)
    if (c) c.quantity += q
    else consumed.set(k, { foodId, unit, quantity: q })
  }
  for (const it of items) {
    if (!(it.quantity > 0)) continue
    const base = toBase(it.quantity, it.unit)
    let need = base.quantity
    const fromOwn = Math.min(need, Math.max(0, stock.get(stockKey(it.foodId, base.unit)) ?? 0))
    if (fromOwn > 0) { take(it.foodId, base.unit, fromOwn); need -= fromOwn }
    if (need > 1e-9) {
      const food = db.foodCatalog.find((f) => f.id === it.foodId)
      const sameUnit = !!food && toBase(1, food.unit).unit === base.unit
      for (const v of sameUnit ? variantsOf(db, it.foodId) : []) {
        if (need <= 1e-9) break
        const got = Math.min(Math.max(0, stock.get(stockKey(v.food.id, v.unit)) ?? 0), need * v.ratio)
        if (got > 0) { take(v.food.id, v.unit, got); need -= got / v.ratio }
      }
    }
    if (need > 1e-9) missing++
  }
  return { consumed: [...consumed.values()].map((c) => ({ ...c, quantity: round2(c.quantity) })).filter((c) => c.quantity > 0), missing }
}

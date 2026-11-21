/**
 * Motore di aggregazione della lista della spesa.
 *
 * Incrocia i piani settimanali dei membri, applicando i filtri (membri esclusi, giorni esclusi),
 * somma per alimento (foodId) nella stessa unità base (kg→g, l→ml …) e conserva il dettaglio per membro.
 * Funzioni pure: nessun accesso a rete, storage o DOM.
 */
import type {
  AppDatabase, DayIndex, DayPlan, ExtraItem, FoodCatalogItem, ShoppingFilters, ShoppingLine,
} from '../types'
import { DAY_INDEXES } from '../types'
import { round2, toBase } from '../lib/units'
import { pantryStock, stockKey } from './pantry'

export const NO_FILTERS: ShoppingFilters = { excludedMemberIds: [], excludedDays: [] }

export function lineKey(foodId: string, baseUnit: string): string {
  return `${foodId}|${baseUnit}`
}

export function isChecked(db: AppDatabase, key: string): boolean {
  const c = db.shopping.checks[key]
  return !!c && !c.deleted && c.checked && c.updatedAt >= db.shopping.resetAt
}

export function buildShoppingList(db: AppDatabase, filters: ShoppingFilters = NO_FILTERS): ShoppingLine[] {
  const foods = new Map<string, FoodCatalogItem>(db.foodCatalog.map((f) => [f.id, f]))
  const excludedMembers = new Set(filters.excludedMemberIds)
  const excludedDays = new Set<DayIndex>(filters.excludedDays)

  interface Acc { foodId: string; unit: string; total: number; per: Map<string, number> }
  const acc = new Map<string, Acc>()

  for (const member of db.members) {
    if (member.deleted || excludedMembers.has(member.id)) continue
    const plan = db.plans[member.id]
    if (!plan || plan.deleted) continue
    for (const d of DAY_INDEXES) {
      if (excludedDays.has(d)) continue
      const day: DayPlan | undefined = plan.days[d]
      if (!day || day.deleted) continue
      for (const meal of day.meals) {
        for (const item of meal.items) {
          if (!foods.has(item.foodId) || !(item.quantity > 0)) continue
          const base = toBase(item.quantity, item.unit)
          const key = lineKey(item.foodId, base.unit)
          let a = acc.get(key)
          if (!a) acc.set(key, (a = { foodId: item.foodId, unit: base.unit, total: 0, per: new Map() }))
          a.total += base.quantity
          a.per.set(member.id, (a.per.get(member.id) ?? 0) + base.quantity)
        }
      }
    }
  }

  const stock = pantryStock(db)
  const memberOrder = new Map(db.members.map((m, i) => [m.id, i]))
  const lines: ShoppingLine[] = []
  for (const [key, a] of acc) {
    const food = foods.get(a.foodId)!
    lines.push({
      key,
      foodId: a.foodId,
      name: food.name,
      category: food.category,
      unit: a.unit,
      total: round2(a.total),
      perMember: [...a.per.entries()]
        .sort((x, y) => (memberOrder.get(x[0]) ?? 0) - (memberOrder.get(y[0]) ?? 0))
        .map(([memberId, quantity]) => ({ memberId, quantity: round2(quantity) })),
      inPantry: Math.max(0, round2(stock.get(stockKey(a.foodId, a.unit)) ?? 0)),
      checked: isChecked(db, key),
    })
  }
  return lines.sort((x, y) => x.name.localeCompare(y.name, 'it') || x.unit.localeCompare(y.unit))
}

export function groupByCategory(lines: ShoppingLine[]): { category: string; lines: ShoppingLine[] }[] {
  const order: string[] = []
  const map = new Map<string, ShoppingLine[]>()
  for (const l of lines) {
    if (!map.has(l.category)) { map.set(l.category, []); order.push(l.category) }
    map.get(l.category)!.push(l)
  }
  return order.map((category) => ({ category, lines: map.get(category)! }))
}

export function liveExtras(db: AppDatabase): ExtraItem[] {
  return db.shopping.extras.filter((e) => !e.deleted)
}

export function extraChecked(db: AppDatabase, e: ExtraItem): boolean {
  return e.checked && e.updatedAt >= db.shopping.resetAt
}

export interface ShoppingProgress { done: number; total: number; pct: number }

export function shoppingProgress(db: AppDatabase, lines: ShoppingLine[]): ShoppingProgress {
  const extras = liveExtras(db)
  const total = lines.length + extras.length
  const done = lines.filter((l) => l.checked).length + extras.filter((e) => extraChecked(db, e)).length
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) }
}

/** Totali di un giorno (per la card di riepilogo "Oggi"). */
export function dayTotals(day: DayPlan | undefined): { foods: number; grams: number; ml: number; pieces: number } {
  let foods = 0, grams = 0, ml = 0, pieces = 0
  for (const meal of day?.meals ?? []) {
    for (const it of meal.items) {
      foods++
      const b = toBase(it.quantity, it.unit)
      if (b.unit === 'g') grams += b.quantity
      else if (b.unit === 'ml') ml += b.quantity
      else if (b.unit === 'pz') pieces += b.quantity
    }
  }
  return { foods, grams: round2(grams), ml: round2(ml), pieces: round2(pieces) }
}

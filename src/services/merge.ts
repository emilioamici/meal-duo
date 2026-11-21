/**
 * Merge a livello di record (last-write-wins per `updatedAt`, con tombstone) di due database.
 * Proprietà: commutativo, associativo e idempotente → due dispositivi che si scambiano
 * lo stato convergono sempre allo stesso risultato, senza perdere modifiche su record diversi.
 */
import type { AppDatabase, DayPlan, ShoppingCheck, Versioned, WeeklyPlan } from '../types'
import { DAY_INDEXES } from '../types'

function pick<T extends Versioned>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  // parità: scelta deterministica e simmetrica
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b
}

function mergeById<T extends Versioned & { id: string }>(a: T[], b: T[]): T[] {
  const out = new Map<string, T>()
  const order: string[] = []
  for (const x of [...a, ...b]) {
    const cur = out.get(x.id)
    if (!cur) order.push(x.id)
    out.set(x.id, cur ? pick(cur, x) : x)
  }
  return order.map((id) => out.get(id)!)
}

function mergePlan(a: WeeklyPlan | undefined, b: WeeklyPlan | undefined): WeeklyPlan | undefined {
  if (!a || !b) return a ?? b
  const days: DayPlan[] = DAY_INDEXES.map((i) => pick(a.days[i], b.days[i]))
  const head = pick(a, b)
  return { ...head, days, updatedAt: [a.updatedAt, b.updatedAt, ...days.map((d) => d.updatedAt)].sort().at(-1)! }
}

export function mergeDatabases(a: AppDatabase, b: AppDatabase): AppDatabase {
  const memberIds = [...new Set([...Object.keys(a.plans), ...Object.keys(b.plans)])]
  const plans: Record<string, WeeklyPlan> = {}
  for (const id of memberIds) {
    const p = mergePlan(a.plans[id], b.plans[id])
    if (p) plans[id] = p
  }

  const checks: Record<string, ShoppingCheck> = {}
  for (const key of new Set([...Object.keys(a.shopping.checks), ...Object.keys(b.shopping.checks)])) {
    const x = a.shopping.checks[key]
    const y = b.shopping.checks[key]
    checks[key] = x && y ? pick(x, y) : (x ?? y)!
  }

  const mergeRecords = <T extends Versioned>(x: Record<string, T>, y: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = {}
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) out[k] = x[k] && y[k] ? pick(x[k], y[k]) : (x[k] ?? y[k])
    return out
  }
  const pantry = {
    purchases: mergeRecords(a.pantry.purchases, b.pantry.purchases),
    adjustments: mergeRecords(a.pantry.adjustments, b.pantry.adjustments),
    meals: mergeRecords(a.pantry.meals, b.pantry.meals),
  }

  const newer = a.lastUpdated >= b.lastUpdated ? a : b
  return {
    schema: 'meal-duo-db',
    version: 1,
    houseName: newer.houseName,
    members: mergeById(a.members, b.members),
    foodCatalog: mergeById(a.foodCatalog, b.foodCatalog),
    plans,
    shopping: {
      checks,
      extras: mergeById(a.shopping.extras, b.shopping.extras),
      resetAt: a.shopping.resetAt >= b.shopping.resetAt ? a.shopping.resetAt : b.shopping.resetAt,
    },
    pantry,
    lastUpdated: a.lastUpdated >= b.lastUpdated ? a.lastUpdated : b.lastUpdated,
  }
}

/** Array che sono insiemi di record (l'ordine dipende dall'ordine di merge): gli altri array (pasti, voci) restano in ordine. */
const SET_KEYS = new Set(['members', 'foodCatalog', 'extras'])

function canonicalize(v: unknown, key = ''): unknown {
  if (Array.isArray(v)) {
    const items = v.map((x) => canonicalize(x))
    return SET_KEYS.has(key)
      ? [...items].sort((x, y) => String((x as { id: string }).id).localeCompare(String((y as { id: string }).id)))
      : items
  }
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, canonicalize(x, k)]),
    )
  }
  return v
}

/** Uguaglianza di stato indipendente dall'ordine dei record (serve a capire se c'è qualcosa da caricare/scaricare). */
export function sameState(a: AppDatabase, b: AppDatabase): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b))
}

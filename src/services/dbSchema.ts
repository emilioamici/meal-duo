/** Validazione/normalizzazione difensiva di un database letto da Drive o da localStorage. */
import type { AppDatabase, DayPlan, FoodCategory, FoodVariant, Meal, PantryState, WeeklyPlan } from '../types'
import { DAY_INDEXES } from '../types'
import { EPOCH, emptyDay } from './dbOps'
import { FOOD_CATEGORIES } from '../lib/foodMatch'
import { uid } from '../lib/ids'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const by = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const iso = (v: unknown): string => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : EPOCH)

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)

function parseVariants(v: unknown): FoodVariant[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.filter(isObj).flatMap((x) => {
    const amount = num(x.amount), variantAmount = num(x.variantAmount)
    return typeof x.foodId === 'string' && x.foodId && amount && variantAmount ? [{ foodId: x.foodId, amount, variantAmount }] : []
  })
  return out.length ? out : undefined
}

function parsePantry(raw: unknown): PantryState {
  const p = isObj(raw) ? raw : {}
  const rec = (v: unknown) => (isObj(v) ? Object.entries(v).filter((e): e is [string, Record<string, unknown>] => isObj(e[1])) : [])
  const base = (o: Record<string, unknown>) => ({ by: by(o.by), updatedAt: iso(o.updatedAt), deleted: o.deleted === true ? true : undefined })
  const purchases: PantryState['purchases'] = {}
  for (const [k, o] of rec(p.purchases)) {
    const quantity = num(o.quantity)
    if (typeof o.foodId === 'string' && o.foodId && quantity) purchases[k] = { key: k, foodId: o.foodId, unit: str(o.unit, 'g'), quantity, ...base(o) }
  }
  const adjustments: PantryState['adjustments'] = {}
  for (const [k, o] of rec(p.adjustments)) {
    if (typeof o.foodId === 'string' && o.foodId && typeof o.quantity === 'number' && Number.isFinite(o.quantity)) adjustments[k] = { id: k, foodId: o.foodId, unit: str(o.unit, 'g'), quantity: o.quantity, ...base(o) }
  }
  const meals: PantryState['meals'] = {}
  for (const [k, o] of rec(p.meals)) {
    const consumed = (Array.isArray(o.consumed) ? o.consumed : []).filter(isObj).flatMap((c) => {
      const quantity = num(c.quantity)
      return typeof c.foodId === 'string' && c.foodId && quantity ? [{ foodId: c.foodId, unit: str(c.unit, 'g'), quantity }] : []
    })
    meals[k] = { key: k, memberId: str(o.memberId), date: str(o.date), mealId: str(o.mealId), done: o.done === true, consumed, missing: typeof o.missing === 'number' && o.missing > 0 ? o.missing : undefined, ...base(o) }
  }
  return { purchases, adjustments, meals }
}

export function parseDb(raw: unknown): AppDatabase {
  if (!isObj(raw) || raw.schema !== 'meal-duo-db') throw new Error('Il file non è un database Meal Duo valido.')

  const members = (Array.isArray(raw.members) ? raw.members : []).filter(isObj).map((m) => ({
    id: str(m.id) || uid('mem'),
    name: str(m.name, 'Membro'),
    color: str(m.color, '#c9692a'),
    email: typeof m.email === 'string' && m.email ? m.email : undefined,
    joinedAt: typeof m.joinedAt === 'string' && m.joinedAt ? m.joinedAt : undefined,
    by: by(m.by),
    updatedAt: iso(m.updatedAt),
    deleted: m.deleted === true ? true : undefined,
  }))

  const foodCatalog = (Array.isArray(raw.foodCatalog) ? raw.foodCatalog : []).filter(isObj).map((f) => ({
    id: str(f.id) || uid('food'),
    name: str(f.name, 'Alimento'),
    unit: str(f.unit, 'g'),
    category: (FOOD_CATEGORIES.includes(f.category as FoodCategory) ? f.category : 'Surgelati e altro') as FoodCategory,
    aliases: Array.isArray(f.aliases) ? f.aliases.filter((a): a is string => typeof a === 'string') : undefined,
    variants: parseVariants(f.variants),
    by: by(f.by),
    updatedAt: iso(f.updatedAt),
    deleted: f.deleted === true ? true : undefined,
  }))

  const plans: Record<string, WeeklyPlan> = {}
  if (isObj(raw.plans)) {
    for (const [memberId, p] of Object.entries(raw.plans)) {
      if (!isObj(p)) continue
      const srcDays = Array.isArray(p.days) ? p.days : []
      const days: DayPlan[] = DAY_INDEXES.map((i) => {
        const d = srcDays[i]
        if (!isObj(d)) return emptyDay(EPOCH, [])
        const meals: Meal[] = (Array.isArray(d.meals) ? d.meals : []).filter(isObj).map((m) => ({
          id: str(m.id) || uid('meal'),
          name: str(m.name, 'Pasto'),
          items: (Array.isArray(m.items) ? m.items : []).filter(isObj).map((it) => ({
            id: str(it.id) || uid('it'),
            foodId: str(it.foodId),
            quantity: typeof it.quantity === 'number' && Number.isFinite(it.quantity) ? it.quantity : 0,
            unit: str(it.unit, 'g'),
          })),
        }))
        return { meals, updatedAt: iso(d.updatedAt), by: by(d.by), deleted: d.deleted === true ? true : undefined }
      })
      plans[memberId] = { memberId, days, updatedAt: iso(p.updatedAt), by: by(p.by), deleted: p.deleted === true ? true : undefined }
    }
  }

  const sh = isObj(raw.shopping) ? raw.shopping : {}
  const checks: AppDatabase['shopping']['checks'] = {}
  if (isObj(sh.checks)) {
    for (const [k, c] of Object.entries(sh.checks)) {
      if (isObj(c)) checks[k] = { key: k, checked: c.checked === true, hidden: c.hidden === true ? true : undefined, by: by(c.by), updatedAt: iso(c.updatedAt), deleted: c.deleted === true ? true : undefined }
    }
  }
  const extras = (Array.isArray(sh.extras) ? sh.extras : []).filter(isObj).map((e) => ({
    id: str(e.id) || uid('x'),
    name: str(e.name, 'Voce'),
    quantity: typeof e.quantity === 'string' && e.quantity ? e.quantity : undefined,
    checked: e.checked === true,
    by: by(e.by),
    updatedAt: iso(e.updatedAt),
    deleted: e.deleted === true ? true : undefined,
  }))

  return {
    schema: 'meal-duo-db',
    version: 1,
    houseName: str(raw.houseName, 'La nostra famiglia'),
    members,
    foodCatalog,
    plans,
    shopping: { checks, extras, resetAt: iso(sh.resetAt) },
    pantry: parsePantry(raw.pantry),
    lastUpdated: iso(raw.lastUpdated),
  }
}

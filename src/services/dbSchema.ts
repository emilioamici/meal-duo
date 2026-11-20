/** Validazione/normalizzazione difensiva di un database letto da Drive o da localStorage. */
import type { AppDatabase, DayPlan, FoodCategory, Meal, WeeklyPlan } from '../types'
import { DAY_INDEXES } from '../types'
import { EPOCH, emptyDay } from './dbOps'
import { FOOD_CATEGORIES } from '../lib/foodMatch'
import { uid } from '../lib/ids'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const by = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const iso = (v: unknown): string => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : EPOCH)

export function parseDb(raw: unknown): AppDatabase {
  if (!isObj(raw) || raw.schema !== 'meal-duo-db') throw new Error('Il file non è un database Meal Duo valido.')

  const members = (Array.isArray(raw.members) ? raw.members : []).filter(isObj).map((m) => ({
    id: str(m.id) || uid('mem'),
    name: str(m.name, 'Membro'),
    color: str(m.color, '#c9692a'),
    email: typeof m.email === 'string' && m.email ? m.email : undefined,
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
      if (isObj(c)) checks[k] = { key: k, checked: c.checked === true, by: by(c.by), updatedAt: iso(c.updatedAt), deleted: c.deleted === true ? true : undefined }
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
    houseName: str(raw.houseName, 'La nostra casa'),
    members,
    foodCatalog,
    plans,
    shopping: { checks, extras, resetAt: iso(sh.resetAt) },
    lastUpdated: iso(raw.lastUpdated),
  }
}

/** Operazioni pure (immutabili) sul database: ogni mutazione aggiorna `updatedAt` dei record toccati. */
import type {
  AppDatabase, DayIndex, DayPlan, ExtraItem, FoodCatalogItem, FoodCategory, Meal, MealItem, Member, WeeklyPlan,
} from '../types'
import { DAY_INDEXES } from '../types'
import { nowIso, uid } from '../lib/ids'
import { capitalize, findCanonical, guessCategory, normalizeName } from '../lib/foodMatch'
import { cleanUnit } from '../lib/units'
import { getActor } from '../lib/actor'

export const DEFAULT_MEALS = ['Colazione', 'Spuntino mattina', 'Pranzo', 'Merenda', 'Cena']
export const MEMBER_COLORS = ['#c9692a', '#2a8f78', '#c0506a', '#e0a93e', '#8a5fa8', '#3f87b8', '#6aa84f', '#5b6577']

export const EPOCH = '2026-01-01T00:00:00.000Z'

export function emptyDay(at: string = nowIso(), meals: string[] = DEFAULT_MEALS): DayPlan {
  return { updatedAt: at, meals: meals.map((name) => ({ id: uid('meal'), name, items: [] })) }
}

export function emptyPlan(memberId: string, at: string = nowIso()): WeeklyPlan {
  return { memberId, updatedAt: at, days: DAY_INDEXES.map(() => emptyDay(at)) }
}

/** Casa vuota con un solo membro (chi la crea). */
export function emptyDb(houseName = 'La nostra casa', memberName = 'Io', email?: string): AppDatabase {
  const at = nowIso()
  const member: Member = { id: uid('mem'), name: memberName, color: MEMBER_COLORS[0], email: email || undefined, updatedAt: at }
  return {
    schema: 'meal-duo-db',
    version: 1,
    houseName,
    members: [member],
    foodCatalog: [],
    plans: { [member.id]: emptyPlan(member.id, at) },
    shopping: { checks: {}, extras: [], resetAt: EPOCH },
    lastUpdated: at,
  }
}

const touch = (db: AppDatabase, at: string): AppDatabase => ({ ...db, lastUpdated: at })

/** Il database è ancora quello di esempio / mai modificato (lastUpdated resta all'epoca). */
export const isPristine = (db: AppDatabase): boolean => db.lastUpdated === EPOCH

export const liveMembers = (db: AppDatabase): Member[] => db.members.filter((m) => !m.deleted)
export const liveFoods = (db: AppDatabase): FoodCatalogItem[] => db.foodCatalog.filter((f) => !f.deleted)
export const foodById = (db: AppDatabase, id: string): FoodCatalogItem | undefined => db.foodCatalog.find((f) => f.id === id)

/* ---------------- Alimenti / catalogo ---------------- */

/** Restituisce l'alimento canonico per `name`, creandolo se non esiste (match sicuro, vedi findCanonical). */
export function ensureFood(
  db: AppDatabase,
  name: string,
  unit: string,
  category?: FoodCategory,
): { db: AppDatabase; food: FoodCatalogItem; created: boolean } {
  const existing = findCanonical(db.foodCatalog, name)
  if (existing) return { db, food: existing, created: false }
  const at = nowIso()
  const food: FoodCatalogItem = {
    id: uid('food'),
    name: capitalize(name),
    unit: cleanUnit(unit),
    category: category ?? guessCategory(name),
    updatedAt: at,
  }
  return { db: touch({ ...db, foodCatalog: [...db.foodCatalog, food] }, at), food, created: true }
}

export function updateFood(db: AppDatabase, id: string, patch: Partial<Pick<FoodCatalogItem, 'name' | 'unit' | 'category' | 'aliases'>>): AppDatabase {
  const at = nowIso()
  return touch({ ...db, foodCatalog: db.foodCatalog.map((f) => (f.id === id ? { ...f, ...patch, updatedAt: at } : f)) }, at)
}

export function foodUsage(db: AppDatabase, foodId: string): number {
  let n = 0
  for (const plan of Object.values(db.plans)) {
    if (plan.deleted) continue
    for (const day of plan.days) for (const meal of day.meals) for (const it of meal.items) if (it.foodId === foodId) n++
  }
  return n
}

export function deleteFood(db: AppDatabase, id: string): AppDatabase {
  if (foodUsage(db, id) > 0) return db
  const at = nowIso()
  return touch({ ...db, foodCatalog: db.foodCatalog.map((f) => (f.id === id ? { ...f, deleted: true, updatedAt: at } : f)) }, at)
}

/** Unisce `removeId` dentro `keepId`: tutte le voci dei piani puntano a `keepId`; il vecchio nome diventa alias. */
export function mergeFoods(db: AppDatabase, keepId: string, removeId: string): AppDatabase {
  if (keepId === removeId) return db
  const keep = foodById(db, keepId)
  const gone = foodById(db, removeId)
  if (!keep || !gone) return db
  const at = nowIso()
  const plans: Record<string, WeeklyPlan> = {}
  for (const [mid, plan] of Object.entries(db.plans)) {
    let planTouched = false
    const days = plan.days.map((day) => {
      let touched = false
      const meals = day.meals.map((meal) => {
        if (!meal.items.some((i) => i.foodId === removeId)) return meal
        touched = true
        return { ...meal, items: meal.items.map((i) => (i.foodId === removeId ? { ...i, foodId: keepId } : i)) }
      })
      if (!touched) return day
      planTouched = true
      return { ...day, meals, updatedAt: at }
    })
    plans[mid] = planTouched ? { ...plan, days, updatedAt: at } : plan
  }
  const aliases = [...new Set([...(keep.aliases ?? []), gone.name, ...(gone.aliases ?? [])])].filter((a) => normalizeName(a) !== normalizeName(keep.name))
  return touch({
    ...db,
    plans,
    foodCatalog: db.foodCatalog.map((f) => {
      if (f.id === keepId) return { ...f, aliases, updatedAt: at }
      if (f.id === removeId) return { ...f, deleted: true, updatedAt: at }
      return f
    }),
  }, at)
}

/* ---------------- Membri ---------------- */

export function addMember(db: AppDatabase, name: string, color: string, email?: string): { db: AppDatabase; member: Member } {
  const at = nowIso()
  const member: Member = { id: uid('mem'), name: name.trim(), color, email: email?.trim() || undefined, updatedAt: at }
  return {
    member,
    db: touch({ ...db, members: [...db.members, member], plans: { ...db.plans, [member.id]: emptyPlan(member.id, at) } }, at),
  }
}

export function updateMember(db: AppDatabase, id: string, patch: Partial<Pick<Member, 'name' | 'color' | 'email'>>): AppDatabase {
  const at = nowIso()
  return touch({ ...db, members: db.members.map((m) => (m.id === id ? { ...m, ...patch, updatedAt: at } : m)) }, at)
}

export function removeMember(db: AppDatabase, id: string): AppDatabase {
  if (liveMembers(db).length <= 1) return db
  const at = nowIso()
  const plan = db.plans[id]
  return touch({
    ...db,
    members: db.members.map((m) => (m.id === id ? { ...m, deleted: true, updatedAt: at } : m)),
    plans: plan ? { ...db.plans, [id]: { ...plan, deleted: true, updatedAt: at } } : db.plans,
  }, at)
}

/* ---------------- Piano: giorni e pasti ---------------- */

function mapDay(db: AppDatabase, memberId: string, day: DayIndex, fn: (d: DayPlan) => DayPlan): AppDatabase {
  const at = nowIso()
  const plan = db.plans[memberId] ?? emptyPlan(memberId, at)
  const days = plan.days.map((d, i) => (i === day ? { ...fn(d), updatedAt: at, by: getActor() } : d))
  return touch({ ...db, plans: { ...db.plans, [memberId]: { ...plan, deleted: undefined, days, updatedAt: at, by: getActor() } } }, at)
}

export function addMeal(db: AppDatabase, memberId: string, day: DayIndex, name: string): AppDatabase {
  return mapDay(db, memberId, day, (d) => ({ ...d, meals: [...d.meals, { id: uid('meal'), name: name.trim() || 'Pasto', items: [] }] }))
}

export function renameMeal(db: AppDatabase, memberId: string, day: DayIndex, mealId: string, name: string): AppDatabase {
  return mapDay(db, memberId, day, (d) => ({ ...d, meals: d.meals.map((m) => (m.id === mealId ? { ...m, name: name.trim() || m.name } : m)) }))
}

export function removeMeal(db: AppDatabase, memberId: string, day: DayIndex, mealId: string): AppDatabase {
  return mapDay(db, memberId, day, (d) => ({ ...d, meals: d.meals.filter((m) => m.id !== mealId) }))
}

/** Inserisce o sostituisce una voce; `moveToMealId` permette di spostarla in un altro pasto. */
export function upsertItem(db: AppDatabase, memberId: string, day: DayIndex, mealId: string, item: MealItem): AppDatabase {
  return mapDay(db, memberId, day, (d) => {
    const without = d.meals.map((m) => ({ ...m, items: m.items.filter((i) => i.id !== item.id) }))
    return { ...d, meals: without.map((m) => (m.id === mealId ? { ...m, items: [...m.items, item] } : m)) }
  })
}

export function removeItem(db: AppDatabase, memberId: string, day: DayIndex, itemId: string): AppDatabase {
  return mapDay(db, memberId, day, (d) => ({ ...d, meals: d.meals.map((m) => ({ ...m, items: m.items.filter((i) => i.id !== itemId) })) }))
}

const cloneMeals = (meals: Meal[]): Meal[] =>
  meals.map((m) => ({ id: uid('meal'), name: m.name, items: m.items.map((i) => ({ ...i, id: uid('it') })) }))

export function copyDay(db: AppDatabase, memberId: string, from: DayIndex, to: DayIndex[]): AppDatabase {
  const src = db.plans[memberId]?.days[from]
  if (!src) return db
  let next = db
  for (const t of to) {
    if (t === from) continue
    next = mapDay(next, memberId, t, (d) => ({ ...d, meals: cloneMeals(src.meals) }))
  }
  return next
}

export function clearDay(db: AppDatabase, memberId: string, day: DayIndex): AppDatabase {
  return mapDay(db, memberId, day, (d) => ({ ...d, meals: d.meals.map((m) => ({ ...m, items: [] })) }))
}

/** Sostituisce l'intero piano del membro (usato dall'import JSON). */
export function replacePlan(db: AppDatabase, memberId: string, days: DayPlan[]): AppDatabase {
  const at = nowIso()
  const stamped = DAY_INDEXES.map((i) => ({ ...(days[i] ?? emptyDay(at, [])), updatedAt: at }))
  const by = getActor()
  return touch({ ...db, plans: { ...db.plans, [memberId]: { memberId, updatedAt: at, by, days: stamped.map((d) => ({ ...d, by })) } } }, at)
}

/* ---------------- Spesa ---------------- */

export function toggleCheck(db: AppDatabase, key: string, checked: boolean, by?: string): AppDatabase {
  const at = nowIso()
  return touch({ ...db, shopping: { ...db.shopping, checks: { ...db.shopping.checks, [key]: { key, checked, by: by ?? getActor(), updatedAt: at } } } }, at)
}

export function addExtra(db: AppDatabase, name: string, quantity?: string): AppDatabase {
  const at = nowIso()
  const extra: ExtraItem = { id: uid('x'), name: capitalize(name), quantity: quantity?.trim() || undefined, checked: false, updatedAt: at, by: getActor() }
  return touch({ ...db, shopping: { ...db.shopping, extras: [...db.shopping.extras, extra] } }, at)
}

export function toggleExtra(db: AppDatabase, id: string, checked: boolean): AppDatabase {
  const at = nowIso()
  return touch({ ...db, shopping: { ...db.shopping, extras: db.shopping.extras.map((e) => (e.id === id ? { ...e, checked, updatedAt: at, by: getActor() } : e)) } }, at)
}

export function removeExtra(db: AppDatabase, id: string): AppDatabase {
  const at = nowIso()
  return touch({ ...db, shopping: { ...db.shopping, extras: db.shopping.extras.map((e) => (e.id === id ? { ...e, deleted: true, updatedAt: at } : e)) } }, at)
}

/** "Nuova spesa": azzera le spunte (resetAt) ed elimina gli extra già acquistati. */
export function resetShopping(db: AppDatabase): AppDatabase {
  const at = nowIso()
  return touch({
    ...db,
    shopping: {
      checks: {},
      resetAt: at,
      extras: db.shopping.extras.map((e) => (!e.deleted && e.checked ? { ...e, deleted: true, updatedAt: at } : e)),
    },
  }, at)
}

export function renameHouse(db: AppDatabase, name: string): AppDatabase {
  const at = nowIso()
  return touch({ ...db, houseName: name.trim() || db.houseName }, at)
}

/**
 * Più membri attivi con la stessa email (es. l'invitato è entrato prima che l'invito arrivasse su Drive e si è aggiunto da solo):
 * si tiene quello con più alimenti nel piano (a parità, il più vecchio) e gli altri diventano tombstone insieme al loro piano.
 */
export function dedupeMembersByEmail(db: AppDatabase): AppDatabase {
  const byMail = new Map<string, Member[]>()
  for (const m of liveMembers(db)) {
    const k = m.email?.trim().toLowerCase()
    if (k) byMail.set(k, [...(byMail.get(k) ?? []), m])
  }
  const items = (id: string) => (db.plans[id]?.days ?? []).reduce((n, d) => n + d.meals.reduce((k, m) => k + m.items.length, 0), 0)
  const drop = new Set<string>()
  for (const list of byMail.values()) {
    if (list.length < 2) continue
    const [, ...rest] = [...list].sort((a, b) => items(b.id) - items(a.id) || a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id))
    rest.forEach((m) => drop.add(m.id))
  }
  if (!drop.size) return db
  const at = nowIso()
  const plans = { ...db.plans }
  for (const id of drop) if (plans[id]) plans[id] = { ...plans[id], deleted: true, updatedAt: at }
  return touch({ ...db, members: db.members.map((m) => (drop.has(m.id) ? { ...m, deleted: true, updatedAt: at } : m)), plans }, at)
}

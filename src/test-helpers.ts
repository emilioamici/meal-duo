import type { AppDatabase, DayIndex, FoodCatalogItem, Member, WeeklyPlan } from './types'
import { EPOCH, emptyPlan } from './services/dbOps'

/** DB minimale per i test: membri A e B, alimenti riso (g) e latte (ml) e uova (pz). */
export function fixtureDb(): AppDatabase {
  const m = (id: string, name: string): Member => ({ id, name, color: '#c9692a', updatedAt: EPOCH })
  const f = (id: string, name: string, unit: string): FoodCatalogItem => ({ id, name, unit, category: 'Dispensa', updatedAt: EPOCH })
  const plans: Record<string, WeeklyPlan> = { a: emptyPlan('a', EPOCH), b: emptyPlan('b', EPOCH) }
  return {
    schema: 'meal-duo-db', version: 1, houseName: 'T', lastUpdated: EPOCH,
    members: [m('a', 'Anna'), m('b', 'Bruno')],
    foodCatalog: [f('riso', 'Riso basmati', 'g'), f('latte', 'Latte', 'ml'), f('uova', 'Uova', 'pz')],
    plans,
    shopping: { checks: {}, extras: [], resetAt: EPOCH },
  }
}

export function put(db: AppDatabase, member: string, day: DayIndex, foodId: string, quantity: number, unit: string, mealIdx = 2): AppDatabase {
  const plan = db.plans[member]
  const days = plan.days.map((d, i) => i !== day ? d : {
    ...d,
    meals: d.meals.map((m, mi) => mi !== mealIdx ? m : { ...m, items: [...m.items, { id: `${member}${day}${foodId}${m.items.length}`, foodId, quantity, unit }] }),
  })
  return { ...db, plans: { ...db.plans, [member]: { ...plan, days } } }
}

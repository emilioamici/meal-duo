import { describe, expect, it } from 'vitest'
import { mergeDatabases, sameState } from './merge'
import { fixtureDb, put } from '../test-helpers'
import { addExtra, mergeFoods, toggleCheck, updateMember, upsertItem } from './dbOps'
import { buildShoppingList } from './shoppingListEngine'

const sleep = () => new Promise((r) => setTimeout(r, 3)) // garantisce updatedAt diversi

describe('mergeDatabases (LWW per record)', () => {
  it('modifiche su record diversi si sommano (due persone modificano contemporaneamente)', async () => {
    const base = fixtureDb()
    let a = toggleCheck(base, 'riso|g', true, 'a')
    await sleep()
    let b = addExtra(base, 'Carta forno')
    b = updateMember(b, 'b', { name: 'Bruno R.' })
    const m = mergeDatabases(a, b)
    expect(m.shopping.checks['riso|g'].checked).toBe(true)
    expect(m.shopping.extras.map((e) => e.name)).toEqual(['Carta forno'])
    expect(m.members.find((x) => x.id === 'b')!.name).toBe('Bruno R.')
    a = m
  })
  it('stesso record: vince la scrittura più recente', async () => {
    const base = fixtureDb()
    const a = toggleCheck(base, 'riso|g', true)
    await sleep()
    const b = toggleCheck(base, 'riso|g', false)
    expect(mergeDatabases(a, b).shopping.checks['riso|g'].checked).toBe(false)
    expect(mergeDatabases(b, a).shopping.checks['riso|g'].checked).toBe(false)
  })
  it('piani di membri diversi modificati in parallelo non si perdono', async () => {
    const base = fixtureDb()
    const a = put(base, 'a', 0, 'riso', 50, 'g')
    const aDay = { ...a.plans.a, days: a.plans.a.days.map((d, i) => (i === 0 ? { ...d, updatedAt: new Date().toISOString() } : d)) }
    await sleep()
    const b0 = put(base, 'b', 3, 'latte', 200, 'ml')
    const bDay = { ...b0.plans.b, days: b0.plans.b.days.map((d, i) => (i === 3 ? { ...d, updatedAt: new Date().toISOString() } : d)) }
    const m = mergeDatabases({ ...a, plans: { ...a.plans, a: aDay } }, { ...b0, plans: { ...b0.plans, b: bDay } })
    const l = buildShoppingList(m)
    expect(l.map((x) => [x.name, x.total]).sort()).toEqual([['Latte', 200], ['Riso basmati', 50]])
  })
  it('è commutativo e idempotente', async () => {
    const base = fixtureDb()
    const a = toggleCheck(base, 'riso|g', true)
    await sleep()
    const b = addExtra(updateMember(base, 'a', { name: 'Anna M.' }), 'Sale')
    expect(sameState(mergeDatabases(a, b), mergeDatabases(b, a))).toBe(true)
    const m = mergeDatabases(a, b)
    expect(sameState(mergeDatabases(m, m), m)).toBe(true)
    expect(sameState(mergeDatabases(m, a), m)).toBe(true)
  })
  it('i tombstone propagano le cancellazioni', async () => {
    const base = fixtureDb()
    let a = addExtra(base, 'Sale')
    const synced = mergeDatabases(base, a)
    await sleep()
    a = { ...synced, shopping: { ...synced.shopping, extras: synced.shopping.extras.map((e) => ({ ...e, deleted: true, updatedAt: new Date().toISOString() })) } }
    expect(mergeDatabases(synced, a).shopping.extras[0].deleted).toBe(true)
  })
  it('unione di alimenti duplicati si propaga e ridirige le voci dei piani', async () => {
    let db = fixtureDb()
    db = { ...db, foodCatalog: [...db.foodCatalog, { id: 'riso2', name: 'Riso', unit: 'g', category: 'Dispensa', updatedAt: db.lastUpdated }] }
    db = put(db, 'a', 0, 'riso', 100, 'g')
    db = put(db, 'b', 0, 'riso2', 50, 'g')
    expect(buildShoppingList(db).filter((l) => l.unit === 'g')).toHaveLength(2)
    const merged = mergeFoods(db, 'riso', 'riso2')
    const l = buildShoppingList(merged)
    expect(l).toHaveLength(1)
    expect(l[0]).toMatchObject({ foodId: 'riso', total: 150 })
    expect(merged.foodCatalog.find((f) => f.id === 'riso2')!.deleted).toBe(true)
    expect(merged.foodCatalog.find((f) => f.id === 'riso')!.aliases).toContain('Riso')
    // anche dopo il merge con una copia vecchia la situazione resta consistente
    const again = mergeDatabases(db, merged)
    expect(buildShoppingList(again)).toHaveLength(1)
  })
  it('upsertItem sposta una voce tra pasti senza duplicarla', () => {
    let db = fixtureDb()
    db = upsertItem(db, 'a', 0, db.plans.a.days[0].meals[0].id, { id: 'i1', foodId: 'riso', quantity: 10, unit: 'g' })
    db = upsertItem(db, 'a', 0, db.plans.a.days[0].meals[2].id, { id: 'i1', foodId: 'riso', quantity: 20, unit: 'g' })
    const meals = db.plans.a.days[0].meals
    expect(meals[0].items).toHaveLength(0)
    expect(meals[2].items).toEqual([{ id: 'i1', foodId: 'riso', quantity: 20, unit: 'g' }])
  })
})

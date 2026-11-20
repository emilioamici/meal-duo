import { describe, expect, it } from 'vitest'
import { buildShoppingList, dayTotals, groupByCategory, isChecked, lineKey, shoppingProgress } from './shoppingListEngine'
import { fixtureDb, put } from '../test-helpers'
import { addExtra, resetShopping, toggleCheck, toggleExtra } from './dbOps'

function sample() {
  let db = fixtureDb()
  db = put(db, 'a', 0, 'riso', 90, 'g')        // Anna lun
  db = put(db, 'a', 1, 'riso', 90, 'g')        // Anna mar
  db = put(db, 'a', 5, 'riso', 0.1, 'kg')      // Anna sab: 100 g scritti in kg
  db = put(db, 'b', 0, 'riso', 60, 'g')        // Bruno lun
  db = put(db, 'b', 6, 'riso', 60, 'g')        // Bruno dom
  db = put(db, 'a', 0, 'latte', 250, 'ml')
  db = put(db, 'b', 0, 'latte', 0.5, 'l')      // 500 ml
  db = put(db, 'b', 2, 'uova', 2, 'pz')
  db = put(db, 'a', 2, 'uova', 1, 'pz')
  return db
}
const byName = (lines: ReturnType<typeof buildShoppingList>, n: string) => lines.find((l) => l.name === n)!

describe('buildShoppingList — somme', () => {
  it('somma tra membri e giorni con dettaglio per membro', () => {
    const l = buildShoppingList(sample())
    const riso = byName(l, 'Riso basmati')
    expect(riso.total).toBe(90 + 90 + 100 + 60 + 60) // 400
    expect(riso.unit).toBe('g')
    expect(riso.perMember).toEqual([{ memberId: 'a', quantity: 280 }, { memberId: 'b', quantity: 120 }])
    expect(riso.perMember.reduce((s, p) => s + p.quantity, 0)).toBe(riso.total)
  })
  it('converte kg→g e l→ml prima di sommare', () => {
    const l = buildShoppingList(sample())
    expect(byName(l, 'Latte')).toMatchObject({ total: 750, unit: 'ml' })
  })
  it('somma lo stesso alimento più volte nello stesso giorno (pasti diversi)', () => {
    let db = fixtureDb()
    db = put(db, 'a', 0, 'riso', 50, 'g', 0)
    db = put(db, 'a', 0, 'riso', 70, 'g', 4)
    expect(buildShoppingList(db)[0].total).toBe(120)
  })
  it('unità incompatibili per lo stesso alimento restano su righe separate', () => {
    let db = fixtureDb()
    db = put(db, 'a', 0, 'uova', 2, 'pz')
    db = put(db, 'a', 1, 'uova', 100, 'g')
    const l = buildShoppingList(db).filter((x) => x.foodId === 'uova')
    expect(l.map((x) => [x.unit, x.total]).sort()).toEqual([['g', 100], ['pz', 2]])
  })
  it('evita errori di virgola mobile', () => {
    let db = fixtureDb()
    for (let i = 0; i < 10; i++) db = put(db, 'a', 0, 'riso', 0.1, 'kg', i % 5)
    expect(buildShoppingList(db)[0].total).toBe(1000)
    let db2 = fixtureDb()
    db2 = put(db2, 'a', 0, 'uova', 0.1, 'pz'); db2 = put(db2, 'a', 1, 'uova', 0.2, 'pz')
    expect(buildShoppingList(db2)[0].total).toBe(0.3)
  })
  it('ignora quantità non positive e alimenti non in catalogo', () => {
    let db = fixtureDb()
    db = put(db, 'a', 0, 'riso', 0, 'g')
    db = put(db, 'a', 0, 'inesistente', 100, 'g')
    expect(buildShoppingList(db)).toEqual([])
  })
})

describe('buildShoppingList — filtri', () => {
  it('escludere un membro sottrae le sue quantità', () => {
    const l = buildShoppingList(sample(), { excludedMemberIds: ['b'], excludedDays: [] })
    const riso = byName(l, 'Riso basmati')
    expect(riso.total).toBe(280)
    expect(riso.perMember).toEqual([{ memberId: 'a', quantity: 280 }])
    expect(byName(l, 'Latte').total).toBe(250)
  })
  it('escludere tutti i membri → lista vuota', () => {
    expect(buildShoppingList(sample(), { excludedMemberIds: ['a', 'b'], excludedDays: [] })).toEqual([])
  })
  it('escludere il weekend (sab, dom)', () => {
    const riso = byName(buildShoppingList(sample(), { excludedMemberIds: [], excludedDays: [5, 6] }), 'Riso basmati')
    expect(riso.total).toBe(90 + 90 + 60) // lun+mar Anna, lun Bruno
    expect(riso.perMember).toEqual([{ memberId: 'a', quantity: 180 }, { memberId: 'b', quantity: 60 }])
  })
  it('solo lun-gio: escludere ven, sab, dom', () => {
    const l = buildShoppingList(sample(), { excludedMemberIds: [], excludedDays: [4, 5, 6] })
    expect(byName(l, 'Riso basmati').total).toBe(240)
  })
  it('un alimento il cui unico consumo è in un giorno escluso sparisce', () => {
    const l = buildShoppingList(sample(), { excludedMemberIds: [], excludedDays: [2] })
    expect(l.find((x) => x.name === 'Uova')).toBeUndefined()
  })
  it('filtri membro + giorno combinati', () => {
    const riso = byName(buildShoppingList(sample(), { excludedMemberIds: ['a'], excludedDays: [6] }), 'Riso basmati')
    expect(riso.total).toBe(60)
  })
  it('membri e piani eliminati (tombstone) non contribuiscono', () => {
    const db = sample()
    db.members = db.members.map((m) => (m.id === 'b' ? { ...m, deleted: true } : m))
    expect(byName(buildShoppingList(db), 'Riso basmati').total).toBe(280)
  })
  it('non muta il database in ingresso', () => {
    const db = sample()
    const before = JSON.stringify(db)
    buildShoppingList(db, { excludedMemberIds: ['a'], excludedDays: [0] })
    expect(JSON.stringify(db)).toBe(before)
  })
})

describe('spunte, extra e progresso', () => {
  it('le spunte sopravvivono al cambio di filtri (chiave stabile)', () => {
    let db = sample()
    db = toggleCheck(db, lineKey('riso', 'g'), true)
    expect(byName(buildShoppingList(db), 'Riso basmati').checked).toBe(true)
    expect(byName(buildShoppingList(db, { excludedMemberIds: ['b'], excludedDays: [] }), 'Riso basmati').checked).toBe(true)
  })
  it('"Nuova spesa" azzera le spunte e rimuove gli extra acquistati', () => {
    let db = sample()
    db = toggleCheck(db, lineKey('riso', 'g'), true)
    db = addExtra(db, 'carta forno'); db = addExtra(db, 'detersivo')
    db = toggleExtra(db, db.shopping.extras[0].id, true)
    db = resetShopping(db)
    expect(isChecked(db, lineKey('riso', 'g'))).toBe(false)
    expect(db.shopping.extras.filter((e) => !e.deleted).map((e) => e.name)).toEqual(['Detersivo'])
  })
  it('progresso = spuntati / (righe + extra)', () => {
    let db = sample()
    db = addExtra(db, 'Sale')
    db = toggleCheck(db, lineKey('latte', 'ml'), true)
    const lines = buildShoppingList(db)
    expect(shoppingProgress(db, lines)).toEqual({ done: 1, total: 4, pct: 25 })
  })
  it('raggruppa per categoria mantenendo l\'ordine di apparizione', () => {
    const g = groupByCategory(buildShoppingList(sample()))
    expect(g).toHaveLength(1)
    expect(g[0].lines.length).toBe(3)
  })
})

describe('dayTotals', () => {
  it('conta alimenti e somma g/ml/pz (con conversioni)', () => {
    const db = sample()
    expect(dayTotals(db.plans.a.days[0])).toEqual({ foods: 2, grams: 90, ml: 250, pieces: 0 })
    expect(dayTotals(db.plans.a.days[5]).grams).toBe(100)
    expect(dayTotals(undefined)).toEqual({ foods: 0, grams: 0, ml: 0, pieces: 0 })
  })
})

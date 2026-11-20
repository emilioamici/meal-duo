import { describe, expect, it } from 'vitest'
import { applyImport, exportPlan, parseDayName, parsePlanJson, planTemplate } from './planIO'
import { createDemoDb } from '../data/demo'
import { fixtureDb } from '../test-helpers'
import { buildShoppingList } from './shoppingListEngine'

describe('parsePlanJson', () => {
  it('il tracciato vuoto e quello di esempio sono validi e fanno round-trip', () => {
    for (const kind of ['empty', 'example'] as const) {
      const r = parsePlanJson(JSON.stringify(planTemplate(kind)))
      expect(r.errors).toEqual([])
      expect(r.ok).toBe(true)
      expect(r.plan!.days).toHaveLength(7)
    }
    const ex = parsePlanJson(JSON.stringify(planTemplate('example')))
    expect(ex.plan!.days[0].flatMap((m) => m.items)).toHaveLength(9)
  })
  it('accetta giorni come oggetto, nomi inglesi/abbreviati e quantità con virgola', () => {
    const r = parsePlanJson(JSON.stringify({ days: { mon: { meals: [{ name: 'Pranzo', items: [{ name: 'Riso', quantity: '1,5', unit: 'KG' }] }] }, Mar: [{ name: 'Cena', items: [] }] } }))
    expect(r.ok).toBe(true)
    expect(r.plan!.days[0][0].items[0]).toEqual({ name: 'Riso', quantity: 1.5, unit: 'kg' })
    expect(r.plan!.days[1][0].name).toBe('Cena')
    expect(r.warnings.join()).toMatch(/non presenti/)
  })
  it('segnala errori con percorso preciso', () => {
    const r = parsePlanJson(JSON.stringify({ days: [{ day: 'Lunedì', meals: [{ name: 'Pranzo', items: [{ name: '', quantity: 1, unit: 'g' }, { name: 'Pasta', quantity: -5, unit: 'g' }, { name: 'X', quantity: 'abc' }] }] }, { day: 'Funday', meals: [] }] }))
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('days[0].meals[0].items[0]'))).toBe(true)
    expect(r.errors.some((e) => e.includes('Pasta') && e.includes('maggiore di 0'))).toBe(true)
    expect(r.errors.some((e) => e.includes('Funday'))).toBe(true)
  })
  it('JSON non valido, radice errata, days mancante, giorno duplicato', () => {
    expect(parsePlanJson('{oops').errors[0]).toMatch(/JSON non valido/)
    expect(parsePlanJson('[]').ok).toBe(false)
    expect(parsePlanJson('{}').errors[0]).toMatch(/days/)
    expect(parsePlanJson(JSON.stringify({ days: [{ day: 'lun', meals: [] }, { day: 'Lunedì', meals: [] }] })).errors.join()).toMatch(/più volte/)
  })
  it('unità mancante → "g" con avviso', () => {
    const r = parsePlanJson(JSON.stringify({ days: [{ day: 'lun', meals: [{ name: 'P', items: [{ name: 'Pane', quantity: 50 }] }] }] }))
    expect(r.plan!.days[0][0].items[0].unit).toBe('g')
    expect(r.warnings.join()).toMatch(/unità mancante/)
  })
  it('parseDayName', () => {
    expect(parseDayName('Giovedì')).toBe(3)
    expect(parseDayName('sunday')).toBe(6)
    expect(parseDayName(2)).toBe(2)
    expect(parseDayName('xx')).toBeUndefined()
  })
})

describe('applyImport', () => {
  it('normalizza i nomi sul catalogo condiviso e crea solo gli alimenti nuovi', () => {
    const db = fixtureDb()
    const parsed = parsePlanJson(JSON.stringify({ days: [{ day: 'lun', meals: [{ name: 'Pranzo', items: [
      { name: 'RISO basmati', quantity: 80, unit: 'g' }, { name: 'uovo', quantity: 2, unit: 'pz' }, { name: 'Salmone', quantity: 150, unit: 'g' }, { name: 'salmone', quantity: 100, unit: 'g' },
    ] }] }] })).plan!
    const { db: out, report } = applyImport(db, 'a', parsed)
    expect(report.created).toEqual(['Salmone'])                 // una sola creazione, anche se citato due volte
    expect(report.matched).toEqual([{ from: 'uovo', to: 'Uova' }])
    expect(out.foodCatalog).toHaveLength(db.foodCatalog.length + 1)
    const l = buildShoppingList(out)
    expect(l.find((x) => x.name === 'Riso basmati')!.total).toBe(80)
    expect(l.find((x) => x.name === 'Salmone')!.total).toBe(250)
    expect(l.find((x) => x.name === 'Uova')!.total).toBe(2)
  })
  it('sostituisce solo il piano del membro scelto', () => {
    const db = createDemoDb()
    const parsed = parsePlanJson(JSON.stringify(planTemplate('empty'))).plan!
    const { db: out } = applyImport(db, 'mem_sara', parsed)
    expect(out.plans.mem_sara.days.every((d) => d.meals.every((m) => m.items.length === 0))).toBe(true)
    expect(out.plans.mem_emilio).toEqual(db.plans.mem_emilio)
  })
  it('export → import è l\'identità sulla spesa', () => {
    const db = createDemoDb()
    const exported = exportPlan(db, 'mem_emilio')
    const parsed = parsePlanJson(JSON.stringify(exported))
    expect(parsed.ok).toBe(true)
    const before = buildShoppingList(db, { excludedMemberIds: ['mem_sara'], excludedDays: [] })
    const { db: out, report } = applyImport(db, 'mem_emilio', parsed.plan!)
    expect(report.created).toEqual([])
    const after = buildShoppingList(out, { excludedMemberIds: ['mem_sara'], excludedDays: [] })
    expect(after.map((l) => [l.name, l.unit, l.total])).toEqual(before.map((l) => [l.name, l.unit, l.total]))
  })
})

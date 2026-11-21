import { describe, expect, it } from 'vitest'
import { applyImport, exportPlan, parseDayName, parsePlanJson, planTemplate } from './planIO'
import { createDemoDb } from '../data/demo'
import { fixtureDb } from '../test-helpers'
import { setVariant } from './dbOps'
import { variantsOf } from './variants'
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

describe('varianti nel JSON', () => {
  const withVariants = (variants: unknown, days: unknown = [{ day: 'lun', meals: [{ name: 'Pranzo', items: [{ name: 'Riso basmati', quantity: 80, unit: 'g' }] }] }]) => JSON.stringify({ days, variants })
  const pasta = { from: { name: 'Pasta', quantity: 100, unit: 'g' }, to: { name: 'Riso basmati', quantity: 120, unit: 'g' } }

  it('importa le varianti insieme al piano: 100 g di pasta = 120 g di riso, nei due sensi', () => {
    const parsed = parsePlanJson(withVariants([pasta]))
    expect(parsed.ok).toBe(true)
    const { db: out, report } = applyImport(fixtureDb(), 'a', parsed.plan!)
    expect(report.variants).toBe(1)
    expect(report.created).toEqual(['Pasta'])
    const riso = out.foodCatalog.find((f) => f.name === 'Riso basmati')!
    const pastaFood = out.foodCatalog.find((f) => f.name === 'Pasta')!
    expect(variantsOf(out, pastaFood.id)[0]).toMatchObject({ food: { id: riso.id }, ratio: 1.2 })
    expect(variantsOf(out, riso.id)[0].ratio).toBeCloseTo(100 / 120)
    expect(buildShoppingList(out).find((l) => l.name === 'Riso basmati')!.total).toBe(80) // il piano è stato importato
  })
  it('solo varianti: il piano del membro non si tocca', () => {
    const db = createDemoDb()
    const parsed = parsePlanJson(JSON.stringify({ variants: [{ from: { name: 'Farro', quantity: 100, unit: 'g' }, to: { name: 'Riso basmati', quantity: 110, unit: 'g' } }] }))
    expect(parsed.ok).toBe(true)
    expect(parsed.plan!.hasDays).toBe(false)
    const { db: out, report } = applyImport(db, 'mem_emilio', parsed.plan!)
    expect(report.variants).toBe(1)
    expect(out.plans.mem_emilio).toEqual(db.plans.mem_emilio)
  })
  it('le unità del file possono differire da quelle del catalogo (kg → g)', () => {
    const parsed = parsePlanJson(JSON.stringify({ variants: [{ from: { name: 'Riso basmati', quantity: 0.1, unit: 'kg' }, to: { name: 'Latte', quantity: 100, unit: 'ml' } }] }))
    expect(parsed.ok).toBe(false) // g e ml non sono confrontabili
    const ok2 = parsePlanJson(JSON.stringify({ variants: [{ from: { name: 'Riso basmati', quantity: 0.1, unit: 'kg' }, to: { name: 'Farro', quantity: 0.12, unit: 'kg' } }] }))
    const seeded = applyImport(fixtureDb(), 'a', parsePlanJson(JSON.stringify({ variants: [{ from: { name: 'Riso basmati', quantity: 1, unit: 'g' }, to: { name: 'Farro', quantity: 1, unit: 'g' } }] })).plan!).db // Farro nasce in g
    const { db: out } = applyImport(seeded, 'a', ok2.plan!)
    const riso = out.foodCatalog.find((f) => f.name === 'Riso basmati')!
    expect(riso.variants).toEqual([{ foodId: out.foodCatalog.find((f) => f.name === 'Farro')!.id, amount: 100, variantAmount: 120 }]) // salvate in g
  })
  it('un catalogo in pz non accetta una variante in g: viene saltata e segnalata', () => {
    const parsed = parsePlanJson(JSON.stringify({ variants: [{ from: { name: 'Uova', quantity: 100, unit: 'g' }, to: { name: 'Albume', quantity: 90, unit: 'g' } }] }))
    const { report, db } = applyImport(fixtureDb(), 'a', parsed.plan!)
    expect(report.variants).toBe(0)
    expect(report.variantsSkipped).toEqual(['Uova = Albume'])
    expect(db.foodCatalog.find((f) => f.name === 'Uova')!.variants).toBeUndefined()
  })
  it('errori con percorso preciso', () => {
    const r = parsePlanJson(JSON.stringify({ variants: [
      { from: { name: 'A', quantity: 1, unit: 'g' } },
      { from: { name: 'A', quantity: 0, unit: 'g' }, to: { name: 'B', quantity: 1, unit: 'g' } },
      { from: { name: 'Riso', quantity: 1, unit: 'g' }, to: { name: 'riso', quantity: 1, unit: 'g' } },
      { from: { name: 'A', quantity: 1, unit: 'g' }, to: { name: 'B', quantity: 1, unit: 'pz' } },
    ] }))
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('variants[0].to'))).toBe(true)
    expect(r.errors.some((e) => e.includes('variants[1].from') && e.includes('maggiore di 0'))).toBe(true)
    expect(r.errors.some((e) => e.includes('variants[2]') && e.includes('se stesso'))).toBe(true)
    expect(r.errors.some((e) => e.includes('variants[3]') && e.includes('confrontabili'))).toBe(true)
    expect(parsePlanJson(JSON.stringify({ days: [], variants: 'x' })).errors[0]).toMatch(/array di varianti/)
    expect(parsePlanJson('{}').errors[0]).toMatch(/days/)
  })
  it('export → import conserva le varianti (round-trip)', () => {
    let db = setVariant(createDemoDb(), 'food_pasta', 'food_riso', 100, 120)
    const f = db.foodCatalog
    const [a, b] = [f[0], f[1]]
    db = setVariant(createDemoDb(), a.id, b.id, 100, 130)
    const exported = exportPlan(db, 'mem_emilio') as { variants: unknown[] }
    expect(exported.variants).toEqual([{ from: { name: a.name, quantity: 100, unit: a.unit }, to: { name: b.name, quantity: 130, unit: b.unit } }])
    const parsed = parsePlanJson(JSON.stringify(exported))
    const { db: out } = applyImport(createDemoDb(), 'mem_emilio', parsed.plan!)
    expect(out.foodCatalog.find((x) => x.id === a.id)!.variants).toEqual([{ foodId: b.id, amount: 100, variantAmount: 130 }])
  })
  it('il tracciato di esempio contiene una variante valida, quello vuoto una lista vuota', () => {
    const ex = parsePlanJson(JSON.stringify(planTemplate('example')))
    expect(ex.plan!.variants).toHaveLength(1)
    expect(parsePlanJson(JSON.stringify(planTemplate('empty'))).plan!.variants).toEqual([])
    expect(JSON.stringify(planTemplate('empty'))).toContain('variants')
  })
})

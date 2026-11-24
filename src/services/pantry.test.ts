import { describe, expect, it } from 'vitest'
import { fixtureDb, put } from '../test-helpers'
import { checkLine, hideLine, mergeFoods, removeVariant, resetShopping, restoreLines, setMealDone, setPantryQuantity, setPurchaseQuantity, setVariant, uncheckLine } from './dbOps'
import { dateOfDay, pantryList, pantryStock } from './pantry'
import { variantQuantities, variantsOf } from './variants'
import { buildShoppingList } from './shoppingListEngine'
import { mergeDatabases, sameState } from './merge'
import { parseDb } from './dbSchema'
import type { AppDatabase } from '../types'

const sleep = () => new Promise((r) => setTimeout(r, 3))
const stock = (db: AppDatabase, id: string, unit = 'g') => pantryList(db).find((e) => e.foodId === id && e.unit === unit)?.quantity ?? 0
const line = (db: AppDatabase, key: string) => buildShoppingList(db).find((l) => l.key === key)!

/** Anna: pranzo del lunedì (indice 2) con 150 g di riso. */
const withRice = () => put(fixtureDb(), 'a', 0, 'riso', 150, 'g')
const mealId = (db: AppDatabase) => db.plans.a.days[0].meals[2].id

describe('dateOfDay', () => {
  it('lunedì = 0 della settimana corrente, in data locale', () => {
    const wed = new Date(2026, 10, 18) // mercoledì
    expect(dateOfDay(0, wed)).toBe('2026-11-16')
    expect(dateOfDay(2, wed)).toBe('2026-11-18')
    expect(dateOfDay(6, wed)).toBe('2026-11-22')
    expect(dateOfDay(0, new Date(2026, 10, 22))).toBe('2026-11-16') // domenica
    expect(dateOfDay(1, new Date(2026, 11, 31))).toBe('2026-12-29') // attraversa l'anno
  })
})

describe('dispensa: acquisti dalla spesa', () => {
  it('spuntare con una quantità riempie la dispensa, togliere la spunta la svuota', () => {
    let db = withRice()
    const l = line(db, 'riso|g')
    db = checkLine(db, l, 500)
    expect(stock(db, 'riso')).toBe(500)
    expect(db.shopping.checks['riso|g'].checked).toBe(true)
    db = uncheckLine(db, 'riso|g')
    expect(stock(db, 'riso')).toBe(0)
    db = checkLine(db, l, 300)
    expect(stock(db, 'riso')).toBe(300)
  })
  it('spuntare senza quantità non tocca la dispensa', () => {
    const db = checkLine(withRice(), line(withRice(), 'riso|g'), null)
    expect(pantryList(db)).toEqual([])
  })
  it('«Nuova spesa» azzera le spunte ma la dispensa resta', () => {
    let db = checkLine(withRice(), line(withRice(), 'riso|g'), 500)
    db = resetShopping(db)
    expect(db.shopping.checks).toEqual({})
    expect(stock(db, 'riso')).toBe(500)
  })
  it('la stessa riga spuntata da due dispositivi conta una volta sola', async () => {
    const base = withRice()
    const a = checkLine(base, line(base, 'riso|g'), 500)
    await sleep()
    const b = checkLine(base, line(base, 'riso|g'), 500)
    expect(stock(mergeDatabases(a, b), 'riso')).toBe(500)
    expect(stock(mergeDatabases(b, a), 'riso')).toBe(500)
  })
  it('due acquisti di righe diverse si sommano nel merge', async () => {
    const base = put(withRice(), 'a', 1, 'latte', 200, 'ml')
    const a = checkLine(base, line(base, 'riso|g'), 500)
    await sleep()
    const b = checkLine(base, line(base, 'latte|ml'), 1000)
    const m = mergeDatabases(a, b)
    expect(stock(m, 'riso')).toBe(500)
    expect(stock(m, 'latte', 'ml')).toBe(1000)
  })
  it('correzione manuale: porta la giacenza al valore indicato', () => {
    let db = checkLine(withRice(), line(withRice(), 'riso|g'), 500)
    db = setPantryQuantity(db, 'riso', 'g', 320)
    expect(stock(db, 'riso')).toBe(320)
    db = setPantryQuantity(db, 'riso', 'g', 0)
    expect(pantryList(db)).toEqual([])
  })
})

describe('lista: elimina con lo swipe e quantità modificabile', () => {
  it('eliminare una riga la toglie dalla lista e dai conteggi; ripristinare la riporta', () => {
    let db = withRice()
    db = hideLine(db, 'riso|g')
    expect(buildShoppingList(db)).toEqual([])
    const all = buildShoppingList(db, undefined, true)
    expect(all).toHaveLength(1)
    expect(all[0].hidden).toBe(true)
    db = restoreLines(db, ['riso|g'])
    expect(buildShoppingList(db)).toHaveLength(1)
    expect(buildShoppingList(db)[0].hidden).toBe(false)
  })
  it('eliminare una riga già presa toglie anche l\'acquisto dalla dispensa', () => {
    let db = checkLine(withRice(), line(withRice(), 'riso|g'), 500)
    db = hideLine(db, 'riso|g')
    expect(stock(db, 'riso')).toBe(0)
  })
  it('«Nuova spesa» riporta le righe eliminate', () => {
    const db = resetShopping(hideLine(withRice(), 'riso|g'))
    expect(buildShoppingList(db)).toHaveLength(1)
  })
  it('l\'eliminazione vince o perde per ultima scrittura, su qualunque dispositivo', async () => {
    const base = withRice()
    const a = hideLine(base, 'riso|g')
    await sleep()
    const b = restoreLines(base, ['riso|g'])
    expect(buildShoppingList(mergeDatabases(a, b))).toHaveLength(1)
    expect(buildShoppingList(mergeDatabases(b, a))).toHaveLength(1)
    expect(sameState(mergeDatabases(a, b), mergeDatabases(b, a))).toBe(true)
  })
  it('modificare la quantità di una riga già presa aggiorna la dispensa', () => {
    let db = checkLine(withRice(), line(withRice(), 'riso|g'), 500)
    db = setPurchaseQuantity(db, line(db, 'riso|g'), 750)
    expect(stock(db, 'riso')).toBe(750)
    db = setPurchaseQuantity(db, line(db, 'riso|g'), 0)
    expect(stock(db, 'riso')).toBe(0)
    db = setPurchaseQuantity(db, line(db, 'riso|g'), 200)
    expect(stock(db, 'riso')).toBe(200)
  })
  it('l\'eliminazione sopravvive a parseDb', () => {
    const db = hideLine(withRice(), 'riso|g')
    expect(buildShoppingList(parseDb(JSON.parse(JSON.stringify(db))))).toEqual([])
  })
})

describe('lista della spesa e dispensa', () => {
  it('la riga indica quanto ce n\'è già in dispensa, senza cambiare quanto serve', () => {
    let db = withRice()
    expect(line(db, 'riso|g').inPantry).toBe(0)
    db = setPantryQuantity(db, 'riso', 'g', 60)
    expect(line(db, 'riso|g')).toMatchObject({ total: 150, inPantry: 60 })
    db = setPantryQuantity(db, 'riso', 'g', 0)
    expect(line(db, 'riso|g').inPantry).toBe(0)
  })
})

describe('pasto completato', () => {
  it('scala gli alimenti dalla dispensa e riaprendolo li rimette', () => {
    let db = checkLine(withRice(), line(withRice(), 'riso|g'), 500)
    db = setMealDone(db, 'a', 0, mealId(db), true)
    expect(stock(db, 'riso')).toBe(350)
    expect(Object.values(db.pantry.meals)[0].date).toBe(dateOfDay(0))
    db = setMealDone(db, 'a', 0, mealId(db), false)
    expect(stock(db, 'riso')).toBe(500)
  })
  it('completare due volte non scala due volte', () => {
    let db = checkLine(withRice(), line(withRice(), 'riso|g'), 500)
    db = setMealDone(db, 'a', 0, mealId(db), true)
    db = setMealDone(db, 'a', 0, mealId(db), true)
    expect(stock(db, 'riso')).toBe(350)
  })
  it('non scala oltre quello che c\'è e segnala i mancanti; la dispensa non va sotto zero', () => {
    let db = checkLine(withRice(), line(withRice(), 'riso|g'), 100)
    db = setMealDone(db, 'a', 0, mealId(db), true)
    expect(stock(db, 'riso')).toBe(0)
    expect([...pantryStock(db).values()].every((q) => q >= 0)).toBe(true)
    expect(Object.values(db.pantry.meals)[0].missing).toBe(1)
    // riaprendo torna a 100: si rimette solo ciò che era stato davvero scalato
    db = setMealDone(db, 'a', 0, mealId(db), false)
    expect(stock(db, 'riso')).toBe(100)
  })
  it('dopo aver modificato il piano, riaprire il pasto rimette ciò che era stato scalato', () => {
    let db = checkLine(withRice(), line(withRice(), 'riso|g'), 500)
    db = setMealDone(db, 'a', 0, mealId(db), true)
    db = { ...db, plans: { ...db.plans, a: { ...db.plans.a, days: db.plans.a.days.map((d, i) => (i === 0 ? { ...d, meals: d.meals.map((m) => ({ ...m, items: [] })) } : d)) } } }
    db = setMealDone(db, 'a', 0, mealId(db), false)
    expect(stock(db, 'riso')).toBe(500)
  })
  it('lo stesso pasto completato su due dispositivi scala una volta sola', async () => {
    const base = checkLine(withRice(), line(withRice(), 'riso|g'), 500)
    const a = setMealDone(base, 'a', 0, mealId(base), true)
    await sleep()
    const b = setMealDone(base, 'a', 0, mealId(base), true)
    expect(stock(mergeDatabases(a, b), 'riso')).toBe(350)
  })
  it('un pasto completato non influisce sulla lista della spesa', () => {
    const db = checkLine(withRice(), line(withRice(), 'riso|g'), 500)
    expect(line(setMealDone(db, 'a', 0, mealId(db), true), 'riso|g').total).toBe(150)
  })
})

describe('varianti', () => {
  const withPasta = () => {
    const db = fixtureDb()
    return { ...db, foodCatalog: [...db.foodCatalog, { id: 'pasta', name: 'Pasta', unit: 'g', category: 'Pane, pasta e cereali' as const, updatedAt: db.lastUpdated }] }
  }

  it('100 g di pasta = 120 g di riso, nei due sensi', () => {
    const db = setVariant(withPasta(), 'pasta', 'riso', 100, 120)
    expect(variantQuantities(db, 'pasta', 200, 'g').map((v) => [v.option.food.id, v.quantity])).toEqual([['riso', 240]])
    expect(variantQuantities(db, 'riso', 120, 'g').map((v) => [v.option.food.id, Math.round(v.quantity)])).toEqual([['pasta', 100]])
    expect(variantQuantities(db, 'pasta', 0.2, 'kg')[0].quantity).toBeCloseTo(240) // 0,2 kg = 200 g
  })
  it('l\'unità non confrontabile non produce varianti; dichiarare al contrario sostituisce', () => {
    let db = setVariant(withPasta(), 'pasta', 'riso', 100, 120)
    expect(variantQuantities(db, 'pasta', 2, 'pz')).toEqual([])
    db = setVariant(db, 'riso', 'pasta', 120, 100)
    expect(db.foodCatalog.find((f) => f.id === 'pasta')!.variants).toBeUndefined()
    expect(variantsOf(db, 'pasta')).toHaveLength(1)
    db = removeVariant(db, 'pasta', 'riso')
    expect(variantsOf(db, 'pasta')).toEqual([])
    expect(variantsOf(db, 'riso')).toEqual([])
  })
  it('se manca la pasta, il pasto consuma il riso convertito', () => {
    let db = setVariant(withPasta(), 'pasta', 'riso', 100, 120)
    db = put(db, 'a', 0, 'pasta', 100, 'g')
    db = checkLine(db, { key: 'riso|g', foodId: 'riso', unit: 'g' }, 500)
    db = setMealDone(db, 'a', 0, mealId(db), true)
    expect(stock(db, 'riso')).toBe(380)
    expect(Object.values(db.pantry.meals)[0].consumed).toEqual([{ foodId: 'riso', unit: 'g', quantity: 120 }])
    expect(Object.values(db.pantry.meals)[0].missing).toBeUndefined()
    db = setMealDone(db, 'a', 0, mealId(db), false)
    expect(stock(db, 'riso')).toBe(500)
  })
  it('usa prima l\'alimento stesso e solo il resto dalla variante', () => {
    let db = setVariant(withPasta(), 'pasta', 'riso', 100, 120)
    db = put(db, 'a', 0, 'pasta', 100, 'g')
    db = checkLine(db, { key: 'pasta|g', foodId: 'pasta', unit: 'g' }, 40)
    db = checkLine(db, { key: 'riso|g', foodId: 'riso', unit: 'g' }, 500)
    db = setMealDone(db, 'a', 0, mealId(db), true)
    expect(stock(db, 'pasta')).toBe(0)
    expect(stock(db, 'riso')).toBe(500 - 72) // restano 60 g di pasta da coprire = 72 g di riso
  })
  it('unire due alimenti sposta varianti e dispensa su quello tenuto', () => {
    let db = setVariant(withPasta(), 'pasta', 'riso', 100, 120)
    db = checkLine(db, { key: 'pasta|g', foodId: 'pasta', unit: 'g' }, 300)
    db = { ...db, foodCatalog: [...db.foodCatalog, { id: 'spaghetti', name: 'Spaghetti', unit: 'g', category: 'Pane, pasta e cereali', updatedAt: db.lastUpdated }] }
    db = mergeFoods(db, 'spaghetti', 'pasta')
    expect(stock(db, 'spaghetti')).toBe(300)
    expect(variantsOf(db, 'spaghetti').map((v) => v.food.id)).toEqual(['riso'])
  })
})

describe('copia segnaposto', () => {
  it('i dati demo e vuoti hanno data antica (anno 2000) e i dati già salvati con la vecchia data restano «intatti»', async () => {
    const { isPristine, EPOCH } = await import('./dbOps')
    expect(EPOCH.startsWith('2000-')).toBe(true)
    expect(isPristine({ ...fixtureDb(), lastUpdated: EPOCH })).toBe(true)
    expect(isPristine({ ...fixtureDb(), lastUpdated: '2026-01-01T00:00:00.000Z' })).toBe(true) // salvata dalla versione precedente
    expect(isPristine({ ...fixtureDb(), lastUpdated: '2026-11-24T10:00:00.000Z' })).toBe(false)
  })
})

describe('persistenza', () => {
  it('parseDb conserva dispensa e varianti; un database senza dispensa si apre vuoto', () => {
    let db = setVariant(fixtureDb(), 'riso', 'latte', 100, 100)
    db = checkLine(put(db, 'a', 0, 'riso', 150, 'g'), { key: 'riso|g', foodId: 'riso', unit: 'g' }, 500)
    db = setMealDone(db, 'a', 0, mealId(db), true)
    const back = parseDb(JSON.parse(JSON.stringify(db)))
    expect(sameState(back, db)).toBe(true)
    const old = JSON.parse(JSON.stringify(db)); delete old.pantry
    expect(parseDb(old).pantry).toEqual({ purchases: {}, adjustments: {}, meals: {} })
  })
  it('il merge con la dispensa è commutativo e idempotente', async () => {
    const base = withRice()
    const a = checkLine(base, line(base, 'riso|g'), 500)
    await sleep()
    const b = setPantryQuantity(setMealDone(base, 'a', 0, mealId(base), true), 'riso', 'g', 80)
    const ab = mergeDatabases(a, b), ba = mergeDatabases(b, a)
    expect(sameState(ab, ba)).toBe(true)
    expect(sameState(mergeDatabases(ab, ab), ab)).toBe(true)
    expect(sameState(mergeDatabases(mergeDatabases(ab, a), b), ab)).toBe(true)
  })
})

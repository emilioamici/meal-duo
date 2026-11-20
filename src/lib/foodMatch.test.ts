import { describe, expect, it } from 'vitest'
import { findCanonical, findDuplicatePairs, guessCategory, normalizeName, searchFoods } from './foodMatch'
import type { FoodCatalogItem } from '../types'

const f = (id: string, name: string, aliases?: string[]): FoodCatalogItem => ({ id, name, unit: 'g', category: 'Dispensa', updatedAt: '', aliases })
const cat = [f('1', 'Petto di pollo'), f('2', 'Riso basmati'), f('3', 'Olio EVO'), f('4', 'Uova'), f('5', 'Pomodori'), f('6', 'Cosce di pollo'), f('7', 'Yogurt greco', ['yogurt'])]

describe('normalizeName', () => {
  it('ignora maiuscole, accenti e punteggiatura', () => {
    expect(normalizeName('  Caffè  d\'orzo! ')).toBe('caffe d orzo')
  })
})

describe('searchFoods (autocompletamento)', () => {
  it('"pollo" trova tutti gli alimenti con pollo', () => {
    expect(searchFoods(cat, 'pollo').map((x) => x.name).sort()).toEqual(['Cosce di pollo', 'Petto di pollo'])
  })
  it('case-insensitive e per prefisso', () => {
    expect(searchFoods(cat, 'RIS')[0].name).toBe('Riso basmati')
    expect(searchFoods(cat, 'petto')[0].name).toBe('Petto di pollo')
  })
  it('tollera plurale/singolare e typo', () => {
    expect(searchFoods(cat, 'pomodoro')[0].name).toBe('Pomodori')
    expect(searchFoods(cat, 'uovo')[0].name).toBe('Uova')
    expect(searchFoods(cat, 'basmatti')[0]?.name).toBe('Riso basmati')
  })
  it('cerca anche negli alias', () => {
    expect(searchFoods(cat, 'yogurt')[0].name).toBe('Yogurt greco')
  })
  it('query vuota o senza match → nessun suggerimento; esclude i tombstone', () => {
    expect(searchFoods(cat, '')).toEqual([])
    expect(searchFoods(cat, 'zzzz')).toEqual([])
    expect(searchFoods([{ ...cat[0], deleted: true }], 'pollo')).toEqual([])
  })
})

describe('findCanonical (associazione sicura per l\'import)', () => {
  it('nome identico, ordine dei token e plurali', () => {
    expect(findCanonical(cat, 'riso BASMATI')?.id).toBe('2')
    expect(findCanonical(cat, 'basmati riso')?.id).toBe('2')
    expect(findCanonical(cat, 'pomodoro')?.id).toBe('5')
    expect(findCanonical(cat, 'uovo')?.id).toBe('4')
  })
  it('alias', () => expect(findCanonical(cat, 'Yogurt')?.id).toBe('7'))
  it('"pollo" è ambiguo (petto/cosce) → nessuna associazione automatica', () => {
    expect(findCanonical(cat, 'pollo')).toBeUndefined()
  })
  it('sottoinsieme univoco → associa ("basmati" → Riso basmati)', () => {
    expect(findCanonical(cat, 'basmati')?.id).toBe('2')
  })
  it('alimento davvero nuovo → undefined', () => expect(findCanonical(cat, 'Salmone')).toBeUndefined())
})

describe('duplicati e categorie', () => {
  it('suggerisce coppie di probabili duplicati', () => {
    const pairs = findDuplicatePairs([f('a', 'Pollo'), f('b', 'Petto di pollo'), f('c', 'Riso')])
    expect(pairs).toHaveLength(1)
    expect(pairs[0].map((x) => x.id).sort()).toEqual(['a', 'b'])
  })
  it('indovina la categoria', () => {
    expect(guessCategory('Petto di pollo')).toBe('Carne e pesce')
    expect(guessCategory('Zucchine')).toBe('Frutta e verdura')
    expect(guessCategory('Parmigiano Reggiano')).toBe('Latticini e uova')
    expect(guessCategory('Riso basmati')).toBe('Pane, pasta e cereali')
    expect(guessCategory('Olio EVO')).toBe('Dispensa')
  })
})

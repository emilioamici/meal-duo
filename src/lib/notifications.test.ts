import { afterEach, describe, expect, it } from 'vitest'
import { diffNotifications, mergeNotifications } from './notifications'
import { fixtureDb, put } from '../test-helpers'
import { addExtra, copyDay, resetShopping, toggleCheck, toggleExtra } from '../services/dbOps'
import { setActor } from './actor'

afterEach(() => setActor(undefined))
const sleep = () => new Promise((r) => setTimeout(r, 3))

describe('diffNotifications', () => {
  it('nessuna modifica → nessuna notifica', () => {
    const db = fixtureDb()
    expect(diffNotifications(db, db, 'a')).toEqual([])
  })
  it('un altro aggiunge una voce extra', () => {
    const prev = fixtureDb()
    setActor('b')
    const next = addExtra(prev, 'carta forno', '2 rotoli')
    const n = diffNotifications(prev, next, 'a')
    expect(n).toHaveLength(1)
    expect(n[0]).toMatchObject({ kind: 'extra', title: 'Bruno ha aggiunto «Carta forno» alla spesa', body: '2 rotoli' })
  })
  it('mai notificato per le proprie modifiche', () => {
    const prev = fixtureDb()
    setActor('a')
    let next = addExtra(prev, 'Sale')
    next = toggleCheck(next, 'riso|g', true)
    expect(diffNotifications(prev, next, 'a')).toEqual([])
  })
  it('articolo spuntato da un altro: "ha preso <nome>"; solo alla prima spunta', () => {
    const prev = fixtureDb()
    setActor('b')
    const next = toggleCheck(prev, 'riso|g', true)
    const n = diffNotifications(prev, next, 'a')
    expect(n[0].title).toBe('Bruno ha preso Riso basmati')
    // già spuntato prima → nessuna notifica
    expect(diffNotifications(next, next, 'a')).toEqual([])
  })
  it('più di 3 spunte → riepilogo; extra spuntato conta come articolo', () => {
    const prev = fixtureDb()
    setActor('b')
    let next = prev
    for (const k of ['riso|g', 'latte|ml', 'uova|pz']) next = toggleCheck(next, k, true)
    next = addExtra(next, 'Sale')
    next = toggleExtra(next, next.shopping.extras[0].id, true)
    const n = diffNotifications(prev, next, 'a').filter((x) => x.kind === 'check')
    expect(n).toHaveLength(1)
    expect(n[0].title).toBe('Bruno ha spuntato 4 articoli')
  })
  it('"Nuova spesa" non genera notifiche di spunta', async () => {
    setActor('b')
    let prev = toggleCheck(fixtureDb(), 'riso|g', true)
    await sleep()
    const next = resetShopping(prev)
    expect(diffNotifications(prev, next, 'a').filter((x) => x.kind === 'check')).toEqual([])
    prev = next
  })
  it('un altro modifica il MIO piano; il piano di un terzo non mi riguarda', () => {
    const prev = put(fixtureDb(), 'a', 0, 'riso', 80, 'g')
    setActor('b')
    const next = copyDay(prev, 'a', 0, [1])
    const mine = diffNotifications(prev, next, 'a')
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ kind: 'plan', title: 'Bruno ha modificato il tuo piano', body: 'Martedì', memberId: 'a', day: 1 })
    const other = copyDay(prev, 'b', 0, [1])
    expect(diffNotifications(prev, other, 'a')).toEqual([])
  })
  it('molti giorni modificati → riepilogo', () => {
    const prev = fixtureDb()
    setActor('b')
    const next = copyDay(prev, 'a', 0, [1, 2, 3, 4, 5, 6])
    const n = diffNotifications(prev, next, 'a')
    expect(n[0]).toMatchObject({ title: 'Bruno ha aggiornato il tuo piano', body: '6 giorni modificati' })
  })
  it('mergeNotifications: senza duplicati, più recenti in testa', () => {
    const a = { id: '1', kind: 'extra' as const, title: '', body: '', at: '', read: false, tag: '' }
    const b = { ...a, id: '2' }
    expect(mergeNotifications([a], [a, b]).map((n) => n.id)).toEqual(['2', '1'])
  })
})

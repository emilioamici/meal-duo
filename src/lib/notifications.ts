import type { AppDatabase, DayIndex } from '../types'
import { DAY_INDEXES } from '../types'
import { dayLong, t, tp } from '../i18n'
import { extraChecked, isChecked } from '../services/shoppingListEngine'
import { nowIso } from './ids'

export type NotifKind = 'extra' | 'check' | 'plan'

export interface Notif {
  id: string
  kind: NotifKind
  title: string
  body: string
  at: string
  read: boolean
  /** raggruppa le notifiche push sullo stesso argomento (la più recente sostituisce le precedenti) */
  tag: string
  /** membro il cui piano è cambiato (per aprire la schermata giusta) */
  memberId?: string
  day?: DayIndex
}

const GROUP_AFTER = 3 // oltre questa soglia, per autore, si manda un riepilogo invece di una notifica per elemento

/**
 * Notifiche per il membro `me`, ricavate confrontando il DB prima e dopo l'arrivo di dati da altri.
 *  - un altro ha aggiunto una voce extra alla spesa
 *  - un altro ha spuntato articoli (chi fa la spesa vede cosa è già nel carrello)
 *  - un altro ha modificato il MIO piano settimanale
 * Mai notificato per le mie modifiche (`by === me`); le modifiche senza autore non generano notifiche.
 * Funzione pura: nessun accesso a storage o rete.
 */
export function diffNotifications(prev: AppDatabase, next: AppDatabase, me: string): Notif[] {
  const at = nowIso()
  const who = (id?: string) => (id ? next.members.find((m) => m.id === id)?.name ?? t('Un membro') : t('Un membro'))
  const foodName = (key: string) => next.foodCatalog.find((f) => f.id === key.split('|')[0])?.name ?? t('Un articolo')
  const out: Notif[] = []

  // ----- voci extra aggiunte
  const prevExtra = new Set(prev.shopping.extras.filter((e) => !e.deleted).map((e) => e.id))
  for (const e of next.shopping.extras) {
    if (e.deleted || prevExtra.has(e.id) || !e.by || e.by === me) continue
    out.push({ id: `extra:${e.id}`, kind: 'extra', at, read: false, tag: `extra:${e.id}`, title: t('{who} ha aggiunto «{name}» alla spesa', { who: who(e.by), name: e.name }), body: e.quantity ?? t('Voce extra') })
  }

  // ----- articoli spuntati (raggruppati per autore)
  const done = new Map<string, string[]>() // autore → nomi
  for (const c of Object.values(next.shopping.checks)) {
    if (c.deleted || !c.by || c.by === me || !isChecked(next, c.key) || isChecked(prev, c.key)) continue
    done.set(c.by, [...(done.get(c.by) ?? []), foodName(c.key)])
  }
  const prevExtraChecked = new Map(prev.shopping.extras.map((e) => [e.id, extraChecked(prev, e)]))
  for (const e of next.shopping.extras) {
    if (e.deleted || !e.by || e.by === me || !extraChecked(next, e) || prevExtraChecked.get(e.id)) continue
    done.set(e.by, [...(done.get(e.by) ?? []), e.name])
  }
  for (const [by, names] of done) {
    const sorted = [...names].sort()
    out.push({
      id: `check:${by}:${sorted.join(',')}`, kind: 'check', at, read: false, tag: `check:${by}`,
      title: sorted.length > GROUP_AFTER ? t('{who} ha spuntato {n} articoli', { who: who(by), n: sorted.length }) : t('{who} ha preso {names}', { who: who(by), names: sorted.join(', ') }),
      body: sorted.length > GROUP_AFTER ? sorted.slice(0, 3).join(', ') + '…' : t('Spunta aggiornata nella lista della spesa'),
    })
  }

  // ----- il mio piano modificato da un altro
  const prevPlan = prev.plans[me]
  const nextPlan = next.plans[me]
  if (nextPlan && !nextPlan.deleted) {
    const changed = DAY_INDEXES.filter((d) => {
      const n = nextPlan.days[d]
      return n && !n.deleted && n.by && n.by !== me && n.updatedAt !== prevPlan?.days[d]?.updatedAt
    })
    const byWho = new Map<string, DayIndex[]>()
    for (const d of changed) byWho.set(nextPlan.days[d].by!, [...(byWho.get(nextPlan.days[d].by!) ?? []), d])
    for (const [by, days] of byWho) {
      const stamp = Math.max(...days.map((d) => Date.parse(nextPlan.days[d].updatedAt)))
      out.push({
        id: `plan:${me}:${by}:${days.join('')}:${stamp}`, kind: 'plan', at, read: false, tag: `plan:${me}:${by}`, memberId: me, day: days[0],
        title: days.length > GROUP_AFTER ? t('{who} ha aggiornato il tuo piano', { who: who(by) }) : t('{who} ha modificato il tuo piano', { who: who(by) }),
        body: days.length > GROUP_AFTER ? tp(days.length, '{n} giorno modificato', '{n} giorni modificati', { n: days.length }) : days.map((d) => dayLong(d)).join(', '),
      })
    }
  }
  return out
}

const MAX_KEPT = 100

/** Aggiunge le nuove notifiche in testa, senza duplicati, mantenendo al massimo MAX_KEPT elementi. */
export function mergeNotifications(current: Notif[], incoming: Notif[]): Notif[] {
  const seen = new Set(current.map((n) => n.id))
  return [...incoming.filter((n) => !seen.has(n.id)), ...current].slice(0, MAX_KEPT)
}

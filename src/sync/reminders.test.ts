import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./push', () => ({ pushUrl: () => 'https://w.example' }))

import { cronSilent, loadReminders, remindersAvailable, reminderTexts, saveReminders, testReminder, triggerUrl } from './reminders'

let routes: Record<string, (body: any) => Response> = {}
const sent: Array<{ path: string; body: any; auth: string }> = []
beforeEach(() => {
  routes = {}; sent.length = 0
  vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
    const path = new URL(u).pathname
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    sent.push({ path, body, auth: new Headers(init?.headers).get('Authorization') ?? '' })
    return (routes[path] ?? (() => new Response('{"error":"Non trovato"}', { status: 404 })))(body)
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('indirizzo per le automazioni', () => {
  it('il pasto è un parametro dell\'indirizzo, codificato', () => {
    expect(triggerUrl('TOK')).toBe('https://w.example/reminder/in/TOK')
    expect(triggerUrl('TOK', 'Spuntino mattina')).toBe('https://w.example/reminder/in/TOK?meal=Spuntino%20mattina')
  })
})

describe('Worker', () => {
  it('un Worker vecchio non dichiara i promemoria: «non disponibile», non un errore', async () => {
    routes['/health'] = () => Response.json({ ok: true, auth: true, push: true, bridge: true })
    expect(await remindersAvailable()).toBe(false)
  })
  it('carica e salva con il fuso orario del dispositivo e i testi nella lingua dell\'app (con il segnaposto {meal} intatto)', async () => {
    routes['/reminders/get'] = () => Response.json({ ok: true, doc: { rules: [{ id: 'a1', meal: 'Pranzo', time: '13:00', days: [], on: true }] }, hasToken: true, lastRunAt: 5, house: true })
    routes['/reminders/save'] = () => Response.json({ ok: true })
    const s = await loadReminders('FILE', 'tok')
    expect(s).toEqual({ rules: [{ id: 'a1', meal: 'Pranzo', time: '13:00', days: [], on: true }], hasToken: true, lastRunAt: 5, house: true })
    await saveReminders('FILE', 'tok', s.rules)
    const body = sent.find((x) => x.path === '/reminders/save')!.body
    expect(body.fileId).toBe('FILE'); expect(typeof body.tz).toBe('string'); expect(body.texts.title).toBe('È ora di {meal}')
    expect(reminderTexts().titleAny).toBe('È ora di mangiare')
    expect(sent.every((x) => x.auth === 'Bearer tok' || x.path === '/health')).toBe(true)
  })
  it('errori del server → messaggio', async () => {
    routes['/reminders/test'] = () => Response.json({ error: 'Nessun accesso' }, { status: 403 })
    await expect(testReminder('FILE', 'tok', 'Pranzo')).rejects.toThrow('Nessun accesso')
  })
})

describe('cron silenzioso', () => {
  const base = { rules: [{ id: 'a', meal: 'Pranzo', time: '13:00', days: [], on: true }], hasToken: false, house: true }
  const now = Date.parse('2026-11-26T12:00:00Z')
  it('con promemoria accesi e nessun battito (o vecchio di ore) il server non sta eseguendo gli orari', () => {
    expect(cronSilent({ ...base, lastRunAt: null }, now)).toBe(true)
    expect(cronSilent({ ...base, lastRunAt: now - 4 * 3_600_000 }, now)).toBe(true)
    expect(cronSilent({ ...base, lastRunAt: now - 30 * 60_000 }, now)).toBe(false)
  })
  it('senza promemoria accesi non c\'è nulla da segnalare', () => {
    expect(cronSilent({ ...base, rules: [], lastRunAt: null }, now)).toBe(false)
    expect(cronSilent({ ...base, rules: [{ ...base.rules[0], on: false }], lastRunAt: null }, now)).toBe(false)
  })
})

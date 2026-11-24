import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./push', () => ({ pushUrl: () => 'https://w.example' }))
vi.mock('./auth', () => ({ sessionId: () => 'S'.repeat(40) }))

import { bridgeJoin } from './bridge'

let routes: Record<string, () => Response | Promise<Response>> = {}
beforeEach(() => {
  routes = { '/health': () => Response.json({ ok: true, bridge: true }) }
  vi.stubGlobal('fetch', vi.fn(async (u: string) => (routes[new URL(u).pathname] ?? (() => new Response('{"error":"Non trovato"}', { status: 404 })))()))
})
afterEach(() => vi.unstubAllGlobals())

describe('bridgeJoin (il codice è l\'ID del file)', () => {
  it('200: unito (o già dentro)', async () => {
    routes['/house/join'] = () => Response.json({ ok: true, joined: true })
    expect(await bridgeJoin('tok', 'FAMILYID12345')).toEqual({ ok: true, joined: true })
    routes['/house/join'] = () => Response.json({ ok: true, joined: false })
    expect(await bridgeJoin('tok', 'FAMILYID12345')).toEqual({ ok: true, joined: false })
  })
  it('Worker vecchio (404 «Non trovato»): nessun errore da mostrare, la catena prosegue', async () => {
    expect(await bridgeJoin('tok', 'FAMILYID12345')).toEqual({ ok: false, joined: false, error: undefined })
  })
  it('messaggi del server (codice sconosciuto, al completo) arrivano all\'utente', async () => {
    routes['/house/join'] = () => Response.json({ error: 'La famiglia è al completo (massimo 20 account).' }, { status: 403 })
    expect((await bridgeJoin('tok', 'FAMILYID12345')).error).toMatch(/al completo/)
  })
  it('401: serve un nuovo accesso; server irraggiungibile o ponte spento: niente eccezioni', async () => {
    routes['/house/join'] = () => Response.json({ error: 'Token non emesso per questa app' }, { status: 401 })
    await expect(bridgeJoin('tok', 'FAMILYID12345')).rejects.toMatchObject({ status: 401 })
    routes['/house/join'] = () => { throw new TypeError('rete') }
    expect(await bridgeJoin('tok', 'FAMILYID12345')).toMatchObject({ ok: false })
  })
})

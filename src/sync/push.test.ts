import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendPush, testOutcome, type PushResult } from './push'

const R = (o: Partial<PushResult>): PushResult => ({ ok: true, sent: 0, failed: 0, removed: 0, codes: [], ...o })

afterEach(() => vi.unstubAllGlobals())

const serverSays = (body: unknown, status = 200) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
}

describe('sendPush: esito dal server', () => {
  it('restituisce sent/failed/removed/codes, con 0 dove mancano', async () => {
    serverSays({ ok: true, sent: 1 })
    expect(await sendPush('f', 't', { recipients: ['a@b.it'], title: 'T', body: 'B' })).toEqual({ ok: true, sent: 1, failed: 0, removed: 0, codes: [] })
    serverSays({ ok: true, sent: 0, failed: 2, removed: 1, codes: [403, 413] })
    expect(await sendPush('f', 't', { recipients: ['a@b.it'], title: 'T', body: 'B' })).toEqual({ ok: true, sent: 0, failed: 2, removed: 1, codes: [403, 413] })
    serverSays({})
    expect(await sendPush('f', 't', { recipients: ['a@b.it'], title: 'T', body: 'B' })).toMatchObject({ sent: 0, failed: 0, removed: 0 })
  })
})

describe('testOutcome: il pulsante dice la verità', () => {
  it('sent > 0: inviata', () => {
    expect(testOutcome(R({ sent: 1 }))).toEqual({ text: 'Prova inviata dal server: dovrebbe arrivare tra pochi secondi.', bad: false })
    expect(testOutcome(R({ sent: 1 })).text).not.toContain('background')
  })
  it('removed > 0: iscrizione scaduta', () => {
    expect(testOutcome(R({ removed: 1 }))).toEqual({ text: "L'iscrizione di questo dispositivo era scaduta e il server l'ha tolta: disattiva e riattiva le notifiche, poi riprova.", bad: true })
  })
  it('failed > 0: rifiutato, con il codice', () => {
    expect(testOutcome(R({ failed: 1, codes: [403] }))).toEqual({
      text: 'Il server ha provato a inviare ma il servizio di notifiche del telefono ha rifiutato (codice 403). Disattiva e riattiva le notifiche; se continua, controlla le chiavi VAPID del server.', bad: true,
    })
    expect(testOutcome(R({ failed: 2, codes: [403, 403, 413] })).text).toContain('(codice 403, 413)')
    expect(testOutcome(R({ failed: 1 })).text).toContain('ha rifiutato. Disattiva')
  })
  it('nessun dispositivo: lo dice', () => {
    expect(testOutcome(R({}))).toEqual({ text: 'Il server non ha nessun dispositivo iscritto per la tua email: disattiva e riattiva le notifiche e riprova.', bad: true })
  })
})

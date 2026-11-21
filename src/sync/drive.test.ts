import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFile, isDatabaseFile, listCandidates, moveFile, parseFileId, removeShare, shareFile, updateFile } from './drive'

type Call = { url: string; method: string; body?: string }
const calls: Call[] = []
let responses: unknown[] = []
beforeEach(() => {
  calls.length = 0
  responses = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body as string | undefined })
    const r = responses.shift() ?? {}
    return new Response(JSON.stringify(r), { status: 200 })
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('Drive: spostamento', () => {
  it('moveFile: addParents/removeParents (senza togliere il nuovo padre)', async () => {
    responses = [{ id: 'f' }]
    await moveFile('tok', 'f', 'new', ['old', 'new'])
    expect(calls[0].method).toBe('PATCH')
    expect(calls[0].url).toContain('addParents=new')
    expect(calls[0].url).toContain('removeParents=old')
    expect(calls[0].url).not.toContain('removeParents=old%2Cnew')
  })
})

describe('Drive: file del database, inviti e revoche', () => {
  it('createFile: marcatore pubblico e writersCanShare=false (solo il proprietario invita)', async () => {
    responses = [{ id: 'x' }]
    await createFile('tok', '{"a":1}', 'meal-duo-db.json', 'folder1')
    const body = calls[0].body!
    const meta = JSON.parse(body.split('\r\n\r\n')[1].split('\r\n--')[0])
    expect(meta).toMatchObject({ name: 'meal-duo-db.json', writersCanShare: false, properties: { mealduo: 'db' }, parents: ['folder1'] })
    expect(body).toContain('{"a":1}')
  })
  it('updateFile: PATCH uploadType=media con il contenuto', async () => {
    responses = [{ id: 'x', version: '3' }]
    await updateFile('tok', 'x', '{"b":2}')
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: '{"b":2}' })
    expect(calls[0].url).toContain('uploadType=media')
  })
  it('shareFile: ruolo writer, email di invito', async () => {
    responses = [{}]
    await shareFile('tok', 'x', 'bruno@x.it', 'Ciao')
    expect(JSON.parse(calls[0].body!)).toEqual({ type: 'user', role: 'writer', emailAddress: 'bruno@x.it' })
    expect(calls[0].url).toContain('sendNotificationEmail=true')
  })
  it('removeShare: cancella solo i permessi di quell\'email e mai quello del proprietario', async () => {
    responses = [{ permissions: [{ id: 'p1', emailAddress: 'Bruno@x.it', role: 'writer' }, { id: 'p2', emailAddress: 'anna@x.it', role: 'owner' }, { id: 'p3', emailAddress: 'altro@x.it', role: 'writer' }] }, {}]
    expect(await removeShare('tok', 'x', 'bruno@x.it')).toBe(true)
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url.split('/permissions/')[1].split('?')[0])).toEqual(['p1'])
    responses = [{ permissions: [] }]
    expect(await removeShare('tok', 'x', 'nessuno@x.it')).toBe(false)
  })
  it('listCandidates cerca per marcatore o nome; isDatabaseFile riconosce entrambi', async () => {
    responses = [{ files: [] }]
    await listCandidates('tok')
    const q = decodeURIComponent(calls[0].url)
    expect(q).toContain("properties has { key='mealduo' and value='db' }")
    expect(q).toContain("name contains 'meal-duo'")
    const base = { id: '1', version: '1', modifiedTime: '' }
    expect(isDatabaseFile({ ...base, name: 'qualsiasi.json', properties: { mealduo: 'db' } })).toBe(true)
    expect(isDatabaseFile({ ...base, name: 'meal-duo-db.json' })).toBe(true)
    expect(isDatabaseFile({ ...base, name: 'altro.json' })).toBe(false)
  })
  it('parseFileId: link, ?id= e ID nudo', () => {
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz'
    expect(parseFileId(`https://drive.google.com/file/d/${id}/view?usp=sharing`)).toBe(id)
    expect(parseFileId(`https://drive.google.com/open?id=${id}`)).toBe(id)
    expect(parseFileId(id)).toBe(id)
    expect(parseFileId('troppo corto')).toBeNull()
  })
  it('errore HTTP → DriveError con stato', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 404 })))
    await expect(listCandidates('tok')).rejects.toMatchObject({ status: 404, message: 'nope' })
  })
})

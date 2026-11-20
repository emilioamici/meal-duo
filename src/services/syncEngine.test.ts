import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDatabase } from '../types'
import { fixtureDb } from '../test-helpers'
import { addExtra, toggleCheck } from './dbOps'

/** Finto Drive in memoria con revisione incrementale. */
const remote = { db: null as AppDatabase | null, rev: 1, canEdit: true, onGetMeta: null as null | (() => void) }
vi.mock('./googleDriveService', () => ({
  getMeta: vi.fn(async () => { remote.onGetMeta?.(); return { id: 'f', name: 'x', revision: String(remote.rev), canEdit: remote.canEdit } }),
  downloadDb: vi.fn(async () => structuredClone(remote.db!)),
  uploadDb: vi.fn(async (_c: unknown, _f: string, db: AppDatabase) => { remote.db = structuredClone(db); remote.rev++; return { id: 'f', name: 'x', revision: String(remote.rev), canEdit: true } }),
}))
import { syncWithDrive } from './syncEngine'
import { downloadDb, uploadDb } from './googleDriveService'

const cfg = { clientId: 'x' }
const sleep = () => new Promise((r) => setTimeout(r, 3))

beforeEach(() => { remote.db = fixtureDb(); remote.rev = 1; remote.canEdit = true; remote.onGetMeta = null; vi.clearAllMocks() })

describe('syncWithDrive', () => {
  it('nulla da fare: stessa revisione e non sporco → nessun download né upload', async () => {
    const r = await syncWithDrive({ cfg, fileId: 'f', local: remote.db!, knownRevision: '1', dirty: false })
    expect(r).toMatchObject({ pulled: false, pushed: false })
    expect(downloadDb).not.toHaveBeenCalled(); expect(uploadDb).not.toHaveBeenCalled()
  })
  it('modifiche locali: carica e aggiorna la revisione', async () => {
    const local = toggleCheck(remote.db!, 'riso|g', true)
    const r = await syncWithDrive({ cfg, fileId: 'f', local, knownRevision: '1', dirty: true })
    expect(r.pushed).toBe(true)
    expect(r.revision).toBe('2')
    expect(remote.db!.shopping.checks['riso|g'].checked).toBe(true)
  })
  it('remoto cambiato da un altro: scarica, fa il merge e ricarica entrambe le modifiche', async () => {
    const base = remote.db!
    await sleep()
    remote.db = addExtra(base, 'Carta forno'); remote.rev = 2          // l'altro ha aggiunto un extra
    await sleep()
    const local = toggleCheck(base, 'riso|g', true)                    // io ho spuntato il riso
    const r = await syncWithDrive({ cfg, fileId: 'f', local, knownRevision: '1', dirty: true })
    expect(r).toMatchObject({ pulled: true, pushed: true })
    expect(r.db.shopping.extras.map((e) => e.name)).toEqual(['Carta forno'])
    expect(r.db.shopping.checks['riso|g'].checked).toBe(true)
    expect(remote.db!.shopping.extras).toHaveLength(1)
    expect(remote.db!.shopping.checks['riso|g'].checked).toBe(true)
  })
  it('solo il remoto è cambiato: scarica senza ricaricare', async () => {
    const base = fixtureDb()
    remote.db = addExtra(base, 'Sale'); remote.rev = 2
    const r = await syncWithDrive({ cfg, fileId: 'f', local: base, knownRevision: '1', dirty: false })
    expect(r).toMatchObject({ pulled: true, pushed: false, revision: '2' })
    expect(uploadDb).not.toHaveBeenCalled()
  })
  it('race: il remoto cambia tra la lettura e la scrittura → rifà il merge e non perde nulla', async () => {
    const base = remote.db!
    await sleep()
    let calls = 0
    remote.onGetMeta = () => {                                          // al 2° getMeta (il "controllo prima di scrivere") arriva una scrittura altrui
      if (++calls === 2) { remote.db = addExtra(remote.db!, 'Scritto nel frattempo'); remote.rev++ }
    }
    await sleep()
    const local = toggleCheck(base, 'riso|g', true)
    const r = await syncWithDrive({ cfg, fileId: 'f', local, knownRevision: '1', dirty: true })
    expect(r.pushed).toBe(true)
    expect(remote.db!.shopping.extras.map((e) => e.name)).toEqual(['Scritto nel frattempo'])
    expect(remote.db!.shopping.checks['riso|g'].checked).toBe(true)
  })
  it('senza permessi di scrittura → errore chiaro', async () => {
    remote.canEdit = false
    await expect(syncWithDrive({ cfg, fileId: 'f', local: toggleCheck(remote.db!, 'a', true), knownRevision: '1', dirty: true })).rejects.toThrow(/permessi/)
  })
})

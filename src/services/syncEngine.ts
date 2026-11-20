/**
 * Sincronizzazione locale ⇄ Drive con controllo di versione ottimistico.
 *
 * Algoritmo (max 3 tentativi):
 *  1. legge i metadati remoti (headRevisionId/version);
 *  2. se la revisione è cambiata dall'ultima sync → scarica il remoto e fa il merge record-per-record (LWW);
 *  3. se il risultato differisce dal remoto → ri-controlla la revisione (evita race tra GET e PATCH) e carica;
 *  4. se la revisione è cambiata di nuovo nel frattempo, ricomincia dal punto 2.
 * Finestra di race residua (tra l'ultimo controllo e la PATCH): è chiusa dalla convergenza del merge, perché ogni
 * client conserva localmente le proprie modifiche e le ricarica alla sync successiva se non le trova sul remoto.
 */
import type { AppDatabase } from '../types'
import { mergeDatabases, sameState } from './merge'
import { downloadDb, getMeta, uploadDb } from './googleDriveService'
import type { DriveConfig } from './googleDriveService'

export interface SyncInput {
  cfg: DriveConfig
  fileId: string
  local: AppDatabase
  /** revisione remota vista all'ultima sync riuscita */
  knownRevision: string
  /** true se ci sono modifiche locali non ancora caricate */
  dirty: boolean
}

export interface SyncOutcome {
  db: AppDatabase
  revision: string
  pulled: boolean
  pushed: boolean
}

export async function syncWithDrive(input: SyncInput): Promise<SyncOutcome> {
  const { cfg, fileId } = input
  let local = input.local
  let known = input.knownRevision
  let pulled = false

  for (let attempt = 0; attempt < 3; attempt++) {
    const meta = await getMeta(cfg, fileId)
    let remote: AppDatabase | undefined
    if (meta.revision !== known) {
      remote = await downloadDb(cfg, fileId)
      const merged = mergeDatabases(local, remote)
      if (!sameState(merged, local)) pulled = true
      local = merged
      known = meta.revision
    } else if (!input.dirty && attempt === 0) {
      return { db: local, revision: meta.revision, pulled: false, pushed: false }
    }

    const needsPush = remote ? !sameState(local, remote) : input.dirty || attempt > 0
    if (!needsPush) return { db: local, revision: known, pulled, pushed: false }
    if (!meta.canEdit) throw new Error('Non hai i permessi di scrittura sul file (chiedi il ruolo "Editor").')

    const check = await getMeta(cfg, fileId)
    if (check.revision !== known) continue // qualcuno ha scritto nel frattempo: rifai il merge
    const written = await uploadDb(cfg, fileId, local)
    return { db: local, revision: written.revision, pulled, pushed: true }
  }
  throw new Error('Il database è stato modificato di continuo da un altro dispositivo: riprova tra un istante.')
}

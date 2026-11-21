import { pushUrl } from './push'
import { sessionId } from './auth'
import { DriveError, type DriveFile } from './drive'
import { parseDb } from '../services/dbSchema'
import type { AppDatabase } from '../types'
import { t } from '../i18n'

/**
 * Ponte del Worker verso il database su Drive (vedi worker/src/bridge.ts, stesso meccanismo di Clean Duo): chi è invitato
 * in una famiglia ma non ha accesso diretto al file (permesso `drive.file`) legge e scrive passando dal Worker, senza
 * Selettore di Google né ID. Funziona solo se chi ha creato la famiglia l'ha registrata aprendo l'app con l'accesso persistente.
 * L'autorizzazione resta la condivisione del file su Drive; il contenuto transita dal Worker ma non viene salvato.
 */

export class ConflictError extends Error {}

let availability: Promise<boolean> | null = null
/** Il Worker ha il ponte attivo? */
export function bridgeAvailable(): Promise<boolean> {
  const base = pushUrl()
  if (!base) return Promise.resolve(false)
  availability ??= fetch(base + '/health').then((r) => (r.ok ? r.json() : null)).then((j) => !!j?.bridge).catch(() => false)
  return availability
}

interface BridgeResult { status: number; json: any }

/** Chiamata al ponte. Non lancia per gli errori HTTP (li interpreta il chiamante); lancia solo se il server è irraggiungibile. */
async function post(path: string, token: string, body: unknown): Promise<BridgeResult> {
  const r = await fetch(pushUrl() + path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}

/** Chiamata con gli stessi errori di Drive: 409 = conflitto, 401 = sessione scaduta, 403/404/410 = niente accesso (messaggio del server). */
async function call(path: string, token: string, body: unknown): Promise<any> {
  const r = await post(path, token, body)
  if (r.status === 401) throw new DriveError(401, r.json?.error || t('Sessione Google scaduta'))
  if (r.status === 409) throw new ConflictError()
  if (r.status === 403 || r.status === 404 || r.status === 410) throw new DriveError(404, r.json?.error || t('Nessun accesso al database'))
  if (r.status !== 200) throw new Error(r.json?.error || t('Server di accesso non raggiungibile'))
  return r.json
}

export const bridgeMeta = async (token: string, fileId: string): Promise<DriveFile> => (await call('/db/meta', token, { fileId })).meta as DriveFile

export async function bridgeRead(token: string, fileId: string): Promise<{ meta: DriveFile; db: AppDatabase }> {
  const j = await call('/db/read', token, { fileId })
  return { meta: j.meta as DriveFile, db: parseDb(j.db) }
}

/** Scrive solo se la versione coincide: altrimenti ConflictError e il motore rilegge, fa il merge e riprova. */
export async function bridgeWrite(token: string, fileId: string, db: AppDatabase, expectedVersion: string): Promise<DriveFile> {
  return (await call('/db/write', token, { fileId, db, expectedVersion })).meta as DriveFile
}

/** Chi ha accesso diretto al file lo affida al ponte (con la sua sessione persistente). Silenzioso se non applicabile. */
export async function registerFamily(fileId: string, token: string): Promise<boolean> {
  const session = sessionId()
  if (!session || !(await bridgeAvailable())) return false
  try { return (await post('/house/register', token, { fileId, session })).status === 200 } catch { return false }
}

export interface BridgeFamily { id: string; name: string; modifiedTime: string }

/** Le famiglie a cui questo account è stato invitato e che si possono aprire dal ponte. */
export async function myFamilies(token: string): Promise<BridgeFamily[]> {
  if (!(await bridgeAvailable())) return []
  try {
    const r = await post('/house/mine', token, {})
    return r.status === 200 && Array.isArray(r.json.houses) ? (r.json.houses as BridgeFamily[]) : []
  } catch { return [] }
}

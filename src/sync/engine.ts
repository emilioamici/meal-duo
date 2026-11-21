import type { AppDatabase as Db } from '../types'
import { mergeDatabases, sameState } from '../services/merge'
import { parseDb } from '../services/dbSchema'
import { emptyDb, isPristine } from '../services/dbOps'
import { nowIso } from '../lib/ids'
import { t } from '../lib/text'
import type { CacheState } from '../state/cache'
import * as drive from './drive'
import { DB_FILE_NAME, DriveError } from './drive'
import { GoogleAuthError, cachedToken, clearToken, requestToken, revokeToken, setToken, tokenRemainingMs, type Prompt } from './google'
import { SessionExpired, brokerAvailable, hasSession, logoutBroker, refreshAccessToken, startBrokerLogin } from './auth'
import { pickDatabase, pickFolder, pickerConfigured, type Picked } from './picker'
import { ConflictError, bridgeAvailable, bridgeMeta, bridgeRead, bridgeWrite, myFamilies, registerFamily } from './bridge'
import { inviteLink } from './invite'

/**
 * Motore di sincronizzazione con un file JSON su Google Drive (stessa architettura di MoneyDuo).
 * Ciclo: leggi `version` remota → se cambiata scarica e fondi per record → ricontrolla la versione → carica solo se serve.
 * L'accesso può essere persistente (sessione sul Worker: il token si rinnova da solo) oppure a popup (token da 1 ora).
 */

/** ogni quanto si controlla se ci sono novità su Drive (anche in background) */
export const SYNC_EVERY_MS = 120_000
/** senza sessione persistente: si prova a rinnovare il token (in silenzio) negli ultimi 15 minuti o dopo la scadenza */
const RENEW_WINDOW_MS = 15 * 60_000
const RENEW_RETRY_MS = 10 * 60_000
/** con l'accesso persistente il token si rinnova quando mancano meno di 10 minuti */
const SILENT_RENEW_MS = 10 * 60_000
const MAX_ATTEMPTS = 3

const KEY = 'mealduo:sync'
const CLIENT_KEY = 'mealduo:clientId'

interface Persisted {
  fileId: string | null
  fileName: string | null
  email: string | null
  /** nome Google dell'account (nome predefinito del membro) */
  name: string | null
  /** email di chi ha creato la famiglia = proprietario del file */
  ownerEmail: string | null
  /** può invitare/rimuovere persone (proprietario del file) */
  canShare: boolean
  remoteVersion: string | null
  lastSyncAt: string | null
  dirty: boolean
  /** la famiglia si apre dal ponte del Worker (invitato senza accesso diretto al file) */
  bridged: boolean
}

export type SyncStatus = 'off' | 'auth' | 'pending' | 'syncing' | 'synced' | 'offline' | 'error'

export interface SyncState extends Persisted {
  status: SyncStatus
  error: string | null
  clientId: string
  signedIn: boolean
  /** i dati locali sono stati allineati a Drive in questa sessione (false = la copia locale non è affidabile: niente invii) */
  reconciled: boolean
  /** accesso persistente attivo: il token Google si rinnova da solo, senza popup */
  persistent: boolean
}

export interface SyncHost {
  getDb: () => Db
  /** applica una trasformazione al DB; `dirty` = va poi sincronizzato; `source: 'remote'` = dati arrivati da un altro dispositivo/membro */
  applyDb: (fn: (prev: Db) => Db, dirty: boolean, source?: 'remote') => void
  /** dopo un ciclo riuscito senza modifiche in attesa: i dati locali sono su Drive (serve a inviare le notifiche push in coda) */
  afterSync?: () => void
}

const EMPTY: Persisted = { fileId: null, fileName: null, email: null, name: null, ownerEmail: null, canShare: false, remoteVersion: null, lastSyncAt: null, dirty: false, bridged: false }

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...EMPTY, ...(JSON.parse(raw) as Partial<Persisted>) }
  } catch { /* noop */ }
  return { ...EMPTY }
}

const envClientId = (): string => (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || ''
function loadClientId(): string {
  try { return localStorage.getItem(CLIENT_KEY) || envClientId() } catch { return envClientId() }
}

/** Nessun accesso al file né dal ponte: se il Picker è configurato basta un tocco (ristretto a quel file) per concedere il permesso. */
export class NeedsPickerError extends Error {}
export interface ResolvedFamily { file: drive.DriveFile; remote: Db; bridged: boolean }
export interface FamilyChoice { id: string; name: string; modifiedTime: string; bridged: boolean }

const REGISTER_EVERY_MS = 3 * 24 * 3600 * 1000
const regKey = (id: string) => `mealduo:bridgeReg:${id}`

export class SyncEngine {
  private p: Persisted = loadPersisted()
  private clientId = loadClientId()
  private status: SyncStatus = 'off'
  private error: string | null = null
  private snapshot!: SyncState
  private listeners = new Set<() => void>()
  private host: SyncHost | null = null
  private debounce: ReturnType<typeof setTimeout> | undefined
  private running = false
  private rerun = false
  private dirtySeq = 0
  private started = false
  private renewing = false
  private reconciled = true
  /** come riallineare la copia locale alla prossima lettura di Drive: 'replace' = la copia manca, si adotta Drive; 'merge' = copia datata, si unisce */
  private pullMode: 'merge' | 'replace' = 'merge'
  private lastRenewTry = 0

  constructor() {
    // all'avvio: con la sessione persistente il rinnovo è in corso; offline si resta sui dati locali
    this.status = !this.p.fileId ? 'off'
      : cachedToken() ? (this.p.dirty ? 'pending' : 'synced')
      : hasSession() ? 'syncing'
      : typeof navigator !== 'undefined' && !navigator.onLine ? 'offline'
      : 'auth'
    this.rebuild()
  }

  // ----- store esterno per React -----
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getSnapshot = (): SyncState => this.snapshot

  private rebuild(): void {
    this.snapshot = { ...this.p, status: this.status, error: this.error, clientId: this.clientId, signedIn: !!cachedToken(), reconciled: this.reconciled, persistent: hasSession() }
    this.listeners.forEach((l) => l())
  }
  private persist(): void {
    try { localStorage.setItem(KEY, JSON.stringify(this.p)) } catch { /* noop */ }
  }
  private set(status: SyncStatus, error: string | null = null): void {
    this.status = status
    this.error = error
    this.rebuild()
  }

  // ----- ciclo di vita -----
  attach(host: SyncHost): void {
    this.host = host
    if (this.started) return
    this.started = true
    window.addEventListener('online', () => void this.syncNow())
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void this.syncNow() })
    // anche con l'app in background (i browser rallentano i timer): serve a ricevere le notifiche
    setInterval(() => void this.syncNow(), SYNC_EVERY_MS)
    // accesso persistente: il token si rinnova da solo, anche in background e senza tocchi
    setInterval(() => { if (tokenRemainingMs() < SILENT_RENEW_MS) void this.brokerRenew() }, 60_000)
    void this.brokerRenew().then(() => this.syncNow())
    // il rinnovo silenzioso del token va chiesto durante un gesto dell'utente, altrimenti il browser blocca il popup
    document.addEventListener('pointerdown', () => void this.renewIfNeeded(), { capture: true, passive: true })
    void this.syncNow()
  }

  /**
   * Da chiamare all'avvio con lo stato della copia locale. Se la copia manca o non corrisponde all'ultima versione di Drive
   * si dimentica la versione ricordata, così il prossimo ciclo RILEGGE Drive; finché non è fatto non si invia nulla
   * (una copia vuota non può sovrascrivere Drive).
   */
  checkCache(state: CacheState): void {
    if (!this.p.fileId) { this.reconciled = true; return this.rebuild() }
    if (state === 'ok') { this.reconciled = true; return this.rebuild() }
    this.reconciled = false
    this.pullMode = state === 'missing' ? 'replace' : 'merge'
    this.p.remoteVersion = null
    if (state === 'missing') this.p.dirty = false // le modifiche locali non inviate stavano nella copia persa
    this.persist()
    this.rebuild()
  }

  setClientId(id: string): void {
    this.clientId = id.trim()
    try { localStorage.setItem(CLIENT_KEY, this.clientId) } catch { /* noop */ }
    this.rebuild()
  }

  private brokerBusy: Promise<boolean> | null = null
  /** Rinnova il token tramite la sessione persistente (nessun popup). true se ora c'è un token valido. */
  brokerRenew(): Promise<boolean> {
    if (!hasSession()) return Promise.resolve(!!cachedToken())
    this.brokerBusy ??= (async () => {
      try {
        const r = await refreshAccessToken()
        if (!r) return !!cachedToken()
        setToken(r.token, r.expiresIn)
        if (r.email && r.email !== this.p.email) { this.p.email = r.email; this.persist() }
        if (this.status === 'auth') this.set(this.p.dirty ? 'pending' : 'synced')
        else this.rebuild()
        return true
      } catch (e) {
        if (!cachedToken()) {
          // sessione revocata/scaduta: serve un nuovo accesso; server non raggiungibile: si resta sui dati locali e si riprova
          if (e instanceof SessionExpired) this.set('auth')
          else if (this.p.fileId) this.set('offline')
        } else this.rebuild()
        return !!cachedToken()
      } finally { this.brokerBusy = null }
    })()
    return this.brokerBusy
  }

  /** Token Google valido adesso, oppure null: non apre mai popup. */
  currentToken(): string | null {
    return cachedToken()
  }

  /** Va chiamato dopo ogni modifica locale. */
  markDirty(): void {
    if (!this.p.fileId) return
    this.p.dirty = true
    this.dirtySeq++
    this.persist()
    if (this.status !== 'syncing' && this.status !== 'auth') this.set('pending')
    clearTimeout(this.debounce)
    this.debounce = setTimeout(() => void this.syncNow(), 2000)
  }

  // ----- azioni utente -----
  async signIn(opts: { selectAccount?: boolean } = {}): Promise<void> {
    // con il Worker configurato si passa da lì (accesso persistente): la pagina va su Google e torna qui
    if (await brokerAvailable()) { startBrokerLogin(opts.selectAccount ? null : this.p.email); return }
    const prompt: Prompt = opts.selectAccount ? 'select_account' : ''
    const token = await requestToken(this.clientId, { prompt, hint: opts.selectAccount ? undefined : this.p.email ?? undefined })
    const me = await drive.about(token)
    this.p.email = me.email
    this.p.name = me.name
    this.persist()
    if (this.status === 'auth') this.set(this.p.dirty ? 'pending' : 'synced')
    else this.rebuild()
    if (this.p.fileId) void this.syncNow()
  }

  /**
   * Rinnovo silenzioso del token (`prompt: 'none'`). Si chiama a ogni tocco: finché usi l'app la sessione non scade mai;
   * se non è possibile (sessione Google chiusa, consenso da rifare, popup bloccato) non succede nulla e resta «Riconnetti».
   */
  async renewIfNeeded(): Promise<void> {
    if (hasSession()) return // ci pensa la sessione persistente
    if (this.status === 'auth') return // sessione scaduta: l'accesso lo avvia il pulsante (evita due popup)
    if (!this.p.fileId || !this.p.email || this.renewing || !this.clientId) return
    if (tokenRemainingMs() > RENEW_WINDOW_MS) return
    if (Date.now() - this.lastRenewTry < RENEW_RETRY_MS) return
    this.renewing = true
    this.lastRenewTry = Date.now()
    try {
      await requestToken(this.clientId, { prompt: 'none', hint: this.p.email })
      this.lastRenewTry = 0
      this.rebuild()
      void this.syncNow()
    } catch { /* si riprova più tardi */ } finally {
      this.renewing = false
    }
  }

  async signOut(): Promise<void> {
    void logoutBroker()
    revokeToken()
    this.p = { ...EMPTY }
    this.persist()
    this.set('off')
  }

  /** Dopo l'accesso: ricava email e nome dell'account (serve a capire quale membro sei). */
  async loadProfile(): Promise<void> {
    const me = await drive.about(await this.token())
    this.p.email = me.email
    this.p.name = me.name
    this.persist()
    this.rebuild()
  }

  /** File con «meal-duo» nel nome visibili all'app (accesso diretto). */
  async listCandidates(): Promise<drive.DriveFile[]> {
    return drive.listCandidates(await this.token())
  }

  /** Famiglie che l'account può aprire: quelle con accesso diretto (create da qui) e quelle a cui è stato invitato, aperte dal ponte del Worker. */
  async listFamilies(): Promise<FamilyChoice[]> {
    const token = await this.token()
    const out: FamilyChoice[] = (await drive.listCandidates(token)).filter(drive.isDatabaseFile).map((f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, bridged: false }))
    for (const h of await myFamilies(token)) if (!out.some((o) => o.id === h.id)) out.push({ ...h, bridged: true })
    return out
  }

  /**
   * Crea la famiglia: un nuovo database nel Drive di chi lo crea (proprietario). Se sul dispositivo ci sono già dati propri
   * (non i dati demo) li tiene e gli dà solo il nome. Poi la affida al ponte del Worker, se c'è l'accesso persistente.
   */
  async createHouse(opts: { houseName: string; memberName: string; folderId: string | null; keepLocal: boolean }): Promise<void> {
    const token = await this.token()
    if (!this.p.email) await this.loadProfile()
    const email = this.p.email ?? ''
    const local = this.host!.getDb()
    const fresh = emptyDb(opts.houseName.trim() || t('La nostra famiglia'), opts.memberName.trim() || 'Io', email)
    const keep = opts.keepLocal && !isPristine(local)
    const db: Db = keep ? { ...local, houseName: fresh.houseName, lastUpdated: nowIso() } : { ...fresh, lastUpdated: nowIso() }
    const f = await drive.createFile(token, JSON.stringify(db), DB_FILE_NAME, opts.folderId)
    this.host!.applyDb((prev) => (keep ? { ...mergeDatabases(prev, db) } : db), false)
    this.reconciled = true
    this.p = { ...this.p, fileId: f.id, fileName: f.name, ownerEmail: this.p.email, canShare: true, bridged: false, remoteVersion: f.version, lastSyncAt: nowIso(), dirty: false }
    this.persist()
    this.set('synced')
    void this.registerBridge(true)
  }

  /** Scarica e valida un file (senza ancora collegarlo): da Drive, oppure dal ponte del Worker. */
  async inspect(fileId: string, bridged = false): Promise<{ file: drive.DriveFile; remote: Db }> {
    const token = await this.token()
    if (bridged) { const r = await bridgeRead(token, fileId); return { file: r.meta, remote: r.db } }
    const file = await drive.getMeta(token, fileId)
    const remote = parseDb(await drive.download(token, fileId))
    return { file, remote }
  }

  /**
   * Apre una famiglia dal suo ID (o dal link d'invito), come in Clean Duo: accesso diretto al file → ponte del Worker (nessun
   * Selettore, nessun ID da inserire) → Selettore di Google ristretto a quel file (un tocco, `picker: true`: serve un gesto).
   * `NeedsPickerError` = serve il tocco sul Picker.
   */
  async resolveFamily(input: string, picker = false): Promise<ResolvedFamily> {
    const id = drive.parseFileId(input)
    if (!id) throw new Error(t('ID famiglia non valido.'))
    const noAccess = (e: unknown): e is DriveError => e instanceof DriveError && (e.status === 404 || e.status === 403)
    try { return { ...(await this.inspect(id)), bridged: false } } catch (e) { if (!noAccess(e)) throw e }
    let bridgeMsg = ''
    if (await bridgeAvailable()) {
      try { return { ...(await this.inspect(id, true)), bridged: true } } catch (e) { if (!noAccess(e)) throw e; bridgeMsg = e.message }
    }
    if (!pickerConfigured()) throw new Error(bridgeMsg || t('Non riesco ad aprire la famiglia: controlla l\'ID e che ti abbia invitato con questo account Google.'))
    if (!picker) throw new NeedsPickerError()
    const f = await pickDatabase(await this.token(), id)
    if (!f) throw new NeedsPickerError()
    if (f.id !== id) throw new Error(t('Hai scelto un file diverso da quello dell\'invito.'))
    return { ...(await this.inspect(id)), bridged: false }
  }

  /** Collega un file esistente: `merge` unisce i dati locali, `replace` usa solo il file. */
  async link(file: drive.DriveFile, remote: Db, mode: 'merge' | 'replace', bridged = false): Promise<void> {
    this.host!.applyDb((prev) => (mode === 'merge' ? mergeDatabases(prev, remote) : remote), false)
    this.reconciled = true
    this.p = { ...this.p, fileId: file.id, fileName: file.name, ownerEmail: file.owners?.[0]?.emailAddress ?? null, canShare: !bridged && !!(file.ownedByMe || file.capabilities?.canShare), bridged, remoteVersion: file.version, lastSyncAt: nowIso(), dirty: mode === 'merge' }
    this.persist()
    this.set(mode === 'merge' ? 'pending' : 'synced')
    if (mode === 'merge') void this.syncNow()
    else void this.registerBridge()
  }

  unlink(): void {
    this.p = { ...this.p, fileId: null, fileName: null, remoteVersion: null, dirty: false, lastSyncAt: null, bridged: false }
    this.persist()
    this.set('off')
  }

  /** Le azioni sul file su Drive (inviti, cartella) le fa chi ha creato la famiglia: chi entra dal ponte non può. */
  private requireDirect(): void {
    if (this.p.bridged) throw new Error(t('Solo chi ha creato la famiglia può farlo.'))
  }

  /**
   * Chi ha creato la famiglia la affida al ponte del Worker (serve l'accesso persistente): gli invitati entrano senza Selettore né ID.
   * Si ripete ogni 3 giorni; `force` (dopo un invito) non aspetta: l'elenco degli invitati si aggiorna solo a ogni registrazione.
   */
  async registerBridge(force = false): Promise<boolean> {
    const id = this.p.fileId
    if (!id || this.p.bridged || !this.p.canShare || !hasSession()) return false
    let last = 0
    try { last = Number(localStorage.getItem(regKey(id))) || 0 } catch { /* noop */ }
    if (!force && Date.now() - last < REGISTER_EVERY_MS) return false
    const tk = cachedToken()
    if (!tk) return false
    const ok = await registerFamily(id, tk)
    if (ok) { try { localStorage.setItem(regKey(id), String(Date.now())) } catch { /* noop */ } }
    return ok
  }

  /** Invita un account Google: concede l'accesso in modifica al file (solo il proprietario). L'email contiene il link d'invito. */
  async invite(email: string, houseName: string): Promise<void> {
    if (!this.p.fileId) return
    this.requireDirect()
    await drive.shareFile(await this.token(), this.p.fileId, email.trim(), t('Ti invito nella famiglia «{name}» su Meal Duo. Apri questo link e accedi con questo account Google: la famiglia si apre da sola. {link}', { name: houseName, link: inviteLink(this.p.fileId) }))
    void this.registerBridge(true)
  }

  /** Revoca l'accesso al file a un account. false se non aveva permessi. */
  async revoke(email: string): Promise<boolean> {
    if (!this.p.fileId) return false
    this.requireDirect()
    return drive.removeShare(await this.token(), this.p.fileId, email.trim())
  }

  /** Nome della cartella che contiene il file (null se non visibile: file aperto dal ponte o condiviso da altri). */
  async currentFolder(): Promise<{ id: string; name: string } | null> {
    if (!this.p.fileId || this.p.bridged) return null
    const token = await this.token()
    const meta = await drive.getMeta(token, this.p.fileId)
    const id = meta.parents?.[0]
    return id ? { id, name: await drive.folderName(token, id).catch(() => t('Cartella')) } : null
  }
  /** Sposta il database in un'altra cartella scelta con il Picker (solo il proprietario). */
  async moveTo(folderId: string): Promise<void> {
    if (!this.p.fileId) return
    this.requireDirect()
    const token = await this.token()
    const meta = await drive.getMeta(token, this.p.fileId)
    await drive.moveFile(token, this.p.fileId, folderId, meta.parents ?? [])
  }

  /** Selettore di Google: il database della famiglia (anche condiviso da altri). */
  async pickDatabase(onlyFileId?: string): Promise<Picked | null> {
    return pickDatabase(await this.token(), onlyFileId)
  }
  /** Selettore di Google: una cartella del proprio Drive. */
  async pickFolder(): Promise<Picked | null> {
    this.requireDirect()
    return pickFolder(await this.token())
  }

  // ----- core -----
  private async token(): Promise<string> {
    const tk = cachedToken() ?? ((await this.brokerRenew()) ? cachedToken() : null)
    if (tk) return tk
    // gesto utente in corso (azioni dalla UI): richiede un nuovo token senza dialoghi se già autorizzato
    const fresh = await requestToken(this.clientId, { prompt: '', hint: this.p.email ?? undefined })
    this.rebuild()
    return fresh
  }

  async syncNow(): Promise<void> {
    if (!this.p.fileId || !this.host) return
    if (this.running) { this.rerun = true; return }
    if (!navigator.onLine) return this.set('offline')
    let token = cachedToken()
    if (!token && hasSession()) { await this.brokerRenew(); token = cachedToken() }
    if (!token) {
      // Worker non raggiungibile (non sessione revocata): si resta sui dati locali, senza chiedere di nuovo l'accesso
      if (hasSession() && (this.status as SyncStatus) === 'offline') return
      return this.set('auth')
    }

    this.running = true
    clearTimeout(this.debounce)
    this.set('syncing')
    try {
      const id = this.p.fileId
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const bridged = this.p.bridged
        const meta = bridged ? await bridgeMeta(token, id) : await drive.getMeta(token, id)
        if (!bridged) {
          // dal ponte i metadati non includono proprietario e permessi: restano quelli noti (e chi entra dal ponte non può invitare)
          const owner = meta.owners?.[0]?.emailAddress ?? this.p.ownerEmail
          const canShare = !!(meta.ownedByMe || meta.capabilities?.canShare)
          if (owner !== this.p.ownerEmail || canShare !== this.p.canShare) { this.p.ownerEmail = owner; this.p.canShare = canShare; this.persist() }
          if (meta.capabilities?.canEdit === false && this.p.dirty) throw new Error(t('Non hai i permessi di scrittura sul file: chiedi il ruolo «Editor».'))
        }
        let needPush = this.p.dirty

        // si legge Drive se la versione è cambiata OPPURE se la copia locale non è affidabile (versione dimenticata)
        if (this.p.remoteVersion === null || meta.version !== this.p.remoteVersion) {
          const remote = bridged ? (await bridgeRead(token, id)).db : parseDb(await drive.download(token, id))
          if (this.pullMode === 'replace') {
            this.host.applyDb(() => remote, false) // copia persa: si adotta Drive così com'è (senza notifiche)
          } else {
            let merged = this.host.getDb()
            this.host.applyDb((prev) => (merged = mergeDatabases(prev, remote)), false, 'remote')
            if (!sameState(merged, remote)) needPush = true
          }
          this.pullMode = 'merge'
          this.reconciled = true
          this.p.remoteVersion = meta.version
        }
        if (!this.reconciled) throw new Error(t('Copia locale non allineata a Drive: invio annullato per non sovrascrivere i dati.'))

        let version = meta.version
        if (needPush) {
          const seq = this.dirtySeq
          let f: drive.DriveFile
          if (bridged) {
            // il Worker scrive solo se la versione coincide (409 altrimenti): si rifà il merge e si riprova
            try { f = await bridgeWrite(token, id, this.host.getDb(), meta.version) } catch (e) {
              if (e instanceof ConflictError) { this.p.remoteVersion = null; continue }
              throw e
            }
          } else {
            // ricontrollo subito prima di scrivere: se qualcuno ha scritto nel frattempo, si rifà il merge (evita la race GET→PATCH)
            const check = await drive.getMeta(token, id)
            if (check.version !== meta.version) { this.p.remoteVersion = null; continue }
            f = await drive.updateFile(token, id, JSON.stringify(this.host.getDb()))
          }
          version = f.version
          // se nel frattempo ci sono state altre modifiche locali, restano "dirty" per il ciclo successivo
          this.p.dirty = this.dirtySeq !== seq
        }
        this.p.remoteVersion = version
        this.p.lastSyncAt = nowIso()
        this.persist()
        this.set(this.p.dirty ? 'pending' : 'synced')
        if (this.p.dirty) this.debounce = setTimeout(() => void this.syncNow(), 1000)
        else this.host.afterSync?.()
        void this.registerBridge()
        return
      }
      throw new Error(t('Il database viene modificato di continuo da un altro dispositivo: riprovo tra poco.'))
    } catch (e) {
      this.handleError(e)
    } finally {
      this.running = false
      if (this.rerun) {
        this.rerun = false
        void this.syncNow()
      }
    }
  }

  private handleError(e: unknown): void {
    if (e instanceof GoogleAuthError || (e instanceof DriveError && e.status === 401)) {
      clearToken()
      return this.set('auth', t('Sessione Google scaduta: riconnettiti per continuare a sincronizzare.'))
    }
    if (e instanceof DriveError) {
      if (e.status === 404 && this.p.bridged) return this.set('error', e.message || t('Non hai più accesso alla famiglia: chi l\'ha creata ti ha tolto l\'invito o deve riaprire l\'app.'))
      if (e.status === 404 && pickerConfigured()) return this.set('error', t('Non riesco ad aprire il database: scegli di nuovo il file con il selettore di Google (Impostazioni → Sincronizzazione e account). Se non lo vedi, forse sei stato rimosso dalla famiglia o il file è stato spostato.'))
      if (e.status === 404) return this.set('error', t('Non hai più accesso al database: forse sei stato rimosso dalla famiglia o il file è stato spostato. Puoi scollegarti dalle Impostazioni.'))
      if (e.status === 403) return this.set('error', t('Permesso negato: serve l\'accesso in modifica al file.') + ' ' + e.message)
      return this.set('error', t('Errore Google Drive ({status}): {message}', { status: e.status, message: e.message }))
    }
    if (e instanceof TypeError || !navigator.onLine) return this.set('offline')
    this.set('error', e instanceof Error ? e.message : String(e))
  }
}

export const engine = new SyncEngine()

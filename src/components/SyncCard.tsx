import { useEffect, useState } from 'react'
import { Cloud, CloudOff, Copy, LogOut, RefreshCw, ShieldCheck, Unplug, UserRound } from 'lucide-react'
import { ConfirmButton } from './ui'
import { useStore } from '../state/store'
import { useUi } from '../state/ui'
import { engine } from '../sync/engine'
import { brokerAvailable } from '../sync/auth'
import { pickerConfigured } from '../sync/picker'
import { copyText } from '../lib/files'

const STATUS_LABEL: Record<string, string> = {
  off: 'Non collegato', auth: 'Riconnessione necessaria', pending: 'Da sincronizzare', syncing: 'Sincronizzazione…',
  synced: 'Sincronizzato', offline: 'Offline', error: 'Errore',
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Stato della sincronizzazione e gestione dell'account. Il collegamento alla casa avviene dal foglio «Collega Google Drive». */
export function SyncCard() {
  const { sync, cacheOk } = useStore()
  const { setConnectOpen, showToast } = useUi()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [broker, setBroker] = useState(false)
  const [adv, setAdv] = useState({ clientId: sync.clientId, apiKey: localStorage.getItem('mealduo:googleApiKey') ?? '', appId: localStorage.getItem('mealduo:googleAppId') ?? '' })
  useEffect(() => { void brokerAvailable().then(setBroker) }, [])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('')
    try { await fn() } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  const saveAdv = () => {
    engine.setClientId(adv.clientId)
    try { localStorage.setItem('mealduo:googleApiKey', adv.apiKey.trim()); localStorage.setItem('mealduo:googleAppId', adv.appId.trim()) } catch { /* noop */ }
    showToast('Impostazioni Google salvate')
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <span className={`rounded-full p-2.5 ${sync.status === 'synced' ? 'bg-inc/15 text-inc' : 'bg-line text-muted'}`}>{sync.status === 'offline' ? <CloudOff size={20} /> : <Cloud size={20} />}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Google Drive</p>
          <p className="truncate text-xs text-muted">{STATUS_LABEL[sync.status]}{sync.lastSyncAt && sync.status === 'synced' ? ` · ${when(sync.lastSyncAt)}` : ''}</p>
        </div>
      </div>
      {sync.email && <p className="mb-3 flex items-center gap-2 text-sm text-muted"><UserRound size={15} />{sync.email}</p>}

      {(sync.error || err) && <p role="alert" className="mb-3 rounded-xl bg-exp/15 p-3 text-sm text-ink"><span className="font-bold text-exp">Errore: </span>{err || sync.error}</p>}
      {!cacheOk && <p className="mb-3 rounded-xl bg-brand/10 p-3 text-sm">Non riesco a salvare una copia dei dati su questo dispositivo (spazio del browser esaurito o archiviazione bloccata): a ogni apertura serve la connessione.</p>}

      {!sync.fileId ? (
        <>
          <p className="mb-3 text-sm text-muted">Stai usando i dati solo su questo dispositivo. Collega Google Drive per condividere la casa con i familiari e avere la spesa sempre aggiornata.</p>
          <button className="glass-btn btn-primary w-full !py-3" onClick={() => setConnectOpen(true)}><Cloud size={18} />Collega Google Drive</button>
        </>
      ) : (
        <>
          {sync.persistent ? (
            <p className="mb-3 flex items-start gap-2 rounded-xl bg-inc/15 p-3 text-sm"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-inc" />Accesso persistente attivo: la sessione Google si rinnova da sola, anche in background.</p>
          ) : broker ? (
            <button className="glass-btn mb-3 w-full" disabled={busy} onClick={() => run(() => engine.signIn())}><ShieldCheck size={18} />Attiva l'accesso persistente</button>
          ) : null}
          {pickerConfigured() && sync.status === 'error' && (
            <button className="glass-btn mb-3 w-full" disabled={busy} onClick={() => run(async () => {
              const f = await engine.pickDatabase()
              if (!f) return
              if (f.id !== sync.fileId) throw new Error(`Hai scelto un file diverso da quello collegato: scegli «${sync.fileName ?? ''}».`)
              await engine.syncNow()
            })}><Cloud size={18} />Scegli di nuovo il database</button>
          )}
          {!sync.signedIn ? (
            <button className="glass-btn btn-primary w-full !py-3" disabled={busy} onClick={() => run(() => engine.signIn())}>Riconnetti Google Drive</button>
          ) : (
            <button className="glass-btn btn-primary w-full !py-3" disabled={busy || sync.status === 'syncing'} onClick={() => void engine.syncNow()}><RefreshCw size={18} className={sync.status === 'syncing' ? 'animate-spin' : ''} />Sincronizza ora</button>
          )}
          <label className="label">ID del database</label>
          <div className="flex gap-2">
            <input className="field font-mono !text-xs" readOnly value={sync.fileId} aria-label="ID del file su Drive" onFocus={(e) => e.currentTarget.select()} />
            <button className="glass-btn !h-11 !w-11 shrink-0 !p-0" aria-label="Copia ID" onClick={async () => showToast((await copyText(sync.fileId!)) ? 'ID copiato' : 'Copia non riuscita')}><Copy size={16} /></button>
          </div>
          <p className="mt-1.5 px-1 text-xs text-muted">{sync.canShare ? 'Sei il proprietario: invita i familiari dalla scheda Membri.' : `Proprietario: ${sync.ownerEmail ?? 'altro account'}.`}</p>
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line/70 pt-3">
            <button className="glass-btn !px-2 !text-xs" disabled={busy} onClick={() => run(() => engine.signIn({ selectAccount: true }))}><UserRound size={15} />Account</button>
            <ConfirmButton className="!px-2 !text-xs" label={<><Unplug size={15} />Scollega</>} confirmLabel="Conferma" onConfirm={() => engine.unlink()} />
            <ConfirmButton className="!px-2 !text-xs" label={<><LogOut size={15} />Esci</>} confirmLabel="Conferma" onConfirm={() => void engine.signOut()} />
          </div>
        </>
      )}

      <details className="mt-4 rounded-2xl border border-line bg-bg/60 p-3 text-sm">
        <summary className="cursor-pointer font-semibold">Avanzate: Client ID, Picker</summary>
        <label className="label">Google Client ID</label>
        <input className="field" value={adv.clientId} autoCapitalize="none" spellCheck={false} placeholder="xxxx.apps.googleusercontent.com" onChange={(e) => setAdv({ ...adv, clientId: e.target.value })} />
        <label className="label">API Key (Picker)</label>
        <input className="field" value={adv.apiKey} autoCapitalize="none" spellCheck={false} onChange={(e) => setAdv({ ...adv, apiKey: e.target.value })} />
        <label className="label">App ID (numero progetto, Picker)</label>
        <input className="field" inputMode="numeric" value={adv.appId} onChange={(e) => setAdv({ ...adv, appId: e.target.value })} />
        <button className="glass-btn mt-3 w-full" onClick={saveAdv}>Salva</button>
        <p className="mt-2 text-xs text-muted">Di norma questi valori arrivano dalla build (variabili del repository). Con API Key e App ID il Picker è attivo e l'app chiede solo lo scope <code>drive.file</code>. Dopo averli cambiati ricarica l'app.</p>
      </details>
    </div>
  )
}

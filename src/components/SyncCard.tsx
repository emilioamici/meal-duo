import { useEffect, useState } from 'react'
import { Cloud, CloudOff, Copy, Folder, LogOut, RefreshCw, ShieldCheck, Unplug, UserRound } from 'lucide-react'
import { ConfirmButton } from './ui'
import { FolderPicker } from './FolderPicker'
import { useStore } from '../state/store'
import { useUi } from '../state/ui'
import { engine } from '../sync/engine'
import { brokerAvailable } from '../sync/auth'
import { pickerConfigured } from '../sync/picker'
import { copyText } from '../lib/files'
import { tb } from '../i18n/rich'
import { t, locale } from '../i18n'

const STATUS_LABEL: Record<string, string> = {
  off: 'Non collegato', auth: 'Riconnessione necessaria', pending: 'Da sincronizzare', syncing: 'Sincronizzazione…',
  synced: 'Sincronizzato', offline: 'Offline', error: 'Errore',
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Stato della sincronizzazione e gestione dell'account. Il collegamento alla casa avviene dal foglio «Collega Google Drive». */
export function SyncCard() {
  const { sync, cacheOk } = useStore()
  const { setConnectOpen, showToast } = useUi()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [broker, setBroker] = useState(false)
  const [folder, setFolder] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [adv, setAdv] = useState({ clientId: sync.clientId, apiKey: localStorage.getItem('mealduo:googleApiKey') ?? '', appId: localStorage.getItem('mealduo:googleAppId') ?? '' })
  useEffect(() => { void brokerAvailable().then(setBroker) }, [])
  // cartella che contiene il database (visibile solo se l'app può leggerla)
  useEffect(() => { if (sync.signedIn && sync.fileId) engine.currentFolder().then((f) => setFolder(f?.name ?? null)).catch(() => undefined) }, [sync.signedIn, sync.fileId])
  const move = (id: string, name: string) => run(async () => { await engine.moveTo(id); setFolder(name); showToast(t('Database spostato in «{name}»', { name })) })

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('')
    try { await fn() } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  const saveAdv = () => {
    engine.setClientId(adv.clientId)
    try { localStorage.setItem('mealduo:googleApiKey', adv.apiKey.trim()); localStorage.setItem('mealduo:googleAppId', adv.appId.trim()) } catch { /* noop */ }
    showToast(t('Impostazioni Google salvate'))
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <span className={`rounded-full p-2.5 ${sync.status === 'synced' ? 'bg-inc/15 text-inc' : 'bg-line text-muted'}`}>{sync.status === 'offline' ? <CloudOff size={20} /> : <Cloud size={20} />}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t('Google Drive')}</p>
          <p className="truncate text-xs text-muted">{t(STATUS_LABEL[sync.status])}{sync.lastSyncAt && sync.status === 'synced' ? ` · ${when(sync.lastSyncAt)}` : ''}</p>
        </div>
      </div>
      {sync.email && <p className="mb-3 flex items-center gap-2 text-sm text-muted"><UserRound size={15} />{sync.email}</p>}

      {(sync.error || err) && <p role="alert" className="mb-3 rounded-xl bg-exp/15 p-3 text-sm text-ink"><span className="font-bold text-exp">{t('Errore:')}{' '}</span>{err || sync.error}</p>}
      {!cacheOk && <p className="mb-3 rounded-xl bg-brand/10 p-3 text-sm">{t('Non riesco a salvare una copia dei dati su questo dispositivo (spazio del browser esaurito o archiviazione bloccata): a ogni apertura serve la connessione.')}</p>}

      {!sync.fileId ? (
        <>
          <p className="mb-3 text-sm text-muted">{t('Stai usando i dati solo su questo dispositivo. Collega Google Drive per condividere la casa con i familiari e avere la spesa sempre aggiornata.')}</p>
          <button className="glass-btn btn-primary w-full !py-3" onClick={() => setConnectOpen(true)}><Cloud size={18} />{t('Collega Google Drive')}</button>
        </>
      ) : (
        <>
          {sync.persistent ? (
            <p className="mb-3 flex items-start gap-2 rounded-xl bg-inc/15 p-3 text-sm"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-inc" />{t('Accesso persistente attivo: la sessione Google si rinnova da sola, anche in background.')}</p>
          ) : broker ? (
            <button className="glass-btn mb-3 w-full" disabled={busy} onClick={() => run(() => engine.signIn())}><ShieldCheck size={18} />{t('Attiva l\'accesso persistente')}</button>
          ) : null}
          {pickerConfigured() && sync.status === 'error' && (
            <button className="glass-btn mb-3 w-full" disabled={busy} onClick={() => run(async () => {
              const f = await engine.pickDatabase()
              if (!f) return
              if (f.id !== sync.fileId) throw new Error(t('Hai scelto un file diverso da quello collegato: scegli «{name}».', { name: sync.fileName ?? '' }))
              await engine.syncNow()
            })}><Cloud size={18} />{t('Scegli di nuovo il database')}</button>
          )}
          {!sync.signedIn ? (
            <button className="glass-btn btn-primary w-full !py-3" disabled={busy} onClick={() => run(() => engine.signIn())}>{t('Riconnetti Google Drive')}</button>
          ) : (
            <button className="glass-btn btn-primary w-full !py-3" disabled={busy || sync.status === 'syncing'} onClick={() => void engine.syncNow()}><RefreshCw size={18} className={sync.status === 'syncing' ? 'animate-spin' : ''} />{t('Sincronizza ora')}</button>
          )}
          <label className="label">{t('ID del database')}</label>
          <div className="flex gap-2">
            <input className="field font-mono !text-xs" readOnly value={sync.fileId} aria-label={t('ID del file su Drive')} onFocus={(e) => e.currentTarget.select()} />
            <button className="glass-btn !h-11 !w-11 shrink-0 !p-0" aria-label={t('Copia ID')} onClick={async () => showToast((await copyText(sync.fileId!)) ? t('ID copiato') : t('Copia non riuscita'))}><Copy size={16} /></button>
          </div>
          {sync.canShare && (
            <button type="button" className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-line bg-bg/60 px-3 py-2.5 text-left text-sm active:bg-line/30" disabled={busy}
              onClick={() => (pickerConfigured() ? void run(async () => { const f = await engine.pickFolder(); if (f) await move(f.id, f.name) }) : setPicking(true))}>
              <Folder size={18} className="shrink-0 text-brand" />
              <span className="min-w-0 flex-1"><span className="block text-xs text-muted">{t('Cartella del database')}</span><span className="block truncate font-semibold">{folder ?? t('Il mio Drive')}</span></span>
              <span className="text-xs font-semibold text-brand">{t('Sposta')}</span>
            </button>
          )}
          {picking && <FolderPicker title={t('Sposta il database')} onClose={() => setPicking(false)} onPick={(f) => { setPicking(false); void move(f.id, f.id === 'root' ? t('Il mio Drive') : f.name) }} />}
          <p className="mt-1.5 px-1 text-xs text-muted">{sync.canShare ? t('Sei il proprietario: invita i familiari dalla scheda Membri.') : t('Proprietario: {email}.', { email: sync.ownerEmail ?? t('altro account') })}</p>
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line/70 pt-3">
            <button className="glass-btn !px-2 !text-xs" disabled={busy} onClick={() => run(() => engine.signIn({ selectAccount: true }))}><UserRound size={15} />{t('Account')}</button>
            <ConfirmButton className="!px-2 !text-xs" label={<><Unplug size={15} />{t('Scollega')}</>} confirmLabel={t('Conferma')} onConfirm={() => engine.unlink()} />
            <ConfirmButton className="!px-2 !text-xs" label={<><LogOut size={15} />{t('Esci')}</>} confirmLabel={t('Conferma')} onConfirm={() => void engine.signOut()} />
          </div>
        </>
      )}

      <details className="mt-4 rounded-2xl border border-line bg-bg/60 p-3 text-sm">
        <summary className="cursor-pointer font-semibold">{t('Avanzate: Client ID, Picker')}</summary>
        <label className="label">{t('Google Client ID')}</label>
        <input className="field" value={adv.clientId} autoCapitalize="none" spellCheck={false} placeholder={t('xxxx.apps.googleusercontent.com')} onChange={(e) => setAdv({ ...adv, clientId: e.target.value })} />
        <label className="label">{t('API Key (Picker)')}</label>
        <input className="field" value={adv.apiKey} autoCapitalize="none" spellCheck={false} onChange={(e) => setAdv({ ...adv, apiKey: e.target.value })} />
        <label className="label">{t('App ID (numero progetto, Picker)')}</label>
        <input className="field" inputMode="numeric" value={adv.appId} onChange={(e) => setAdv({ ...adv, appId: e.target.value })} />
        <button className="glass-btn mt-3 w-full" onClick={saveAdv}>{t('Salva')}</button>
        <p className="mt-2 text-xs text-muted">{tb('Di norma questi valori arrivano dalla build (variabili del repository). Con API Key e App ID il Picker è attivo e l\'app chiede solo lo scope <code>drive.file</code>. Dopo averli cambiati ricarica l\'app.')}</p>
      </details>
    </div>
  )
}

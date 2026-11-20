import { useEffect, useState } from 'react'
import { Cloud, CloudOff, LogOut, RefreshCw, ShieldCheck, Unplug, UserRound } from 'lucide-react'
import { ConfirmButton } from './ui'
import { useStore } from '../state/store'
import { useUi } from '../state/ui'
import { engine } from '../sync/engine'
import { brokerAvailable } from '../sync/auth'
import { pickerConfigured } from '../sync/picker'
import { t } from '../i18n'

export const STATUS_LABEL: Record<string, string> = {
  off: 'Non collegato', auth: 'Riconnessione necessaria', pending: 'Da sincronizzare', syncing: 'Sincronizzazione…',
  synced: 'Sincronizzato', offline: 'Offline', error: 'Errore',
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Stato della sincronizzazione e gestione dell'account (stessa scheda di MoneyDuo). Il collegamento alla famiglia avviene dal
 * Gate / dal foglio «Collega Google Drive»; l'ID famiglia (l'ID del file) lo copia il proprietario dalla scheda Famiglia.
 */
export function SyncCard() {
  const { sync, cacheOk } = useStore()
  const { setConnectOpen } = useUi()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [broker, setBroker] = useState(false)
  useEffect(() => { void brokerAvailable().then(setBroker) }, [])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('')
    try { await fn() } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <span className={`rounded-full p-2.5 ${sync.status === 'synced' ? 'bg-inc/15 text-inc' : 'bg-line text-muted'}`}>{sync.status === 'offline' ? <CloudOff size={20} /> : <Cloud size={20} />}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t('Sincronizzazione Google Drive')}</p>
          <p className="truncate text-xs text-muted">{t(STATUS_LABEL[sync.status])}{sync.lastSyncAt && sync.status === 'synced' ? ` · ${when(sync.lastSyncAt)}` : ''}</p>
        </div>
      </div>
      {sync.email && <p className="mb-3 flex items-center gap-2 text-sm text-muted"><UserRound size={15} />{sync.email}</p>}
      {sync.bridged && <p className="mb-3 rounded-xl bg-bg/60 p-3 text-xs text-muted">{t('Sei entrato dall’invito: il database si apre dal server della famiglia (il Worker), senza selettore di Google.')}</p>}

      {sync.persistent ? (
        <p className="mb-3 flex items-start gap-2 rounded-xl bg-inc/15 p-3 text-sm"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-inc" />{t('Accesso persistente attivo: la sessione Google si rinnova da sola, anche in background.')}</p>
      ) : broker && sync.fileId ? (
        <button className="glass-btn mb-3 w-full" disabled={busy} onClick={() => run(() => engine.signIn())}><ShieldCheck size={18} />{t('Attiva l\'accesso persistente')}</button>
      ) : null}
      {!cacheOk && <p className="mb-3 rounded-xl bg-brand/10 p-3 text-sm">{t('Non riesco a salvare una copia dei dati su questo dispositivo (spazio del browser esaurito o archiviazione bloccata): a ogni apertura serve la connessione.')}</p>}
      {(sync.error || err) && <p role="alert" className="mb-3 rounded-xl bg-exp/15 p-3 text-sm"><span className="font-bold text-exp">{t('Errore:')} </span>{err || sync.error}</p>}

      {!sync.fileId ? (
        <>
          <p className="mb-3 text-sm text-muted">{t('Stai usando i dati solo su questo dispositivo. Collega Google Drive per condividere la famiglia e avere la spesa sempre aggiornata.')}</p>
          <button className="glass-btn btn-primary w-full !py-3" onClick={() => setConnectOpen(true)}><Cloud size={18} />{t('Collega Google Drive')}</button>
        </>
      ) : (
        <>
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
            <button className="glass-btn w-full" disabled={busy || sync.status === 'syncing'} onClick={() => void engine.syncNow()}><RefreshCw size={18} className={sync.status === 'syncing' ? 'animate-spin' : ''} />{t('Sincronizza ora')}</button>
          )}
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line/70 pt-3">
            <button className="glass-btn !px-2 !text-xs" disabled={busy} onClick={() => run(() => engine.signIn({ selectAccount: true }))}><UserRound size={16} />{t('Cambia account')}</button>
            <ConfirmButton className="!px-2 !text-xs" label={<><Unplug size={16} />{t('Scollega')}</>} confirmLabel={t('Conferma')} onConfirm={() => engine.unlink()} />
            <ConfirmButton className="!px-2 !text-xs" label={<><LogOut size={16} />{t('Esci')}</>} confirmLabel={t('Conferma')} onConfirm={() => void engine.signOut()} />
          </div>
        </>
      )}
    </div>
  )
}

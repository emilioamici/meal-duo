import { useEffect, useRef, useState } from 'react'
import { Folder, Link2, Loader2, RefreshCw, UserRound, Users } from 'lucide-react'
import { Sheet } from './ui'
import { FolderPicker, type PickedFolder } from './FolderPicker'
import { useStore } from '../state/store'
import { useUi } from '../state/ui'
import { engine } from '../sync/engine'
import { isDatabaseFile, parseFileId, type DriveFile } from '../sync/drive'
import { pickerConfigured } from '../sync/picker'
import { isPristine } from '../services/dbOps'
import { setLocalMode } from '../lib/localMode'
import type { AppDatabase } from '../types'
import { tb } from '../i18n/rich'
import { t, locale } from '../i18n'

type Phase = 'login' | 'searching' | 'choose' | 'none' | 'confirm'
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const when = (iso: string) => new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * Flusso di collegamento (la "schermata di accesso" di MoneyDuo, qui in un foglio perché Meal Duo funziona anche in locale):
 * accesso con Google → ricerca del database → collegamento automatico / scelta / creazione della casa / invito (Picker).
 */
export function ConnectFlow({ active, reconnect = false, onClose, allowLocal = false }: { active: boolean; reconnect?: boolean; onClose: () => void; allowLocal?: boolean }) {
  const { sync, db } = useStore()
  const { showToast } = useUi()
  const [phase, setPhase] = useState<Phase>('login')
  const [dbs, setDbs] = useState<DriveFile[]>([])
  const [others, setOthers] = useState<DriveFile[]>([])
  const [pending, setPending] = useState<{ file: DriveFile; remote: AppDatabase } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [link, setLink] = useState('')
  const [houseName, setHouseName] = useState(() => t('La nostra casa'))
  const [myName, setMyName] = useState('')
  const [keepLocal, setKeepLocal] = useState(true)
  const [folder, setFolder] = useState<PickedFolder>({ id: 'root', name: t('Il mio Drive') })
  const [picking, setPicking] = useState(false)
  const started = useRef(false)
  const hasLocalData = !isPristine(db)

  const close = () => { started.current = false; setErr(''); onClose() }
  const guard = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('')
    try { await fn() } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  const done = (text: string) => { showToast(text); close() }

  /** Se sul dispositivo ci sono dati propri chiede se unirli al file o usare solo il file. */
  const connect = async (id: string) => {
    const { file, remote } = await engine.inspect(id)
    if (hasLocalData) { setPending({ file, remote }); return setPhase('confirm') }
    await engine.link(file, remote, 'replace')
    done(t('Casa collegata'))
  }

  const search = async () => {
    setPhase('searching'); setErr('')
    try {
      if (!sync.email || !sync.name) await engine.loadProfile()
      const all = await engine.listCandidates()
      const found = all.filter(isDatabaseFile)
      setDbs(found); setOthers(all.filter((f) => !isDatabaseFile(f)))
      if (found.length === 1) return await connect(found[0].id) // una sola casa: collegamento automatico
      setPhase(found.length > 1 ? 'choose' : 'none')
    } catch (e) { setErr(msg(e)); setPhase('none') }
  }

  useEffect(() => {
    if (!active) return
    if (sync.fileId && !reconnect) return close() // già collegato
    // in riconnessione la casa è già collegata: basta rifare l'accesso, non si cerca nulla
    if (!reconnect && sync.signedIn && !started.current) { started.current = true; void search() }
    if (!sync.signedIn) setPhase('login')
  }, [active, sync.signedIn]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!myName && sync.name) setMyName(sync.name) }, [sync.name]) // eslint-disable-line react-hooks/exhaustive-deps

  const login = (selectAccount = false) => guard(async () => {
    started.current = false
    try { sessionStorage.setItem('mealduo:resume-connect', '1') } catch { /* noop */ }
    await engine.signIn({ selectAccount })
  })

  return (
    <>
      {err && <p role="alert" className="mb-3 rounded-xl bg-exp/15 p-3 text-sm text-ink"><span className="font-bold text-exp">{t('Errore:')}{' '}</span>{err}</p>}

      {phase === 'login' && reconnect && (
        <>
          <h2 className="text-lg font-bold">{t('Sessione Google scaduta')}</h2>
          <p className="mt-1 text-sm text-muted">{sync.email ? tb('Per continuare accedi di nuovo come <b>{email}</b>. I tuoi dati sono al sicuro su Drive e restano nascosti finché non accedi.', { email: sync.email }) : t('Per continuare accedi di nuovo con il tuo account Google. I tuoi dati sono al sicuro su Drive e restano nascosti finché non accedi.')}</p>
          <button className="glass-btn btn-primary mt-4 w-full !py-3" disabled={busy} onClick={() => void login()}>
            {busy ? <Loader2 size={18} className="animate-spin" /> : <UserRound size={18} />}{t('Accedi con Google')}</button>
          <button className="mt-3 w-full text-xs font-semibold text-muted" disabled={busy} onClick={() => void login(true)}>{t('Usa un altro account Google')}</button>
          <button className="mt-2 w-full text-xs font-semibold text-muted" disabled={busy} onClick={() => engine.unlink()}>{t('Scollega questa casa')}</button>
        </>
      )}

      {phase === 'login' && !reconnect && (
        <>
          <p className="text-sm text-muted">{tb('Accedi con il <b>tuo account Google</b>. Se qualcuno ti ha invitato in una casa la ritrovo io; altrimenti puoi crearne una nuova. I dati restano nel tuo Drive.')}</p>
          {!sync.clientId && (
            <div className="mt-3 rounded-xl border border-brand/40 bg-brand/10 p-3 text-sm">
              <p className="mb-2">{t('Manca il Client ID OAuth di Google Cloud (vedi README).')}</p>
              <input className="field" placeholder={t('xxxx.apps.googleusercontent.com')} autoCapitalize="none" spellCheck={false} onBlur={(e) => engine.setClientId(e.target.value)} />
            </div>
          )}
          <button className="glass-btn btn-primary mt-4 w-full !py-3" disabled={busy || !sync.clientId} onClick={() => void login()}>
            {busy ? <Loader2 size={18} className="animate-spin" /> : <UserRound size={18} />}{t('Accedi con Google')}</button>
          {allowLocal && <button className="mt-3 w-full text-sm font-semibold text-brand" onClick={() => { setLocalMode(true); onClose() }}>{t('Prova senza account (dati demo)')}</button>}
        </>
      )}

      {phase === 'searching' && <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted"><Loader2 className="animate-spin text-brand" />{t('Cerco la tua casa su Drive…')}</div>}

      {phase === 'choose' && (
        <>
          <p className="text-sm text-muted">{t('Hai accesso a più case. Quale vuoi aprire?')}</p>
          <FileList files={dbs} busy={busy} onPick={(id) => void guard(() => connect(id))} />
        </>
      )}

      {phase === 'confirm' && pending && (
        <>
          <p className="text-sm text-muted">{t('Su questo dispositivo ci sono dati non ancora presenti in «{name}» (modificato {when}). Vuoi unirli ai dati del file o usare solo il file? In quel caso i dati locali verranno scartati.', { name: pending.file.name, when: when(pending.file.modifiedTime) })}</p>
          <button className="glass-btn btn-primary mt-4 w-full" disabled={busy} onClick={() => void guard(async () => { await engine.link(pending.file, pending.remote, 'merge'); done(t('Casa collegata')) })}>{t('Unisci ai dati del file')}</button>
          <button className="glass-btn mt-2 w-full" disabled={busy} onClick={() => void guard(async () => { await engine.link(pending.file, pending.remote, 'replace'); done(t('Casa collegata')) })}>{t('Usa solo il file Drive')}</button>
          <button className="mt-3 w-full text-sm font-semibold text-muted" onClick={() => setPhase('none')}>{t('Annulla')}</button>
        </>
      )}

      {phase === 'none' && (
        <>
          <p className="text-sm">{tb('Nessuna casa trovata per <b>{email}</b>.', { email: sync.email ?? t('questo account') })}</p>

          {pickerConfigured() ? (
            <div className="mt-3 space-y-2 rounded-2xl border border-line bg-bg/60 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold"><Folder size={16} className="text-brand" />{t('Hai ricevuto un invito?')}</p>
              <p className="text-xs text-muted">{t('Il proprietario ha condiviso il database con te: scegli quel file su Drive (lo trovi in «Condivisi con me»). Lo si fa una volta sola.')}</p>
              <button className="glass-btn btn-primary w-full" disabled={busy} onClick={() => void guard(async () => { const f = await engine.pickDatabase(); if (f) await connect(f.id) })}><Folder size={18} />{t('Scegli il database della casa')}</button>
            </div>
          ) : (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted">{t('Ho il link o l\'ID del file')}</summary>
              <p className="mt-2 text-xs text-muted">{t('Senza il Picker (API Key e App ID) l\'app vede solo i file creati da lei: per un file di un altro account configura il Picker (README §3).')}</p>
              <div className="mt-2 flex gap-2">
                <input className="field" placeholder={t('Link o ID del file Drive')} value={link} autoCapitalize="none" spellCheck={false} onChange={(e) => setLink(e.target.value)} />
                <button className="glass-btn btn-primary" disabled={busy || !parseFileId(link)} onClick={() => void guard(() => connect(parseFileId(link)!))}><Link2 size={16} />{t('Collega')}</button>
              </div>
            </details>
          )}

          <div className="mt-3 space-y-1 rounded-2xl border border-line bg-bg/60 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold"><Users size={16} className="text-brand" />{t('Crea la tua casa')}</p>
            <p className="text-xs text-muted">{t('Il database sarà un file nel tuo Drive: tu sei il proprietario e inviti gli altri dalle Impostazioni.')}</p>
            <label className="label">{t('Nome della casa')}</label>
            <input className="field" value={houseName} onChange={(e) => setHouseName(e.target.value)} />
            <label className="label">{t('Il tuo nome')}</label>
            <input className="field" value={myName} onChange={(e) => setMyName(e.target.value)} />
            {(
              <button type="button" className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2.5 text-left text-sm active:bg-line/30"
                onClick={() => (pickerConfigured() ? void guard(async () => { const f = await engine.pickFolder(); if (f) setFolder(f) }) : setPicking(true))}>
                <Folder size={18} className="shrink-0 text-brand" />
                <span className="min-w-0 flex-1"><span className="block text-xs text-muted">{t('Cartella del database')}</span><span className="block truncate font-semibold">{folder.name}</span></span>
                <span className="text-xs font-semibold text-brand">{t('Cambia')}</span>
              </button>
            )}
            {picking && <FolderPicker onClose={() => setPicking(false)} onPick={(f) => { setFolder(f); setPicking(false) }} />}
            {hasLocalData && (
              <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={keepLocal} onChange={(e) => setKeepLocal(e.target.checked)} />{t('Porta con me i dati già presenti su questo dispositivo')}</label>
            )}
            <button className="glass-btn btn-primary mt-3 w-full !py-3" disabled={busy || !houseName.trim()}
              onClick={() => void guard(async () => { await engine.createHouse({ houseName, memberName: myName, folderId: folder.id === 'root' ? null : folder.id, keepLocal }); done(t('Casa creata su Drive')) })}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Users size={18} />}{t('Crea casa')}</button>
          </div>

          <p className="mt-3 text-sm text-muted">{tb('Aspetti un invito? Chiedi al proprietario di aggiungere <b>{email}</b>, poi', { email: sync.email ?? t('la tua email') })}<button className="ml-1 inline-flex items-center gap-1 font-semibold text-brand" disabled={busy} onClick={() => void search()}><RefreshCw size={14} />{t('cerca di nuovo')}</button>.</p>

          {others.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted">{t('Altri file con «meal-duo» nel nome')}</summary>
              <div className="mt-2"><FileList files={others} busy={busy} onPick={(id) => void guard(() => connect(id))} /></div>
            </details>
          )}
          <button className="mt-3 w-full text-xs font-semibold text-muted" disabled={busy} onClick={() => void login(true)}>{t('Usa un altro account Google')}</button>
        </>
      )}
    </>
  )
}

function FileList({ files, busy, onPick }: { files: DriveFile[]; busy: boolean; onPick: (id: string) => void }) {
  return (
    <div className="mt-3 space-y-2">
      {files.map((f) => (
        <button key={f.id} disabled={busy} onClick={() => onPick(f.id)} className="w-full rounded-2xl border border-line bg-surface p-3 text-left text-sm active:bg-line/30">
          <p className="font-semibold">{f.name}</p>
          <p className="text-xs text-muted">{f.ownedByMe ? t('Creato da te') : t('Proprietario: {email}', { email: f.owners?.[0]?.emailAddress ?? t('altro account') })} · {when(f.modifiedTime)}</p>
        </button>
      ))}
    </div>
  )
}

/** Foglio per collegare Google Drive quando si usa l'app in locale (dalle Impostazioni o dalla pillola «Locale»). */
export function ConnectSheet() {
  const { connectOpen, setConnectOpen } = useUi()
  return (
    <Sheet open={connectOpen} onClose={() => setConnectOpen(false)} title={t('Collega Google Drive')}>
      <ConnectFlow active={connectOpen} onClose={() => setConnectOpen(false)} />
    </Sheet>
  )
}

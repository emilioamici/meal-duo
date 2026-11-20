import { useEffect, useRef, useState } from 'react'
import { Folder, Link2, Loader2, RefreshCw, UserRound, Users } from 'lucide-react'
import { Sheet } from './ui'
import { useStore } from '../state/store'
import { useUi } from '../state/ui'
import { engine } from '../sync/engine'
import { isDatabaseFile, parseFileId, type DriveFile } from '../sync/drive'
import { pickerConfigured } from '../sync/picker'
import { isPristine } from '../services/dbOps'
import type { AppDatabase } from '../types'

type Phase = 'login' | 'searching' | 'choose' | 'none' | 'confirm'
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const when = (iso: string) => new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * Flusso di collegamento (la "schermata di accesso" di MoneyDuo, qui in un foglio perché Meal Duo funziona anche in locale):
 * accesso con Google → ricerca del database → collegamento automatico / scelta / creazione della casa / invito (Picker).
 */
export function ConnectSheet() {
  const { sync, db } = useStore()
  const { connectOpen, setConnectOpen, showToast } = useUi()
  const [phase, setPhase] = useState<Phase>('login')
  const [dbs, setDbs] = useState<DriveFile[]>([])
  const [others, setOthers] = useState<DriveFile[]>([])
  const [pending, setPending] = useState<{ file: DriveFile; remote: AppDatabase } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [link, setLink] = useState('')
  const [houseName, setHouseName] = useState('La nostra casa')
  const [myName, setMyName] = useState('')
  const [keepLocal, setKeepLocal] = useState(true)
  const [folder, setFolder] = useState<{ id: string; name: string }>({ id: 'root', name: 'Il mio Drive' })
  const started = useRef(false)
  const hasLocalData = !isPristine(db)

  const close = () => { setConnectOpen(false); started.current = false; setErr('') }
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
    done('Casa collegata')
  }

  const search = async () => {
    setPhase('searching'); setErr('')
    try {
      if (!sync.email) await engine.loadProfile()
      const all = await engine.listCandidates()
      const found = all.filter(isDatabaseFile)
      setDbs(found); setOthers(all.filter((f) => !isDatabaseFile(f)))
      if (found.length === 1) return await connect(found[0].id) // una sola casa: collegamento automatico
      setPhase(found.length > 1 ? 'choose' : 'none')
    } catch (e) { setErr(msg(e)); setPhase('none') }
  }

  useEffect(() => {
    if (!connectOpen) return
    if (sync.fileId) return close() // già collegato
    if (sync.signedIn && !started.current) { started.current = true; void search() }
    if (!sync.signedIn) setPhase('login')
  }, [connectOpen, sync.signedIn]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!myName && sync.name) setMyName(sync.name) }, [sync.name]) // eslint-disable-line react-hooks/exhaustive-deps

  const login = (selectAccount = false) => guard(async () => {
    started.current = false
    try { sessionStorage.setItem('mealduo:resume-connect', '1') } catch { /* noop */ }
    await engine.signIn({ selectAccount })
  })

  return (
    <Sheet open={connectOpen} onClose={close} title="Collega Google Drive">
      {err && <p role="alert" className="mb-3 rounded-xl bg-exp/15 p-3 text-sm text-ink"><span className="font-bold text-exp">Errore: </span>{err}</p>}

      {phase === 'login' && (
        <>
          <p className="text-sm text-muted">Accedi con il <b className="text-ink">tuo account Google</b>. Se qualcuno ti ha invitato in una casa la ritrovo io; altrimenti puoi crearne una nuova. I dati restano nel tuo Drive.</p>
          {!sync.clientId && (
            <div className="mt-3 rounded-xl border border-brand/40 bg-brand/10 p-3 text-sm">
              <p className="mb-2">Manca il Client ID OAuth di Google Cloud (vedi README).</p>
              <input className="field" placeholder="xxxx.apps.googleusercontent.com" autoCapitalize="none" spellCheck={false} onBlur={(e) => engine.setClientId(e.target.value)} />
            </div>
          )}
          <button className="glass-btn btn-primary mt-4 w-full !py-3" disabled={busy || !sync.clientId} onClick={() => void login()}>
            {busy ? <Loader2 size={18} className="animate-spin" /> : <UserRound size={18} />}Accedi con Google
          </button>
        </>
      )}

      {phase === 'searching' && <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted"><Loader2 className="animate-spin text-brand" />Cerco la tua casa su Drive…</div>}

      {phase === 'choose' && (
        <>
          <p className="text-sm text-muted">Hai accesso a più case. Quale vuoi aprire?</p>
          <FileList files={dbs} busy={busy} onPick={(id) => void guard(() => connect(id))} />
        </>
      )}

      {phase === 'confirm' && pending && (
        <>
          <p className="text-sm text-muted">Su questo dispositivo ci sono dati non ancora presenti in «{pending.file.name}» (modificato {when(pending.file.modifiedTime)}). Vuoi unirli ai dati del file o usare solo il file? In quel caso i dati locali verranno scartati.</p>
          <button className="glass-btn btn-primary mt-4 w-full" disabled={busy} onClick={() => void guard(async () => { await engine.link(pending.file, pending.remote, 'merge'); done('Casa collegata') })}>Unisci ai dati del file</button>
          <button className="glass-btn mt-2 w-full" disabled={busy} onClick={() => void guard(async () => { await engine.link(pending.file, pending.remote, 'replace'); done('Casa collegata') })}>Usa solo il file Drive</button>
          <button className="mt-3 w-full text-sm font-semibold text-muted" onClick={() => setPhase('none')}>Annulla</button>
        </>
      )}

      {phase === 'none' && (
        <>
          <p className="text-sm">Nessuna casa trovata per <b>{sync.email ?? 'questo account'}</b>.</p>

          <div className="mt-3 space-y-1 rounded-2xl border border-line bg-bg/60 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold"><Users size={16} className="text-brand" />Crea la tua casa</p>
            <p className="text-xs text-muted">Il database sarà un file nel tuo Drive: tu sei il proprietario e inviti gli altri dalla scheda Famiglia.</p>
            <label className="label">Nome della casa</label>
            <input className="field" value={houseName} onChange={(e) => setHouseName(e.target.value)} />
            <label className="label">Il tuo nome</label>
            <input className="field" value={myName} onChange={(e) => setMyName(e.target.value)} />
            {pickerConfigured() && (
              <button type="button" className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2.5 text-left text-sm active:bg-line/30"
                onClick={() => void guard(async () => { const f = await engine.pickFolder(); if (f) setFolder(f) })}>
                <Folder size={18} className="shrink-0 text-brand" />
                <span className="min-w-0 flex-1"><span className="block text-xs text-muted">Cartella del database</span><span className="block truncate font-semibold">{folder.name}</span></span>
                <span className="text-xs font-semibold text-brand">Cambia</span>
              </button>
            )}
            {hasLocalData && (
              <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={keepLocal} onChange={(e) => setKeepLocal(e.target.checked)} />Porta con me i dati già presenti su questo dispositivo</label>
            )}
            <button className="glass-btn btn-primary mt-3 w-full !py-3" disabled={busy || !houseName.trim()}
              onClick={() => void guard(async () => { await engine.createHouse({ houseName, memberName: myName, folderId: folder.id === 'root' ? null : folder.id, keepLocal }); done('Casa creata su Drive') })}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Users size={18} />}Crea casa
            </button>
          </div>

          {pickerConfigured() ? (
            <div className="mt-3 space-y-2 rounded-2xl border border-line bg-bg/60 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold"><Folder size={16} className="text-brand" />Hai ricevuto un invito?</p>
              <p className="text-xs text-muted">Il proprietario ha condiviso il database con te: scegli quel file su Drive (lo trovi in «Condivisi con me»). Lo si fa una volta sola.</p>
              <button className="glass-btn btn-primary w-full" disabled={busy} onClick={() => void guard(async () => { const f = await engine.pickDatabase(); if (f) await connect(f.id) })}><Folder size={18} />Scegli il database della casa</button>
            </div>
          ) : (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted">Ho il link o l'ID del file</summary>
              <p className="mt-2 text-xs text-muted">Senza il Picker (API Key e App ID) l'app vede solo i file creati da lei: per un file di un altro account configura il Picker (README §3).</p>
              <div className="mt-2 flex gap-2">
                <input className="field" placeholder="Link o ID del file Drive" value={link} autoCapitalize="none" spellCheck={false} onChange={(e) => setLink(e.target.value)} />
                <button className="glass-btn btn-primary" disabled={busy || !parseFileId(link)} onClick={() => void guard(() => connect(parseFileId(link)!))}><Link2 size={16} />Collega</button>
              </div>
            </details>
          )}

          <p className="mt-3 text-sm text-muted">Aspetti un invito? Chiedi al proprietario di aggiungere <b className="text-ink">{sync.email ?? 'la tua email'}</b>, poi
            <button className="ml-1 inline-flex items-center gap-1 font-semibold text-brand" disabled={busy} onClick={() => void search()}><RefreshCw size={14} />cerca di nuovo</button>.</p>

          {others.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted">Altri file con «meal-duo» nel nome</summary>
              <div className="mt-2"><FileList files={others} busy={busy} onPick={(id) => void guard(() => connect(id))} /></div>
            </details>
          )}
          <button className="mt-3 w-full text-xs font-semibold text-muted" disabled={busy} onClick={() => void login(true)}>Usa un altro account Google</button>
        </>
      )}
    </Sheet>
  )
}

function FileList({ files, busy, onPick }: { files: DriveFile[]; busy: boolean; onPick: (id: string) => void }) {
  return (
    <div className="mt-3 space-y-2">
      {files.map((f) => (
        <button key={f.id} disabled={busy} onClick={() => onPick(f.id)} className="w-full rounded-2xl border border-line bg-surface p-3 text-left text-sm active:bg-line/30">
          <p className="font-semibold">{f.name}</p>
          <p className="text-xs text-muted">{f.ownedByMe ? 'Creato da te' : `Proprietario: ${f.owners?.[0]?.emailAddress ?? 'altro account'}`} · {when(f.modifiedTime)}</p>
        </button>
      ))}
    </div>
  )
}

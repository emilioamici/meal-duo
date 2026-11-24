import { useEffect, useRef, useState } from 'react'
import { Folder, Link2, Loader2, RefreshCw, UserRound, Users } from 'lucide-react'
import { Sheet } from './ui'
import { useStore } from '../state/store'
import { useUi } from '../state/ui'
import { engine, NeedsPickerError, type FamilyChoice, type ResolvedFamily } from '../sync/engine'
import { parseFileId } from '../sync/drive'
import { clearInvite, pendingInvite } from '../sync/invite'
import { pickerConfigured } from '../sync/picker'
import { isPristine } from '../services/dbOps'
import { setLocalMode } from '../lib/localMode'
import { tb } from '../i18n/rich'
import { locale, t } from '../i18n'

type Phase = 'login' | 'searching' | 'choose' | 'invite' | 'none' | 'confirm'
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const when = (iso: string) => new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * Flusso di collegamento (stesso modo di Clean Duo): accesso con Google, poi la famiglia si apre da sola.
 *  - con un link d'invito: accesso diretto al file → ponte del Worker (nessun Selettore, nessun ID) → Selettore ristretto a quel file (un tocco)
 *  - senza invito: si cercano le famiglie create qui e quelle a cui si è stati invitati (ponte); una sola = collegamento automatico
 *  - altrimenti: «ID famiglia» (l'ID del file, che chi ha creato la famiglia copia dalle Impostazioni) oppure si crea una famiglia nuova
 */
export function ConnectFlow({ active, reconnect = false, onClose, allowLocal = false }: { active: boolean; reconnect?: boolean; onClose: () => void; allowLocal?: boolean }) {
  const { sync, db } = useStore()
  const { showToast } = useUi()
  const [phase, setPhase] = useState<Phase>('login')
  const [families, setFamilies] = useState<FamilyChoice[]>([])
  const [pending, setPending] = useState<ResolvedFamily | null>(null)
  const [inviteId, setInviteId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [joinId, setJoinId] = useState('')
  const [houseName, setHouseName] = useState(() => t('La nostra famiglia'))
  const [myName, setMyName] = useState('')
  const [keepLocal, setKeepLocal] = useState(true)
  const [folder, setFolder] = useState<{ id: string; name: string }>({ id: 'root', name: t('Il mio Drive') })
  const started = useRef(false)
  const hasLocalData = !isPristine(db)
  const invite = pendingInvite()

  const close = () => { started.current = false; setErr(''); onClose() }
  const guard = async (fn: () => Promise<void>) => {
    setBusy(true); setErr('')
    try { await fn() } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  const done = (text: string) => { clearInvite(); showToast(text); close() }

  /** Famiglia aperta: se sul dispositivo ci sono dati propri chiede se unirli al file o usare solo il file. */
  const finishOpen = async (r: ResolvedFamily) => {
    if (hasLocalData) { setPending(r); return setPhase('confirm') }
    await engine.link(r.file, r.remote, 'replace', r.bridged)
    done(t('Famiglia collegata'))
  }

  /** Apre la famiglia: accesso diretto → ponte (con il codice: prima l'unione) → (un tocco sul) Selettore ristretto a quel file. `viaCode` = l'utente ha presentato il codice (ID digitato o link d'invito). */
  const openFamily = async (id: string, viaCode = false) => {
    try { await finishOpen(await engine.resolveFamily(id, false, viaCode)) } catch (e) {
      if (e instanceof NeedsPickerError) { setInviteId(id); return setPhase('invite') }
      throw e
    }
  }

  const search = async () => {
    setPhase('searching'); setErr('')
    try {
      if (!sync.email || !sync.name) await engine.loadProfile()
      const inv = pendingInvite()
      if (inv) return await openFamily(inv, true) // il link d'invito è il codice
      const list = await engine.listFamilies()
      setFamilies(list)
      if (list.length === 1) return await openFamily(list[0].id) // una sola famiglia: collegamento automatico
      setPhase(list.length > 1 ? 'choose' : 'none')
    } catch (e) { setErr(msg(e)); setPhase('none') }
  }

  useEffect(() => {
    if (!active) return
    if (sync.fileId && !reconnect) return close() // già collegato
    // in riconnessione la famiglia è già collegata: basta rifare l'accesso, non si cerca nulla
    if (!reconnect && sync.signedIn && !started.current) { started.current = true; void search() }
    if (!sync.signedIn) setPhase('login')
  }, [active, sync.signedIn]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!myName && sync.name) setMyName(sync.name) }, [sync.name]) // eslint-disable-line react-hooks/exhaustive-deps

  const login = (selectAccount = false) => guard(async () => {
    started.current = false
    await engine.signIn({ selectAccount })
  })

  return (
    <>
      {err && <p role="alert" className="mb-3 rounded-xl bg-exp/15 p-3 text-sm text-ink"><span className="font-bold text-exp">{t('Errore:')} </span>{err}</p>}

      {phase === 'login' && reconnect && (
        <>
          <h2 className="text-lg font-bold">{t('Sessione Google scaduta')}</h2>
          <p className="mt-1 text-sm text-muted">{sync.email ? tb('Per continuare accedi di nuovo come <b>{email}</b>. I tuoi dati sono al sicuro su Drive e restano nascosti finché non accedi.', { email: sync.email }) : t('Per continuare accedi di nuovo con il tuo account Google. I tuoi dati sono al sicuro su Drive e restano nascosti finché non accedi.')}</p>
          <button className="glass-btn btn-primary mt-4 w-full !py-3" disabled={busy} onClick={() => void login()}>
            {busy ? <Loader2 size={18} className="animate-spin" /> : <UserRound size={18} />}{t('Accedi con Google')}
          </button>
          <button className="mt-3 w-full text-xs font-semibold text-muted" disabled={busy} onClick={() => void login(true)}>{t('Usa un altro account Google')}</button>
          <button className="mt-2 w-full text-xs font-semibold text-muted" disabled={busy} onClick={() => engine.unlink()}>{t('Scollega questa famiglia')}</button>
        </>
      )}

      {phase === 'login' && !reconnect && (
        <>
          {invite && <p className="mb-3 rounded-xl bg-brand/10 p-3 text-sm font-semibold">{t('Hai un invito per una famiglia: accedi con Google per entrare.')}</p>}
          <p className="text-sm text-muted">{tb('Accedi con il <b>tuo account Google</b>. Se qualcuno ti ha invitato in una famiglia la ritrovo io; altrimenti puoi crearne una nuova. I dati restano nel tuo Drive.')}</p>
          {!sync.clientId && (
            <div className="mt-3 rounded-xl border border-brand/40 bg-brand/10 p-3 text-sm">
              <p className="mb-2">{t('Manca il Client ID OAuth di Google Cloud (vedi README).')}</p>
              <input className="field" placeholder="xxxx.apps.googleusercontent.com" autoCapitalize="none" spellCheck={false} onBlur={(e) => engine.setClientId(e.target.value)} />
            </div>
          )}
          <button className="glass-btn btn-primary mt-4 w-full !py-3" disabled={busy || !sync.clientId} onClick={() => void login()}>
            {busy ? <Loader2 size={18} className="animate-spin" /> : <UserRound size={18} />}{t('Accedi con Google')}
          </button>
          {allowLocal && <button className="mt-3 w-full text-sm font-semibold text-brand" onClick={() => { setLocalMode(true); onClose() }}>{t('Prova senza account (dati demo)')}</button>}
        </>
      )}

      {phase === 'searching' && <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted"><Loader2 className="animate-spin text-brand" />{t('Cerco la tua famiglia su Drive…')}</div>}

      {phase === 'choose' && (
        <>
          <p className="text-sm text-muted">{t('Hai accesso a più famiglie. Quale vuoi aprire?')}</p>
          <div className="mt-3 space-y-2">
            {families.map((f) => (
              <button key={f.id} disabled={busy} onClick={() => void guard(() => openFamily(f.id))} className="w-full rounded-2xl border border-line bg-surface p-3 text-left text-sm active:bg-line/30">
                <p className="font-semibold">{f.name}</p>
                <p className="text-xs text-muted">{t('aggiornato {when}', { when: when(f.modifiedTime) })}</p>
              </button>
            ))}
          </div>
        </>
      )}

      {phase === 'invite' && inviteId && (
        <>
          <h2 className="text-lg font-bold">{t('Ti hanno invitato in una famiglia')}</h2>
          <p className="mt-1 text-sm text-muted">{t('Per entrare tocca il pulsante e conferma il file della famiglia: serve a dare a Meal Duo il permesso di aprirlo. Si fa una volta sola.')}</p>
          <button className="glass-btn btn-primary mt-4 w-full !py-3" disabled={busy} onClick={() => void guard(async () => { try { await finishOpen(await engine.resolveFamily(inviteId, true, true)) } catch (e) { if (!(e instanceof NeedsPickerError)) throw e } })}>
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Folder size={18} />}{t('Scegli il file e unisciti')}
          </button>
          <p className="mt-2 text-xs text-muted">{t('Se compare «Can’t access your Google Account», in Safari consenti i cookie per questo sito oppure chiedi a chi ti ha invitato di attivare l’accesso persistente: così entri senza questo passaggio.')}</p>
          <button className="mt-3 w-full text-xs font-semibold text-muted" disabled={busy} onClick={() => { clearInvite(); setInviteId(null); setPhase('none') }}>{t('Non è il mio invito: crea o cerca un’altra famiglia')}</button>
        </>
      )}

      {phase === 'confirm' && pending && (
        <>
          <p className="text-sm text-muted">{t('Su questo dispositivo ci sono dati non ancora presenti in «{name}» (modificato {when}). Vuoi unirli ai dati del file o usare solo il file? In quel caso i dati locali verranno scartati.', { name: pending.file.name, when: when(pending.file.modifiedTime) })}</p>
          <button className="glass-btn btn-primary mt-4 w-full" disabled={busy} onClick={() => void guard(async () => { await engine.link(pending.file, pending.remote, 'merge', pending.bridged); done(t('Famiglia collegata')) })}>{t('Unisci ai dati del file')}</button>
          <button className="glass-btn mt-2 w-full" disabled={busy} onClick={() => void guard(async () => { await engine.link(pending.file, pending.remote, 'replace', pending.bridged); done(t('Famiglia collegata')) })}>{t('Usa solo il file Drive')}</button>
          <button className="mt-3 w-full text-sm font-semibold text-muted" onClick={() => setPhase('none')}>{t('Annulla')}</button>
        </>
      )}

      {phase === 'none' && (
        <>
          <p className="text-sm">{tb('Nessuna famiglia trovata per <b>{email}</b>.', { email: sync.email ?? t('questo account') })}</p>

          <div className="mt-3 space-y-2 rounded-2xl border border-line bg-bg/60 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold"><Link2 size={16} className="text-brand" />{t('Entra in una famiglia con l’ID famiglia')}</p>
            <p className="text-xs text-muted">{t('Chi ha creato la famiglia ti manda il suo ID famiglia (lo trova in Impostazioni → Famiglia): incollalo qui. Se ti ha invitato per email, basta aprire il link dell’invito.')}</p>
            <input className="field font-mono !text-xs" placeholder={t('ID famiglia')} value={joinId} onChange={(e) => setJoinId(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label={t('ID famiglia')} />
            <button className="glass-btn btn-primary w-full" disabled={busy || !parseFileId(joinId)} onClick={() => void guard(() => openFamily(parseFileId(joinId)!, true))}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Folder size={18} />}{t('Entra')}
            </button>
          </div>

          <div className="mt-3 space-y-1 rounded-2xl border border-line bg-bg/60 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold"><Users size={16} className="text-brand" />{t('Crea la tua famiglia')}</p>
            <p className="text-xs text-muted">{t('Il database sarà un file nel tuo Drive: tu sei il proprietario e inviti gli altri dalle Impostazioni.')}</p>
            <label className="label">{t('Nome della famiglia')}</label>
            <input className="field" value={houseName} onChange={(e) => setHouseName(e.target.value)} />
            <label className="label">{t('Il tuo nome')}</label>
            <input className="field" value={myName} onChange={(e) => setMyName(e.target.value)} />
            {pickerConfigured() && (
              <button type="button" className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2.5 text-left text-sm active:bg-line/30"
                onClick={() => void guard(async () => { const f = await engine.pickFolder(); if (f) setFolder(f) })}>
                <Folder size={18} className="shrink-0 text-brand" />
                <span className="min-w-0 flex-1"><span className="block text-xs text-muted">{t('Cartella del database')}</span><span className="block truncate font-semibold">{folder.name}</span></span>
                <span className="text-xs font-semibold text-brand">{t('Cambia')}</span>
              </button>
            )}
            {hasLocalData && (
              <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={keepLocal} onChange={(e) => setKeepLocal(e.target.checked)} />{t('Porta con me i dati già presenti su questo dispositivo')}</label>
            )}
            <button className="glass-btn btn-primary mt-3 w-full !py-3" disabled={busy || !houseName.trim()}
              onClick={() => void guard(async () => { await engine.createHouse({ houseName, memberName: myName, folderId: folder.id === 'root' ? null : folder.id, keepLocal }); done(t('Famiglia creata su Drive')) })}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Users size={18} />}{t('Crea famiglia')}
            </button>
          </div>

          <p className="mt-3 text-sm text-muted">{tb('Aspetti un invito? Chiedi al proprietario di aggiungere <b>{email}</b>, poi', { email: sync.email ?? t('la tua email') })}
            <button className="ml-1 inline-flex items-center gap-1 font-semibold text-brand" disabled={busy} onClick={() => void search()}><RefreshCw size={14} />{t('cerca di nuovo')}</button>.</p>
          <button className="mt-3 w-full text-xs font-semibold text-muted" disabled={busy} onClick={() => void login(true)}>{t('Usa un altro account Google')}</button>
        </>
      )}
    </>
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

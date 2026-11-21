import { useEffect, useState } from 'react'
import { Check, Copy, Crown, FolderOpen, Mail, UserMinus, UserPlus } from 'lucide-react'
import { Avatar } from './ui'
import { MemberSheet } from './MemberSheet'
import { useStore } from '../state/store'
import { engine } from '../sync/engine'
import { pickerConfigured } from '../sync/picker'
import { bridgeAvailable } from '../sync/bridge'
import { addMember, MEMBER_COLORS, removeMember, renameHouse, updateMember } from '../services/dbOps'
import type { Member } from '../types'
import { tb } from '../i18n/rich'
import { t } from '../i18n'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())

/** Campo che salva solo quando si esce (niente scritture a ogni tasto). */
function CommitInput({ value, onCommit, ...rest }: { value: string; onCommit: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return <input {...rest} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() && v !== value && onCommit(v)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
}

/** Rimozione a due tocchi (il primo arma, il secondo conferma). */
function RemoveButton({ name, busy, onConfirm }: { name: string; busy: boolean; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => { if (!armed) return; const id = window.setTimeout(() => setArmed(false), 3500); return () => window.clearTimeout(id) }, [armed])
  return armed
    ? <button className="glass-btn btn-danger !px-3 !py-1.5 !text-xs" disabled={busy} onClick={() => { setArmed(false); onConfirm() }}>{t('Conferma')}</button>
    : <button className="glass-btn !h-9 !w-9 !p-0 text-muted" aria-label={t('Rimuovi {name}', { name })} disabled={busy} onClick={() => setArmed(true)}><UserMinus size={17} /></button>
}

/**
 * Famiglia (come in MoneyDuo): nome, membri con ruolo, un solo «Invita un membro» (Drive concede l'accesso al database e manda
 * l'email: non servono ID né altri passaggi per chi inviti) e posizione del database.
 */
export function FamilyCard() {
  const { db, members, commit, sync, me } = useStore()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [target, setTarget] = useState('new') // 'new' = nuovo membro, altrimenti id di un membro esistente senza account
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [folder, setFolder] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [bridge, setBridge] = useState(false)
  const [editing, setEditing] = useState<Member | null>(null)
  const linked = !!sync.fileId
  /** entrato dall'invito (ponte del Worker): non ha accesso diretto al file e non gestisce inviti né cartella */
  const viaBridge = linked && sync.bridged
  const owner = sync.ownerEmail?.toLowerCase() ?? ''
  const canManage = !linked || sync.canShare // in locale si gestisce da soli; con Drive solo il capofamiglia
  const unclaimed = members.filter((m) => !m.email && m.id !== me?.id)

  useEffect(() => { void bridgeAvailable().then(setBridge) }, [])
  useEffect(() => { if (sync.signedIn && sync.fileId && !sync.bridged) engine.currentFolder().then((f) => setFolder(f?.name ?? null)).catch(() => undefined) }, [sync.signedIn, sync.fileId, sync.bridged])

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(''); setInfo('')
    try { await fn() } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }

  const color = () => MEMBER_COLORS[members.length % MEMBER_COLORS.length]

  const invite = () => guard(async () => {
    const mail = email.trim()
    if (members.some((m) => m.email?.toLowerCase() === mail.toLowerCase())) throw new Error(t('Questa persona è già nella famiglia. Se non ha ancora accesso al database, usa «Reinvia invito» accanto al suo nome.'))
    await engine.invite(mail, db.houseName)
    const claimed = target !== 'new' ? members.find((m) => m.id === target && !m.email) : undefined
    // l'invito si collega a un membro già presente (es. dopo un import) invece di crearne uno duplicato
    commit((d) => (claimed ? updateMember(d, claimed.id, { email: mail }) : addMember(d, name.trim() || mail.split('@')[0], color(), mail).db))
    void engine.syncNow() // il membro deve essere su Drive prima che l'invitato acceda
    setInfo(t('Invito inviato a {mail}. Deve accedere all\'app con quell\'account Google.', { mail }))
    setEmail(''); setName(''); setTarget('new')
  })

  /** Senza Drive collegato si aggiunge solo il membro (nome, email facoltativa). */
  const addLocal = () => {
    setErr(''); setInfo('')
    const mail = email.trim()
    if (mail && !validEmail(mail)) return setErr(t('Email non valida.'))
    commit((d) => addMember(d, name.trim(), color(), mail || undefined).db)
    setEmail(''); setName('')
  }

  /** Per chi ha l'email ma non è ancora entrato: concede (di nuovo) l'accesso al file su Drive. */
  const resend = (mail: string) => guard(async () => {
    await engine.invite(mail, db.houseName)
    setInfo(t('Invito inviato a {mail}. Deve accedere all\'app con quell\'account Google.', { mail }))
  })

  const remove = (m: Member) => guard(async () => {
    if (m.email && sync.canShare) { try { await engine.revoke(m.email) } catch (e) { setErr(msg(e)) } } // revoca anche l'accesso al file su Drive
    commit((d) => removeMember(d, m.id))
  })

  return (
    <div>
      <label className="label !mt-0">{t('Nome della famiglia')}</label>
      <CommitInput className="field" value={db.houseName} readOnly={!canManage} onCommit={(v) => commit((d) => renameHouse(d, v))} />

      <p className="label">{t('Membri')}</p>
      <ul className="mb-4 divide-y divide-line/60">
        {members.map((m) => {
          const isOwner = !!m.email && m.email.toLowerCase() === owner
          const isMe = m.id === me?.id
          return (
            <li key={m.id} className="flex items-center gap-3 py-2.5">
              <button className="shrink-0 rounded-full active:scale-90" aria-label={t('Modifica {name}', { name: m.name })} onClick={() => setEditing(m)}><Avatar member={m} size={40} /></button>
              <div className="min-w-0 flex-1">
                <CommitInput className="w-full truncate bg-transparent font-semibold outline-none" value={m.name} aria-label={t('Nome di {name}', { name: m.name })}
                  readOnly={!canManage && !isMe} onCommit={(v) => commit((d) => updateMember(d, m.id, { name: v.trim() }))} />
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  <span className="truncate">{m.email ?? t('account non associato')}</span>
                  {isOwner && <span className="flex items-center gap-0.5 font-semibold text-ink"><Crown size={12} className="text-brand" />{t('Capofamiglia')}</span>}
                  {isMe && <span className="font-semibold text-brand">{t('Tu')}</span>}
                  {linked && !m.joinedAt && m.email && !isMe && <span className="rounded-full bg-brand/10 px-1.5 font-semibold text-ink">{t('Invitato')}</span>}
                </p>
              </div>
              {linked && canManage && !isOwner && !isMe && m.email && !m.joinedAt && (
                <button className="glass-btn !px-2.5 !py-1 !text-xs" disabled={busy} onClick={() => void resend(m.email!)}>{t('Reinvia invito')}</button>
              )}
              {canManage && !isOwner && !isMe && members.length > 1 && <RemoveButton name={m.name} busy={busy} onConfirm={() => void remove(m)} />}
            </li>
          )
        })}
      </ul>

      {viaBridge ? (
        <p className="rounded-xl bg-bg/60 p-3 text-xs text-muted">{t('Sei entrato dall’invito: gli inviti ai nuovi membri li fa chi ha creato la famiglia.')}</p>
      ) : canManage ? (
        <div className="space-y-2 rounded-2xl border border-line bg-bg/60 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold">{linked ? <Mail size={16} className="text-brand" /> : <UserPlus size={16} className="text-brand" />}{linked ? t('Invita un membro') : t('Aggiungi membro')}</p>
          <input className="field" type="email" placeholder={linked ? t('Email Google della persona') : t('Email Google (facoltativa)')} aria-label={t('Email Google')} autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
          {linked && unclaimed.length > 0 && (
            <select className="field" value={target} onChange={(e) => setTarget(e.target.value)} aria-label={t('Associa a')}>
              <option value="new">{t('Nuovo membro')}</option>
              {unclaimed.map((m) => <option key={m.id} value={m.id}>{t('È {name} (membro senza account)', { name: m.name })}</option>)}
            </select>
          )}
          {target === 'new' && <input className="field" placeholder={linked ? t('Nome (opzionale)') : t('Nome')} aria-label={t('Nome')} value={name} onChange={(e) => setName(e.target.value)} />}
          {linked
            ? <button className="glass-btn btn-primary w-full" disabled={busy || !validEmail(email)} onClick={() => void invite()}>{t('Invia invito')}</button>
            : <button className="glass-btn btn-primary w-full" disabled={!name.trim()} onClick={addLocal}><UserPlus size={16} />{t('Aggiungi membro')}</button>}
          {linked && <p className="text-xs text-muted">{tb('L\'invito dà accesso in modifica al database su Drive. Se l\'app Google è in modalità <b>Testing</b>, aggiungi la stessa email anche tra gli <b>utenti di prova</b> in Google Cloud Console, altrimenti la persona non potrà accedere.')}</p>}
          {linked && bridge && !sync.persistent && <p className="rounded-xl bg-brand/10 p-2 text-xs">{t('Per far entrare gli invitati senza il selettore di Google attiva l’accesso persistente (Sincronizzazione e account).')}</p>}
          {linked && !bridge && pickerConfigured() && <p className="text-xs text-muted">{t('Al primo accesso la persona conferma il file con un tocco («Scegli il file e unisciti»): è un limite di Google per i permessi ristretti, non servono ID.')}</p>}
        </div>
      ) : (
        <p className="rounded-xl bg-bg/60 p-3 text-xs text-muted">{t('Solo il capofamiglia ({owner}) può invitare o rimuovere membri.', { owner: sync.ownerEmail ?? t('proprietario del file') })}</p>
      )}
      {linked && sync.fileId && !viaBridge && (
        <div className="mt-3 rounded-2xl border border-line bg-bg/60 p-3">
          <label className="label !mt-0">{t('ID famiglia')}</label>
          <div className="flex gap-2">
            <input readOnly className="field font-mono !text-xs" value={sync.fileId} aria-label={t('ID famiglia')} onFocus={(e) => e.currentTarget.select()} />
            <button className="glass-btn !h-11 !w-11 shrink-0 !p-0" aria-label={t('Copia ID')} onClick={() => { void navigator.clipboard?.writeText(sync.fileId!); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? <Check size={16} /> : <Copy size={16} />}</button>
          </div>
          <p className="mt-1.5 px-1 text-xs text-muted">{t('Il codice da dare a chi entra: dopo l’invito lo incolla all’accesso come «ID famiglia».')}</p>
        </div>
      )}
      {err && <p role="alert" className="mt-3 rounded-xl bg-exp/15 p-3 text-sm"><span className="font-bold text-exp">{t('Errore:')} </span>{err}</p>}
      {info && <p role="status" className="mt-3 rounded-xl bg-inc/15 p-3 text-sm">{info}</p>}

      {linked && !viaBridge && (
        <div className="mt-4 flex items-center gap-3 border-t border-line/70 pt-3 text-sm">
          <FolderOpen size={18} className="shrink-0 text-brand" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t('Posizione del database')}</p>
            <p className="truncate text-xs text-muted">{sync.fileName}{folder ? ` · ${folder}` : ''}</p>
          </div>
          {sync.canShare && pickerConfigured() && (
            <button className="glass-btn !px-3 !py-1.5 !text-xs" disabled={busy}
              onClick={() => void guard(async () => { const f = await engine.pickFolder(); if (f) { await engine.moveTo(f.id); setFolder(f.name); setInfo(t('Database spostato in «{name}».', { name: f.name })) } })}>{t('Sposta…')}</button>
          )}
        </div>
      )}
      <MemberSheet open={!!editing} member={editing ?? undefined} onClose={() => setEditing(null)} />
    </div>
  )
}

import { UserCheck } from 'lucide-react'
import { useEffect } from 'react'
import { Avatar, Sheet } from './ui'
import { useStore } from '../state/store'
import { addMember, dedupeMembersByEmail, MEMBER_COLORS, updateMember } from '../services/dbOps'
import { tb } from '../i18n/rich'
import { t } from '../i18n'

/**
 * Collega l'account Google al membro della casa:
 *  - invitato per email: il membro esiste già (la sua email è nel database)
 *  - altrimenti, se ci sono membri senza account chiede «chi sei?»; se non ce ne sono aggiunge chi accede.
 */
export function IdentityGuard() {
  const { db, members, commit, me, sync } = useStore()
  const ready = !!sync.fileId && sync.status === 'synced' && !!sync.email && sync.reconciled
  const unclaimed = members.filter((m) => !m.email)

  // primo accesso: il membro smette di risultare «Invitato»
  useEffect(() => {
    if (ready && me && !me.joinedAt) commit((d) => updateMember(d, me.id, { joinedAt: new Date().toISOString() }))
  }, [ready, me?.id, me?.joinedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  // due membri con la stessa email (invito arrivato dopo il primo accesso): si unificano, tenendo quello col piano
  useEffect(() => {
    if (!ready || !me) return
    commit(dedupeMembersByEmail)
  }, [ready, me, members.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // nessun membro da associare: chi accede viene aggiunto. Rivalutato sul DB più recente dentro commit → idempotente.
  useEffect(() => {
    if (!ready || me || unclaimed.length > 0) return
    const mail = sync.email!.toLowerCase()
    commit((d) => (d.members.some((m) => !m.deleted && (!m.email || m.email.toLowerCase() === mail)) ? d : addMember(d, sync.name || mail.split('@')[0], MEMBER_COLORS[d.members.length % MEMBER_COLORS.length], sync.email!).db))
  }, [ready, me, unclaimed.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready || me || unclaimed.length === 0) return null
  const claim = (id: string) => commit((d) => updateMember(d, id, { email: sync.email! }))
  const addNew = () => commit((d) => (d.members.some((m) => !m.deleted && m.email?.toLowerCase() === sync.email!.toLowerCase()) ? d : addMember(d, sync.name || sync.email!.split('@')[0], MEMBER_COLORS[d.members.length % MEMBER_COLORS.length], sync.email!).db))
  void db

  return (
    <Sheet open onClose={() => undefined} title={t('Chi sei?')}>
      <p className="mb-4 flex items-start gap-2 text-sm text-muted"><UserCheck size={18} className="mt-0.5 shrink-0 text-brand" />{tb('Hai effettuato l\'accesso come <b>{email}</b>. Scegli quale membro della casa sei: l\'account verrà associato al tuo piano.', { email: sync.email ?? '' })}</p>
      <div className="space-y-2">
        {unclaimed.map((m) => (
          <button key={m.id} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left active:bg-line/30" onClick={() => claim(m.id)}>
            <Avatar member={m} size={36} /><span className="font-semibold">{t('Sono {name}', { name: m.name })}</span>
          </button>
        ))}
        <button className="glass-btn w-full" onClick={addNew}>{t('Nessuno di questi: aggiungimi come nuovo membro')}</button>
      </div>
    </Sheet>
  )
}

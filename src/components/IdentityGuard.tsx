import { UserCheck } from 'lucide-react'
import { useEffect } from 'react'
import { Avatar, Sheet } from './ui'
import { useStore } from '../state/store'
import { addMember, MEMBER_COLORS, updateMember } from '../services/dbOps'

/**
 * Collega l'account Google al membro della casa:
 *  - invitato per email: il membro esiste già (la sua email è nel database)
 *  - altrimenti, se ci sono membri senza account chiede «chi sei?»; se non ce ne sono aggiunge chi accede.
 */
export function IdentityGuard() {
  const { db, members, commit, me, sync } = useStore()
  const ready = !!sync.fileId && sync.status === 'synced' && !!sync.email && sync.reconciled
  const unclaimed = members.filter((m) => !m.email)

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
    <Sheet open onClose={() => undefined} title="Chi sei?">
      <p className="mb-4 flex items-start gap-2 text-sm text-muted"><UserCheck size={18} className="mt-0.5 shrink-0 text-brand" />Hai effettuato l'accesso come <b className="text-ink">{sync.email}</b>. Scegli quale membro della casa sei: l'account verrà associato al tuo piano.</p>
      <div className="space-y-2">
        {unclaimed.map((m) => (
          <button key={m.id} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left active:bg-line/30" onClick={() => claim(m.id)}>
            <Avatar member={m} size={36} /><span className="font-semibold">Sono {m.name}</span>
          </button>
        ))}
        <button className="glass-btn w-full" onClick={addNew}>Nessuno di questi: aggiungimi come nuovo membro</button>
      </div>
    </Sheet>
  )
}

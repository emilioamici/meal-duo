import type { Member } from '../types'
import { Avatar } from './ui'
import { t } from '../i18n'

export function MemberPills({ members, value, onChange }: { members: Member[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label={t('Membro della famiglia')}>
      {members.map((m) => (
        <button key={m.id} role="tab" aria-selected={value === m.id} onClick={() => onChange(m.id)} className={`chip !pl-1.5 ${value === m.id ? 'chip-active' : ''}`}>
          <Avatar member={m} size={24} />{m.name}
        </button>
      ))}
    </div>
  )
}

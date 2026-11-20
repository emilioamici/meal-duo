import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { Sheet } from './ui'
import { useStore } from '../state/store'
import { MEMBER_COLORS, updateMember } from '../services/dbOps'
import type { Member } from '../types'
import { t } from '../i18n'

/** Colore del membro (compare nei badge della spesa): il resto si modifica direttamente nella scheda Famiglia. */
export function MemberSheet({ open, member, onClose }: { open: boolean; member?: Member; onClose: () => void }) {
  const { commit } = useStore()
  const [color, setColor] = useState(MEMBER_COLORS[0])
  useEffect(() => { if (open && member) setColor(member.color) }, [open, member?.id, member?.color]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet open={open} onClose={onClose} title={t('Colore di {name}', { name: member?.name ?? '' })}
      footer={<button className="glass-btn btn-primary w-full !py-3.5" onClick={() => { if (member) commit((d) => updateMember(d, member.id, { color })); onClose() }}>{t('Salva')}</button>}>
      <div className="flex flex-wrap gap-3 px-1 pt-2">
        {MEMBER_COLORS.map((c) => (
          <button key={c} type="button" aria-label={t('Colore {c}', { c })} aria-pressed={color === c} onClick={() => setColor(c)}
            className="flex h-11 w-11 items-center justify-center rounded-full text-white transition active:scale-90" style={{ background: c }}>
            {color === c && <Check size={18} strokeWidth={3} />}
          </button>
        ))}
      </div>
    </Sheet>
  )
}

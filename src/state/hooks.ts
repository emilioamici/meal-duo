import { useEffect } from 'react'
import { useStore } from './store'
import { useUi } from './ui'
import type { Member } from '../types'

/** Membro attivo (selettore a pillole): se la scelta salvata non esiste più, ricade sul primo. */
export function useActiveMember(): Member {
  const { members } = useStore()
  const { memberId, setMemberId } = useUi()
  const active = members.find((m) => m.id === memberId) ?? members[0]
  useEffect(() => { if (active && active.id !== memberId) setMemberId(active.id) }, [active, memberId, setMemberId])
  return active
}

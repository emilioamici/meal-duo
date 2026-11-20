import { useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronRight, Copy } from 'lucide-react'
import { PageHeader } from '../components/ui'
import { HeaderActions } from '../components/Chrome'
import { MascotPeek } from '../components/Mascots'
import { MemberPills } from '../components/MemberPills'
import { CopyDaySheet } from '../components/Sheets'
import { PlanJsonCard } from '../components/PlanJsonCard'
import { useStore } from '../state/store'
import { useUi } from '../state/ui'
import { useActiveMember } from '../state/hooks'
import { DAY_INDEXES, type DayIndex } from '../types'
import { dayTotals } from '../services/shoppingListEngine'
import { formatQuantity } from '../lib/units'
import { todayIndex } from '../lib/ids'
import { t, dayLong, dayShort } from '../i18n'

export function WeekView() {
  const { db, members } = useStore()
  const { setDay, setTab, setMemberId } = useUi()
  const member = useActiveMember()
  const plan = db.plans[member.id]
  const today = todayIndex()
  const [copyFrom, setCopyFrom] = useState<DayIndex | null>(null)

  return (
    <>
      <PageHeader title={t('Settimana')} subtitle={t('Piano di {name}', { name: member.name })} right={<HeaderActions />} />
      <MemberPills members={members} value={member.id} onChange={setMemberId} />

      <div className="mt-2">
        <MascotPeek kind="zenitsu" side="left">
          <div className="card divide-y divide-line/60 overflow-hidden">
            {DAY_INDEXES.map((d, i) => {
              const day = plan?.days[d]
              const tot = dayTotals(day)
              const meals = (day?.meals ?? []).filter((m) => m.items.length > 0).length
              return (
                <motion.div key={d} className="flex items-center gap-1 pr-2" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  <button className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left active:bg-line/30" onClick={() => { setDay(d); setTab('today') }}>
                    <span className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-2xl text-xs font-bold ${d === today ? 'bg-brand text-onbrand' : 'bg-line/60 text-ink'}`}>
                      {dayShort(d).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold leading-tight">{dayLong(d)}{d === today && <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-ink">{t('oggi')}</span>}</span>
                      <span className="block truncate text-xs text-muted">
                        {tot.foods === 0 ? t('Giorno vuoto') : t('{meals} pasti · {foods} alimenti', { meals, foods: tot.foods }) + (tot.grams ? ` · ${formatQuantity(tot.grams, 'g')}` : '')}
                      </span>
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-muted" />
                  </button>
                  <button className="glass-btn !h-10 !w-10 shrink-0 !p-0" aria-label={t('Copia {day} su altri giorni', { day: dayLong(d) })} onClick={() => setCopyFrom(d)}><Copy size={16} /></button>
                </motion.div>
              )
            })}
          </div>
        </MascotPeek>
      </div>

      <PlanJsonCard />

      {copyFrom !== null && <CopyDaySheet open onClose={() => setCopyFrom(null)} memberId={member.id} from={copyFrom} />}
    </>
  )
}

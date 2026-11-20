import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Pencil, Plus } from 'lucide-react'
import { PageHeader, CleanBar, EmptyCard } from '../components/ui'
import { Fab, SyncPill } from '../components/Chrome'
import { MascotImg, MascotPeek } from '../components/Mascots'
import { MemberPills } from '../components/MemberPills'
import { ItemSheet, MealSheet } from '../components/Sheets'
import { useStore } from '../state/store'
import { useUi } from '../state/ui'
import { useActiveMember } from '../state/hooks'
import { DAY_INDEXES, DAY_LONG, DAY_SHORT, type MealItem } from '../types'
import { foodById } from '../services/dbOps'
import { dayTotals } from '../services/shoppingListEngine'
import { formatQuantity } from '../lib/units'
import { todayIndex } from '../lib/ids'

export function TodayView() {
  const { db, members } = useStore()
  const { day, setDay, setMemberId } = useUi()
  const member = useActiveMember()
  const plan = db.plans[member.id]?.days[day]
  const meals = plan?.meals ?? []
  const totals = dayTotals(plan)
  const filled = meals.filter((m) => m.items.length > 0).length
  const today = todayIndex()

  const [itemSheet, setItemSheet] = useState<{ mealId?: string; item?: MealItem } | null>(null)
  const [mealSheet, setMealSheet] = useState<{ meal?: { id: string; name: string } } | null>(null)

  const date = new Date()
  const subtitle = day === today
    ? date.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
    : `${DAY_LONG[day]} · piano di ${member.name}`

  return (
    <>
      <PageHeader title={day === today ? 'Oggi' : DAY_LONG[day]} subtitle={subtitle} right={<SyncPill />} />

      <MemberPills members={members} value={member.id} onChange={setMemberId} />

      <div className="mt-3 grid grid-cols-7 gap-1.5" role="tablist" aria-label="Giorno della settimana">
        {DAY_INDEXES.map((d) => (
          <button key={d} role="tab" aria-selected={day === d} onClick={() => setDay(d)}
            className={`chip relative justify-center !px-0 ${day === d ? 'chip-active' : ''}`}>
            {DAY_SHORT[d]}
            {d === today && <span className={`absolute -top-0.5 right-1.5 h-1.5 w-1.5 rounded-full ${day === d ? 'bg-onbrand' : 'bg-brand'}`} aria-label="oggi" />}
          </button>
        ))}
      </div>

      <div className="mt-2">
        <MascotPeek kind="mochi" side="right">
          <div className="card p-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-4xl font-extrabold leading-none">{totals.foods}</p>
                <p className="mt-1 text-sm text-muted">{totals.foods === 1 ? 'alimento' : 'alimenti'} nel piano di {member.name}</p>
              </div>
              <div className="text-right text-sm">
                {totals.grams > 0 && <p className="font-semibold">{formatQuantity(totals.grams, 'g')}</p>}
                {totals.ml > 0 && <p className="font-semibold">{formatQuantity(totals.ml, 'ml')}</p>}
                {totals.pieces > 0 && <p className="font-semibold">{formatQuantity(totals.pieces, 'pz')}</p>}
              </div>
            </div>
            <div className="mt-3"><CleanBar pct={meals.length ? Math.round((filled / meals.length) * 100) : 0} height={10} /></div>
            <p className="mt-1.5 text-xs text-muted">{filled} di {meals.length} pasti pianificati</p>
          </div>
        </MascotPeek>
      </div>

      <div className="mt-3 space-y-3">
        <AnimatePresence initial={false}>
          {meals.map((meal, i) => (
            <motion.section key={meal.id} layout className="card p-3"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.04 } }}
              exit={{ opacity: 0, x: 90, scale: 0.92 }} transition={{ type: 'spring', stiffness: 400, damping: 34 }}>
              <div className="flex items-center justify-between gap-2 px-1">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold leading-tight">{meal.name}</h2>
                  <p className="text-xs text-muted">{meal.items.length === 0 ? 'Nessun alimento' : `${meal.items.length} ${meal.items.length === 1 ? 'alimento' : 'alimenti'}`}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button className="glass-btn !h-10 !w-10 !p-0" aria-label={`Modifica pasto ${meal.name}`} onClick={() => setMealSheet({ meal })}><Pencil size={16} /></button>
                  <button className="glass-btn btn-primary !h-10 !w-10 !p-0" aria-label={`Aggiungi alimento a ${meal.name}`} onClick={() => setItemSheet({ mealId: meal.id })}><Plus size={18} strokeWidth={2.6} /></button>
                </div>
              </div>
              {meal.items.length > 0 && (
                <ul className="mt-2 divide-y divide-line/60">
                  {meal.items.map((it) => (
                    <li key={it.id}>
                      <button className="flex w-full items-center justify-between gap-3 px-1 py-2.5 text-left active:bg-line/30" onClick={() => setItemSheet({ mealId: meal.id, item: it })}>
                        <span className="min-w-0 truncate font-semibold leading-tight">{foodById(db, it.foodId)?.name ?? '—'}</span>
                        <span className="shrink-0 text-sm font-semibold text-muted">{formatQuantity(it.quantity, it.unit)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </motion.section>
          ))}
        </AnimatePresence>

        {meals.length === 0 && (
          <EmptyCard mascot={<MascotImg kind="zenitsu" className="mx-auto h-20 w-auto" />} title="Nessun pasto per questo giorno" text="Aggiungi un pasto per iniziare a pianificare." />
        )}

        <button className="glass-btn w-full" onClick={() => setMealSheet({})}><Plus size={16} />Aggiungi pasto</button>
      </div>

      <Fab label="Aggiungi alimento" onClick={() => setItemSheet({ mealId: meals[0]?.id })} />

      <ItemSheet open={!!itemSheet} onClose={() => setItemSheet(null)} memberId={member.id} day={day} mealId={itemSheet?.mealId} item={itemSheet?.item} />
      <MealSheet open={!!mealSheet} onClose={() => setMealSheet(null)} memberId={member.id} day={day} meal={mealSheet?.meal} />
    </>
  )
}

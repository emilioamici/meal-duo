import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Pencil, Plus } from 'lucide-react'
import { PageHeader, CleanBar, EmptyCard } from '../components/ui'
import { Fab, HeaderActions } from '../components/Chrome'
import { MascotImg, MascotPeek } from '../components/Mascots'
import { MealIcon } from '../components/FoodIcon'
import { MemberPills } from '../components/MemberPills'
import { ItemSheet, MealSheet } from '../components/Sheets'
import { useStore } from '../state/store'
import { useUi } from '../state/ui'
import { useActiveMember } from '../state/hooks'
import { DAY_INDEXES, type MealItem } from '../types'
import { foodById, setMealDone } from '../services/dbOps'
import { dateOfDay, mealKey } from '../services/pantry'
import { dayTotals } from '../services/shoppingListEngine'
import { formatQuantity } from '../lib/units'
import { todayIndex } from '../lib/ids'
import { t, dayLong, dayShort, locale, tp } from '../i18n'

export function TodayView() {
  const { db, members, commit } = useStore()
  const { day, setDay, setMemberId, showToast, celebrate } = useUi()
  const member = useActiveMember()
  const plan = db.plans[member.id]?.days[day]
  const meals = plan?.meals ?? []
  const totals = dayTotals(plan)
  const filled = meals.filter((m) => m.items.length > 0).length
  const today = todayIndex()

  const [itemSheet, setItemSheet] = useState<{ mealId?: string; item?: MealItem } | null>(null)
  const [mealSheet, setMealSheet] = useState<{ meal?: { id: string; name: string } } | null>(null)

  const date = new Date()
  const isDone = (mealId: string) => !!db.pantry.meals[mealKey(member.id, dateOfDay(day), mealId)]?.done
  const doneCount = meals.filter((m) => isDone(m.id)).length
  const toggleMeal = (e: React.MouseEvent, mealId: string, name: string) => {
    const done = !isDone(mealId)
    commit((d) => setMealDone(d, member.id, day, mealId, done))
    if (!done) return showToast(t('«{name}» riaperto: la dispensa è stata ripristinata', { name }))
    const missing = setMealDone(db, member.id, day, mealId, true).pantry.meals[mealKey(member.id, dateOfDay(day), mealId)]?.missing ?? 0
    showToast(missing > 0 ? tp(missing, '«{name}» completato · {n} alimento non era in dispensa', '«{name}» completato · {n} alimenti non erano in dispensa', { name, n: missing }) : t('«{name}» completato: dispensa aggiornata', { name }))
    if (doneCount + 1 === meals.length) celebrate(e.clientX, e.clientY, t('Giornata completata!'))
  }
  const subtitle = day === today
    ? date.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })
    : t('{day} · piano di {name}', { day: dayLong(day), name: member.name })

  return (
    <>
      <PageHeader title={day === today ? t('Oggi') : dayLong(day)} subtitle={subtitle} right={<HeaderActions />} />

      <MemberPills members={members} value={member.id} onChange={setMemberId} />

      <div className="mt-3 grid grid-cols-7 gap-1.5 pt-3" role="tablist" aria-label={t('Giorno della settimana')}>
        {DAY_INDEXES.map((d) => (
          <div key={d} className="relative">
            {/* il gattino fa capolino da dietro il giorno selezionato (niente puntino) */}
            {day === d && <MascotImg kind={d % 2 ? 'zenitsu' : 'mochi'} className="absolute left-1/2 -top-[19px] h-8 w-auto -translate-x-1/2" />}
            <button role="tab" aria-selected={day === d} onClick={() => setDay(d)} aria-label={d === today ? `${dayShort(d)} (${t('oggi')})` : undefined}
              className={`chip relative w-full justify-center !px-0 ${day === d ? 'chip-active' : d === today ? '!font-extrabold text-brand' : ''}`}>
              {dayShort(d)}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-2">
        <MascotPeek kind="mochi" side="right">
          <div className="card p-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-4xl font-extrabold leading-none">{totals.foods}</p>
                <p className="mt-1 text-sm text-muted">{tp(totals.foods, '{n} alimento nel piano di {name}', '{n} alimenti nel piano di {name}', { n: totals.foods, name: member.name })}</p>
              </div>
              <div className="text-right text-sm">
                {totals.grams > 0 && <p className="font-semibold">{formatQuantity(totals.grams, 'g')}</p>}
                {totals.ml > 0 && <p className="font-semibold">{formatQuantity(totals.ml, 'ml')}</p>}
                {totals.pieces > 0 && <p className="font-semibold">{formatQuantity(totals.pieces, 'pz')}</p>}
              </div>
            </div>
            <div className="mt-3"><CleanBar pct={meals.length ? Math.round((filled / meals.length) * 100) : 0} height={10} /></div>
            <p className="mt-1.5 text-xs text-muted">{t('{done} di {total} pasti pianificati', { done: filled, total: meals.length })}{doneCount > 0 && ` · ${t('{n} completati', { n: doneCount })}`}</p>
          </div>
        </MascotPeek>
      </div>

      <div className="mt-3 space-y-3 md:grid md:grid-cols-2 md:items-start md:gap-3 md:space-y-0 xl:grid-cols-3">
        <AnimatePresence initial={false}>
          {meals.map((meal, i) => (
            <motion.section key={meal.id} layout className="card p-3"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.04 } }}
              exit={{ opacity: 0, x: 90, scale: 0.92 }} transition={{ type: 'spring', stiffness: 400, damping: 34 }}>
              <div className="flex items-center justify-between gap-2 px-1">
                <motion.button whileTap={{ scale: 0.82 }} role="checkbox" aria-checked={isDone(meal.id)} disabled={meal.items.length === 0 && !isDone(meal.id)}
                  aria-label={t(isDone(meal.id) ? '{name}: completato' : '{name}: da completare', { name: meal.name })} onClick={(e) => toggleMeal(e, meal.id, meal.name)}
                  className={`glass-btn !h-10 !w-10 shrink-0 !p-0 ${isDone(meal.id) ? 'btn-primary' : ''}`}>
                  <Check size={20} strokeWidth={3} className={isDone(meal.id) ? '' : 'opacity-30'} />
                </motion.button>
                <div className="min-w-0 flex-1">
                  <h2 className={`flex items-center gap-1.5 text-lg font-bold leading-tight ${isDone(meal.id) ? 'line-through' : ''}`}><MealIcon name={meal.name} size={17} className="shrink-0 text-brand" /><span className="truncate">{meal.name}</span></h2>
                  <p className="text-xs text-muted">{meal.items.length === 0 ? t('Nessun alimento') : tp(meal.items.length, '{n} alimento', '{n} alimenti', { n: meal.items.length })}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button className="glass-btn !h-10 !w-10 !p-0" aria-label={t('Modifica pasto {name}', { name: meal.name })} onClick={() => setMealSheet({ meal })}><Pencil size={16} /></button>
                  <button className="glass-btn btn-primary !h-10 !w-10 !p-0" aria-label={t('Aggiungi alimento a {name}', { name: meal.name })} onClick={() => setItemSheet({ mealId: meal.id })}><Plus size={18} strokeWidth={2.6} /></button>
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
          <div className="md:col-span-2 xl:col-span-3"><EmptyCard mascot={<MascotImg kind="zenitsu-pizza" className="mx-auto h-24 w-auto" />} title={t('Nessun pasto per questo giorno')} text={t('Aggiungi un pasto per iniziare a pianificare.')} /></div>
        )}

        {meals.length > 0 && doneCount === meals.length && (
          <div className="card flex items-center gap-3 p-3 md:col-span-2 xl:col-span-3">
            <MascotImg kind="mochi-rice" className="h-16 w-auto shrink-0" />
            <div><p className="font-bold">{t('Giornata completata!')}</p><p className="text-sm text-muted">{t('Hai mangiato tutto quello che avevi in programma.')}</p></div>
          </div>
        )}

        <button className="glass-btn w-full md:col-span-2 xl:col-span-3" onClick={() => setMealSheet({})}><Plus size={16} />{t('Aggiungi pasto')}</button>
      </div>

      <Fab label={t('Aggiungi alimento')} onClick={() => setItemSheet({ mealId: meals[0]?.id })} />

      <ItemSheet open={!!itemSheet} onClose={() => setItemSheet(null)} memberId={member.id} day={day} mealId={itemSheet?.mealId} item={itemSheet?.item} />
      <MealSheet open={!!mealSheet} onClose={() => setMealSheet(null)} memberId={member.id} day={day} meal={mealSheet?.meal} />
    </>
  )
}

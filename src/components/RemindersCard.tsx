import { useEffect, useMemo, useState } from 'react'
import { Copy, Plus, RefreshCw, Send, Trash2, XCircle } from 'lucide-react'
import { Toggle } from './ui'
import { useStore } from '../state/store'
import { engine } from '../sync/engine'
import { pushConfigured, testOutcome } from '../sync/push'
import {
  cronSilent, createTrigger, loadReminders, newRuleId, remindersAvailable, revokeTrigger, saveReminders, savedToken, saveToken, testReminder, triggerUrl,
  type ReminderRule, type RemindersState,
} from '../sync/reminders'
import { normalizeName } from '../lib/foodMatch'
import { DAY_INDEXES } from '../types'
import { t, dayShort, tp } from '../i18n'

const TYPICAL: [RegExp, string][] = [[/colazion|breakfast/, '08:00'], [/pranzo|lunch/, '13:00'], [/cena|dinner/, '20:00']]

/**
 * Promemoria dei pasti: a un orario (push dal Worker) o a un evento (indirizzo per le automazioni dell'iPhone).
 */
export function RemindersCard() {
  const { sync, me, db, prefs } = useStore()
  const fileId = sync.fileId
  const [avail, setAvail] = useState<boolean | null>(null)
  const [state, setState] = useState<RemindersState | null>(null)
  const [rules, setRules] = useState<ReminderRule[]>([])
  const [dirty, setDirty] = useState(false)
  const [token, setToken] = useState<string | null>(() => (fileId ? savedToken(fileId) : null))
  const [urlMeal, setUrlMeal] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)

  const meals = useMemo(() => {
    const names = new Set<string>()
    for (const d of (me ? db.plans[me.id]?.days : undefined) ?? []) for (const m of d.meals) if (m.name.trim()) names.add(m.name.trim())
    return [...names]
  }, [db, me])

  const auth = (): string => {
    const tok = engine.currentToken()
    if (!tok) throw new Error(t('Sessione Google scaduta: riconnettiti e riprova.'))
    return tok
  }
  const run = async (fn: () => Promise<void>) => {
    setMsg(null); setBusy(true)
    try { await fn() } catch (e) { setMsg({ text: e instanceof Error ? e.message : String(e), bad: true }) } finally { setBusy(false) }
  }

  useEffect(() => { void remindersAvailable().then(setAvail) }, [])
  useEffect(() => {
    if (!avail || !fileId || !me) return
    void run(async () => { const s = await loadReminders(fileId, auth()); setState(s); setRules(s.rules); setDirty(false) })
  }, [avail, fileId, me?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!pushConfigured() || avail === false) return <p className="text-sm text-muted">{t('Servono il server delle notifiche aggiornato e il suo Cron Trigger (vedi worker/README.md): non risultano disponibili su questa app.')}</p>
  if (!fileId || !me) return <p className="text-sm text-muted">{t('Collega prima una famiglia e accedi con il tuo account Google.')}</p>

  const edit = (next: ReminderRule[]) => { setRules(next); setDirty(true) }
  const patch = (id: string, p: Partial<ReminderRule>) => edit(rules.map((r) => (r.id === id ? { ...r, ...p } : r)))
  const add = (meal = meals[0] ?? t('Pranzo'), time = '13:00') => edit([...rules, { id: newRuleId(), meal, time, days: [], on: true }])
  const addTypical = () => {
    const next = [...rules]
    for (const name of meals) {
      const hit = TYPICAL.find(([re]) => re.test(normalizeName(name)))
      if (hit && !next.some((r) => normalizeName(r.meal) === normalizeName(name))) next.push({ id: newRuleId(), meal: name, time: hit[1], days: [], on: true })
    }
    edit(next)
  }
  const toggleDay = (r: ReminderRule, d: number) => patch(r.id, { days: r.days.length === 0 ? DAY_INDEXES.filter((x) => x !== d) : r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d].sort() })
  const daysOf = (r: ReminderRule) => (r.days.length ? r.days : DAY_INDEXES)

  const save = () => run(async () => {
    await saveReminders(fileId, auth(), rules)
    setDirty(false); setState((s) => (s ? { ...s, rules } : s))
    setMsg({ text: t('Promemoria salvati. Arrivano come notifica anche con l\'app chiusa.') })
  })
  const test = () => run(async () => {
    const r = await testReminder(fileId, auth(), rules[0]?.meal ?? meals[0] ?? '')
    const o = testOutcome({ ok: true, sent: r.sent, failed: r.failed, removed: r.removed, codes: r.codes ?? [] })
    setMsg({ text: `${o.text}${r.sent > 0 ? ` «${r.preview.title}: ${r.preview.body}»` : ''}`, bad: o.bad })
  })
  const makeToken = (rotate: boolean) => run(async () => {
    const r = await createTrigger(fileId, auth(), rotate)
    if (r.token) { saveToken(fileId, r.token); setToken(r.token); setState((s) => (s ? { ...s, hasToken: true } : s)); setMsg({ text: t('Fatto. Copia l\'indirizzo e segui i passi qui sotto sul tuo iPhone.') }) }
    else setMsg({ text: t('L\'indirizzo esiste già con il tuo account, ma si vede solo dove è stato creato; per rivederlo premi «Nuovo indirizzo» (quello vecchio smette di funzionare).') })
  })
  const dropToken = () => run(async () => { await revokeTrigger(fileId, auth()); saveToken(fileId, null); setToken(null); setState((s) => (s ? { ...s, hasToken: false } : s)) })
  const copy = async () => {
    try { await navigator.clipboard.writeText(triggerUrl(token!, urlMeal)); setMsg({ text: t('Indirizzo copiato.') }) } catch { setMsg({ text: t('Non riesco a copiare: tieni premuto sull\'indirizzo e copialo a mano.'), bad: true }) }
  }

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted">{t('Una notifica «è ora di Pranzo», con gli alimenti del tuo piano, a un orario o quando succede qualcosa sul tuo iPhone.')}</p>
      {!prefs.pushEnabled && <p className="rounded-xl bg-brand/10 p-3 text-xs">{t('Attiva prima le notifiche di questo dispositivo (sezione Notifiche): i promemoria arrivano come notifiche push.')}</p>}
      {state && cronSilent({ ...state, rules }) && <p role="alert" className="rounded-xl bg-exp/15 p-3 text-xs">{t('Il server non sta eseguendo gli orari: controlla che nel suo wrangler.toml ci sia «crons» e ripubblicalo (vedi worker/README.md). Il pulsante «Invia un promemoria di prova» e l\'indirizzo per le automazioni funzionano comunque.')}</p>}
      {state && !state.house && <p className="rounded-xl bg-bg p-3 text-xs text-muted">{t('La famiglia non è collegata al server (accesso persistente di chi l\'ha creata): i promemoria arrivano ma senza l\'elenco degli alimenti.')}</p>}

      <section>
        <h3 className="mb-2 font-bold">{t('A un orario')}</h3>
        <ul className="space-y-2">
          {rules.map((r) => (
            <li key={r.id} className={`rounded-2xl border border-line p-3 ${r.on ? '' : 'opacity-60'}`}>
              <div className="flex items-center gap-2">
                <select className="field min-w-0 flex-1 !py-2" aria-label={t('Pasto')} value={r.meal} onChange={(e) => patch(r.id, { meal: e.target.value })}>
                  {[...new Set([...meals, r.meal])].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <Toggle checked={r.on} onChange={(v) => patch(r.id, { on: v })} label={t('Attivo')} />
                <button className="glass-btn !h-9 !w-9 shrink-0 !p-0" aria-label={t('Rimuovi promemoria {meal}', { meal: r.meal })} onClick={() => edit(rules.filter((x) => x.id !== r.id))}><Trash2 size={15} /></button>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <input type="time" className="field !w-36 !py-2" aria-label={t('Orario')} value={r.time} onChange={(e) => e.target.value && patch(r.id, { time: e.target.value })} />
                <span className="text-xs text-muted">{r.days.length === 0 ? t('Ogni giorno') : r.days.map((d) => dayShort(d)).join(' ')}</span>
              </div>
              <div className="mt-2 grid grid-cols-7 gap-1" role="group" aria-label={t('Giorni')}>
                {DAY_INDEXES.map((d) => {
                  const on = daysOf(r).includes(d)
                  return <button key={d} type="button" aria-pressed={on} onClick={() => toggleDay(r, d)} className={`chip justify-center !px-0 !py-1 !text-xs ${on ? 'chip-active' : 'opacity-70'}`}>{dayShort(d)}</button>
                })}
              </div>
            </li>
          ))}
          {rules.length === 0 && <li className="rounded-xl bg-bg p-3 text-xs text-muted">{t('Nessun promemoria a orario.')}</li>}
        </ul>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button className="glass-btn" disabled={busy || rules.length >= 12} onClick={() => add()}><Plus size={16} />{t('Aggiungi')}</button>
          <button className="glass-btn" disabled={busy || rules.length >= 12} onClick={addTypical}>{t('Orari tipici')}</button>
        </div>
        <button className="glass-btn btn-primary mt-2 w-full" disabled={busy || !dirty} onClick={() => void save()}>{dirty ? t('Salva promemoria') : tp(rules.filter((r) => r.on).length, '{n} promemoria attivo', '{n} promemoria attivi', { n: rules.filter((r) => r.on).length })}</button>
        <button className="glass-btn mt-2 w-full" disabled={busy || dirty} onClick={() => void test()}><Send size={16} />{t('Invia un promemoria di prova')}</button>
      </section>

      <section>
        <h3 className="mb-2 font-bold">{t('Quando succede qualcosa')}</h3>
        <p className="text-muted">{t('Un\'automazione dell\'app Comandi dell\'iPhone chiama un tuo indirizzo personale e ti arriva la notifica del pasto: per esempio alla fine di un allenamento.')}</p>
        {!state?.hasToken && !token ? (
          <button className="glass-btn btn-primary mt-2 w-full" disabled={busy} onClick={() => void makeToken(false)}>{t('Crea l\'indirizzo per le automazioni')}</button>
        ) : (
          <div className="mt-2 space-y-2">
            {token ? (
              <div className="rounded-xl bg-bg p-3">
                <label className="label !mt-0">{t('Pasto di questa automazione')}</label>
                <select className="field !py-2" aria-label={t('Pasto di questa automazione')} value={urlMeal} onChange={(e) => setUrlMeal(e.target.value)}>
                  <option value="">{t('Nessuno (è ora di mangiare)')}</option>
                  {meals.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <p className="mb-1 mt-3 text-xs font-semibold text-muted">{t('Il tuo indirizzo personale (non condividerlo)')}</p>
                <p data-testid="reminder-url" className="break-all font-mono text-xs">{triggerUrl(token, urlMeal)}</p>
                <button className="glass-btn mt-2 w-full" onClick={() => void copy()}><Copy size={16} />{t('Copia indirizzo')}</button>
              </div>
            ) : <p className="rounded-xl bg-bg p-3 text-xs text-muted">{t('L\'indirizzo esiste ma si vede solo sul dispositivo dove è stato creato. Per averlo qui premi «Nuovo indirizzo».')}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button className="glass-btn" disabled={busy} onClick={() => void makeToken(true)}><RefreshCw size={16} />{t('Nuovo indirizzo')}</button>
              <button className="glass-btn" disabled={busy} onClick={() => void dropToken()}><XCircle size={16} />{t('Disattiva')}</button>
            </div>
          </div>
        )}
        <details className="mt-3 rounded-xl bg-bg p-3">
          <summary className="cursor-pointer font-semibold">{t('Come si configura sull\'iPhone')}</summary>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted">
            <li>{t('Apri l\'app Comandi, scheda Automazione, tocca + e scegli l\'evento che deve far partire il promemoria.')}</li>
            <li>{t('Seleziona «Esegui immediatamente» (così non chiede conferma ogni volta).')}</li>
            <li>{t('Aggiungi l\'azione «Ottieni contenuti dell\'URL» e incolla il tuo indirizzo. Metodo: POST (va bene anche GET).')}</li>
            <li>{t('Per avere più automazioni (colazione dopo la corsa, cena dopo l\'allenamento…) usa lo stesso indirizzo cambiando il pasto: scegli il pasto qui sopra e copia di nuovo.')}</li>
          </ol>
          <p className="mt-2 text-xs text-muted">{t('Quali eventi si possono usare dipende da iOS e dalle app: non tutte (per esempio Strava) espongono un evento alle automazioni. L\'indirizzo risponde solo con dei numeri e al massimo 12 volte all\'ora.')}</p>
        </details>
      </section>
      {msg && <p role="status" className={msg.bad ? 'font-medium text-exp' : 'text-muted'}>{msg.text}</p>}
    </div>
  )
}

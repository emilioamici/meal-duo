import { t } from '../i18n'
import { pushUrl } from './push'

/**
 * Promemoria dei pasti (vedi worker/src/reminders.ts): orari salvati sul Worker, che li invia come notifiche push anche ad app chiusa,
 * e un indirizzo personale che l'automazione dell'iPhone (app Comandi) può chiamare quando succede qualcosa.
 * Come per Apple Wallet in MoneyDuo, il token dell'indirizzo si vede una volta sola e si ricorda solo su questo dispositivo.
 */

export interface ReminderRule { id: string; meal: string; time: string; days: number[]; on: boolean }
export interface RemindersState {
  rules: ReminderRule[]
  hasToken: boolean
  /** l'ultima volta che il cron del Worker ha girato (ms), null = mai */
  lastRunAt: number | null
  /** la famiglia è collegata al ponte: i promemoria elencano gli alimenti del pasto */
  house: boolean
}

const TOKEN_KEY = 'mealduo:reminderToken:'
const read = (k: string): string | null => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* noop */ } }
export const savedToken = (fileId: string): string | null => read(TOKEN_KEY + fileId)
export const saveToken = (fileId: string, token: string | null): void => write(TOKEN_KEY + fileId, token)

/** Indirizzo da incollare in Comandi; `meal` rende l'indirizzo specifico per un pasto (si possono fare più automazioni con lo stesso token). */
export const triggerUrl = (token: string, meal = ''): string => `${pushUrl()}/reminder/in/${token}${meal ? `?meal=${encodeURIComponent(meal)}` : ''}`

let availability: Promise<boolean> | null = null
/** Il Worker è aggiornato e dichiara i promemoria? (un Worker vecchio non ha il campo: «non disponibile», non «spento») */
export function remindersAvailable(): Promise<boolean> {
  const base = pushUrl()
  if (!base) return Promise.resolve(false)
  availability ??= fetch(base + '/health').then((r) => (r.ok ? r.json() : null)).then((j) => j?.reminders === true).catch(() => false)
  return availability
}

async function post<T>(path: string, auth: string, body: unknown): Promise<T> {
  const r = await fetch(pushUrl() + path, { method: 'POST', headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = (await r.json().catch(() => ({}))) as T & { error?: string }
  if (!r.ok) throw new Error(j.error || t('Server notifiche: errore {status}', { status: r.status }))
  return j
}

/** I testi delle notifiche, nella lingua dell'app (il Worker li usa così come sono; `{meal}` è il nome del pasto). */
export const reminderTexts = () => ({
  title: t('È ora di {meal}', { meal: '{meal}' }),
  titleAny: t('È ora di mangiare'),
  generic: t('Apri Meal Duo per vedere cosa mangiare.'),
})

export async function loadReminders(fileId: string, auth: string): Promise<RemindersState> {
  const j = await post<{ doc: { rules: ReminderRule[] } | null; hasToken: boolean; lastRunAt: number | null; house: boolean }>('/reminders/get', auth, { fileId })
  return { rules: j.doc?.rules ?? [], hasToken: j.hasToken, lastRunAt: j.lastRunAt, house: j.house }
}

export const timeZone = (): string => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }

export const saveReminders = (fileId: string, auth: string, rules: ReminderRule[]) => post<{ ok: true }>('/reminders/save', auth, { fileId, tz: timeZone(), texts: reminderTexts(), rules })
export const createTrigger = (fileId: string, auth: string, rotate = false) => post<{ exists: boolean; token?: string }>('/reminders/token', auth, { fileId, rotate })
export const revokeTrigger = (fileId: string, auth: string) => post<{ ok: true }>('/reminders/revoke', auth, { fileId })
export const testReminder = (fileId: string, auth: string, meal: string) =>
  post<{ sent: number; failed: number; removed: number; codes?: number[]; preview: { title: string; body: string }; personalised: boolean }>('/reminders/test', auth, { fileId, meal })

/** Un'ora senza battito del cron = gli orari non stanno partendo (manca `crons` in wrangler.toml o il Worker non è stato ripubblicato). */
export const cronSilent = (s: RemindersState, now = Date.now()): boolean => s.rules.some((r) => r.on) && (!s.lastRunAt || now - s.lastRunAt > 3 * 3_600_000)

let n = 0
export const newRuleId = (): string => `r${Date.now().toString(36)}${(n++).toString(36)}`

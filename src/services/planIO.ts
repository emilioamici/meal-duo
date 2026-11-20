/**
 * Import / export del piano settimanale di un membro in JSON.
 *
 * Formato "meal-duo-plan" v1:
 * {
 *   "format": "meal-duo-plan", "version": 1, "member": "Emilio",
 *   "days": [ { "day": "Lunedì", "meals": [ { "name": "Colazione",
 *               "items": [ { "name": "Yogurt greco", "quantity": 170, "unit": "g" } ] } ] }, … ]
 * }
 */
import type { AppDatabase, DayIndex, DayPlan, Meal } from '../types'
import { DAY_INDEXES, DAY_LONG } from '../types'
import { DEFAULT_MEALS, emptyDay, ensureFood, foodById, replacePlan } from './dbOps'
import { normalizeName } from '../lib/foodMatch'
import { cleanUnit } from '../lib/units'
import { nowIso, uid } from '../lib/ids'
import { t } from '../i18n'

export const PLAN_FORMAT = 'meal-duo-plan'

export interface ParsedItem { name: string; quantity: number; unit: string }
export interface ParsedMeal { name: string; items: ParsedItem[] }
export interface ParsedPlan { member?: string; days: ParsedMeal[][] }

export interface ParseResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  plan?: ParsedPlan
}

const DAY_ALIASES: Record<string, DayIndex> = {}
;(['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'] as const).forEach((s, i) => {
  DAY_ALIASES[s] = i as DayIndex
  DAY_ALIASES[normalizeName(DAY_LONG[i])] = i as DayIndex
})
;(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).forEach((s, i) => (DAY_ALIASES[s] = i as DayIndex))
;(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const).forEach((s, i) => (DAY_ALIASES[s] = i as DayIndex))

export function parseDayName(v: unknown): DayIndex | undefined {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6) return v as DayIndex
  if (typeof v !== 'string') return undefined
  return DAY_ALIASES[normalizeName(v)]
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function parseQuantity(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string') {
    const n = Number(v.trim().replace(',', '.'))
    return Number.isFinite(n) && v.trim() !== '' ? n : undefined
  }
  return undefined
}

export function parsePlanJson(text: string): ParseResult {
  const errors: string[] = []
  const warnings: string[] = []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, errors: [t('JSON non valido: {m}', { m: (e as Error).message })], warnings }
  }
  if (!isObj(raw)) return { ok: false, errors: [t('La radice del file deve essere un oggetto JSON.')], warnings }
  if (raw.format !== undefined && raw.format !== PLAN_FORMAT) warnings.push(t('Campo "format" inatteso ("{f}"): atteso "{e}".', { f: String(raw.format), e: PLAN_FORMAT }))

  // days: array di {day, meals} oppure oggetto { lunedì: {meals} | [meals] }
  const entries: [unknown, unknown, string][] = []
  if (Array.isArray(raw.days)) raw.days.forEach((d, i) => entries.push([isObj(d) ? d.day ?? i : i, d, `days[${i}]`]))
  else if (isObj(raw.days)) Object.entries(raw.days).forEach(([k, d]) => entries.push([k, d, `days.${k}`]))
  else return { ok: false, errors: [t('Manca il campo "days" (array di 7 giorni oppure oggetto indicizzato per nome del giorno).')], warnings }

  const days: ParsedMeal[][] = DAY_INDEXES.map(() => [])
  const seen = new Set<DayIndex>()
  for (const [dayKey, d, path] of entries) {
    const idx = parseDayName(dayKey)
    if (idx === undefined) { errors.push(t('{path}: giorno non riconosciuto ({day}). Usa Lunedì…Domenica.', { path, day: JSON.stringify(dayKey) })); continue }
    if (seen.has(idx)) { errors.push(t('{path}: il giorno {day} compare più volte.', { path, day: DAY_LONG[idx] })); continue }
    seen.add(idx)
    const mealsRaw = Array.isArray(d) ? d : isObj(d) ? d.meals : undefined
    if (!Array.isArray(mealsRaw)) { errors.push(t('{path}: manca "meals" (array di pasti).', { path })); continue }
    mealsRaw.forEach((m, mi) => {
      const mp = `${path}.meals[${mi}]`
      if (!isObj(m) || typeof m.name !== 'string' || !m.name.trim()) { errors.push(t('{path}: il pasto richiede un "name" non vuoto.', { path: mp })); return }
      if (!Array.isArray(m.items)) { errors.push(t('{path}: manca "items" (array di alimenti).', { path: mp })); return }
      const items: ParsedItem[] = []
      m.items.forEach((it, ii) => {
        const ip = `${mp}.items[${ii}]`
        if (!isObj(it) || typeof it.name !== 'string' || !it.name.trim()) { errors.push(t('{path}: l\'alimento richiede un "name" non vuoto.', { path: ip })); return }
        const q = parseQuantity(it.quantity)
        if (q === undefined || q <= 0) { errors.push(t('{path} ({name}): "quantity" deve essere un numero maggiore di 0.', { path: ip, name: String(it.name) })); return }
        let unit = 'g'
        if (typeof it.unit === 'string' && it.unit.trim()) unit = cleanUnit(it.unit)
        else warnings.push(t('{path} ({name}): unità mancante, uso "g".', { path: ip, name: String(it.name) }))
        items.push({ name: it.name.trim(), quantity: q, unit })
      })
      days[idx].push({ name: m.name.trim(), items })
    })
  }
  if (seen.size === 0 && errors.length === 0) errors.push(t('Il piano non contiene alcun giorno.'))
  const missing = DAY_INDEXES.filter((i) => !seen.has(i)).map((i) => DAY_LONG[i])
  if (missing.length && seen.size > 0) warnings.push(t('Giorni non presenti (resteranno vuoti): {days}.', { days: missing.join(', ') }))

  return { ok: errors.length === 0, errors, warnings, plan: errors.length ? undefined : { member: typeof raw.member === 'string' ? raw.member : undefined, days } }
}

export interface ImportReport {
  matched: { from: string; to: string }[]
  created: string[]
  items: number
}

/** Applica un piano validato al membro: normalizza i nomi sul catalogo condiviso e sostituisce il piano. */
export function applyImport(db: AppDatabase, memberId: string, parsed: ParsedPlan): { db: AppDatabase; report: ImportReport } {
  let next = db
  const report: ImportReport = { matched: [], created: [], items: 0 }
  const resolved = new Map<string, string>() // nome normalizzato → foodId
  const at = nowIso()

  const dayPlans: DayPlan[] = parsed.days.map((meals, di) => {
    if (meals.length === 0) return emptyDay(at, DEFAULT_MEALS)
    return {
      updatedAt: at,
      meals: meals.map((pm): Meal => ({
        id: uid('meal'),
        name: pm.name,
        items: pm.items.map((pi) => {
          const key = normalizeName(pi.name)
          let foodId = resolved.get(key)
          if (!foodId) {
            const r = ensureFood(next, pi.name, pi.unit)
            next = r.db
            foodId = r.food.id
            resolved.set(key, foodId)
            if (r.created) report.created.push(r.food.name)
            else if (normalizeName(r.food.name) !== key) report.matched.push({ from: pi.name, to: foodById(next, foodId)!.name })
          }
          report.items++
          return { id: uid('it'), foodId, quantity: pi.quantity, unit: pi.unit }
        }),
      })),
    }
    void di
  })
  return { db: replacePlan(next, memberId, dayPlans), report }
}

/* ---------------- Export ---------------- */

const instructions = () => [
  t('Piano settimanale Meal Duo. Compila "days" da Lunedì a Domenica; ogni giorno ha dei pasti e ogni pasto una lista di alimenti.'),
  t('Ogni alimento: "name" (testo), "quantity" (numero > 0) e "unit" (g, kg, ml, l, pz, cucchiaio, …).'),
  t('I nomi vengono associati al catalogo alimenti della famiglia (es. "pollo" → "Petto di pollo"), così la spesa somma le quantità correttamente.'),
  t('Puoi aggiungere pasti extra: basta un nuovo elemento in "meals". I campi che iniziano con "_" sono ignorati.'),
]

export function exportPlan(db: AppDatabase, memberId: string): unknown {
  const member = db.members.find((m) => m.id === memberId)
  const plan = db.plans[memberId]
  return {
    format: PLAN_FORMAT,
    version: 1,
    member: member?.name ?? '',
    days: DAY_INDEXES.map((i) => ({
      day: DAY_LONG[i],
      meals: (plan?.days[i]?.meals ?? []).map((m) => ({
        name: m.name,
        items: m.items.map((it) => ({ name: foodById(db, it.foodId)?.name ?? '?', quantity: it.quantity, unit: it.unit })),
      })),
    })),
  }
}

/** Tracciato vuoto (tutti i pasti, nessun alimento) oppure di esempio (alcuni alimenti compilati). */
export function planTemplate(kind: 'empty' | 'example'): unknown {
  const example: Record<string, Record<string, { name: string; quantity: number; unit: string }[]>> = {
    Lunedì: {
      Colazione: [{ name: 'Yogurt greco', quantity: 170, unit: 'g' }, { name: "Fiocchi d'avena", quantity: 40, unit: 'g' }],
      'Spuntino mattina': [{ name: 'Mela', quantity: 1, unit: 'pz' }],
      Pranzo: [{ name: 'Riso basmati', quantity: 90, unit: 'g' }, { name: 'Petto di pollo', quantity: 150, unit: 'g' }, { name: 'Olio EVO', quantity: 10, unit: 'ml' }],
      Merenda: [{ name: 'Mandorle', quantity: 15, unit: 'g' }],
      Cena: [{ name: 'Uova', quantity: 2, unit: 'pz' }, { name: 'Pane integrale', quantity: 60, unit: 'g' }],
    },
  }
  return {
    format: PLAN_FORMAT,
    version: 1,
    _istruzioni: instructions(),
    member: kind === 'example' ? t('Nome membro') : '',
    days: DAY_INDEXES.map((i) => ({
      day: DAY_LONG[i],
      meals: DEFAULT_MEALS.map((name) => ({
        name,
        items: kind === 'example' ? (example[DAY_LONG[i]]?.[name] ?? []) : [],
      })),
    })),
  }
}

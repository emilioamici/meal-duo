/**
 * Import / export del piano settimanale di un membro in JSON.
 *
 * Formato "meal-duo-plan" v1:
 * {
 *   "format": "meal-duo-plan", "version": 1, "member": "Emilio",
 *   "days": [ { "day": "Lunedì", "meals": [ { "name": "Colazione",
 *               "items": [ { "name": "Yogurt greco", "quantity": 170, "unit": "g" } ] } ] }, … ],
 *   "variants": [ { "from": { "name": "Pasta", "quantity": 100, "unit": "g" },
 *                   "to":   { "name": "Riso",  "quantity": 120, "unit": "g" } } ]   // facoltativo: 100 g di pasta = 120 g di riso
 * }
 * `variants` è del catalogo condiviso (non del membro) e si può importare anche da solo, senza `days`.
 */
import type { AppDatabase, DayIndex, DayPlan, Meal } from '../types'
import { DAY_INDEXES, DAY_LONG } from '../types'
import { DEFAULT_MEALS, emptyDay, ensureFood, foodById, replacePlan, setVariant } from './dbOps'
import { variantsOf } from './variants'
import { normalizeName } from '../lib/foodMatch'
import { cleanUnit, round2, toBase } from '../lib/units'
import { nowIso, uid } from '../lib/ids'
import { t } from '../i18n'

export const PLAN_FORMAT = 'meal-duo-plan'

export interface ParsedItem { name: string; quantity: number; unit: string }
export interface ParsedMeal { name: string; items: ParsedItem[] }
export interface ParsedVariant { from: ParsedItem; to: ParsedItem }
export interface ParsedPlan {
  member?: string
  days: ParsedMeal[][]
  /** false se il file contiene solo varianti: il piano del membro non si tocca */
  hasDays: boolean
  variants: ParsedVariant[]
}

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

  // varianti degli alimenti (facoltative): { from: {name, quantity, unit}, to: {name, quantity, unit} }.
  // Un problema in una variante non blocca l'import: quella variante si salta con un avviso e il resto entra.
  const variants: ParsedVariant[] = []
  const skip = (msg: string) => warnings.push(t('Variante saltata · {m}', { m: msg }))
  if (raw.variants !== undefined) {
    if (!Array.isArray(raw.variants)) warnings.push(t('"variants" deve essere un array di varianti: ignorato.'))
    else raw.variants.forEach((v, vi) => {
      const vp = `variants[${vi}]`
      const side = (x: unknown, key: 'from' | 'to'): ParsedItem | undefined => {
        const sp = `${vp}.${key}`
        if (!isObj(x) || typeof x.name !== 'string' || !x.name.trim()) { skip(t('{path}: serve un "name" non vuoto.', { path: sp })); return undefined }
        const q = parseQuantity(x.quantity)
        if (q === undefined || q <= 0) { skip(t('{path} ({name}): "quantity" deve essere un numero maggiore di 0.', { path: sp, name: String(x.name) })); return undefined }
        let unit = 'g'
        if (typeof x.unit === 'string' && x.unit.trim()) unit = cleanUnit(x.unit)
        else warnings.push(t('{path} ({name}): unità mancante, uso "g".', { path: sp, name: String(x.name) }))
        return { name: x.name.trim(), quantity: q, unit }
      }
      if (!isObj(v)) { skip(t('{path}: la variante richiede "from" e "to".', { path: vp })); return }
      const from = side(v.from, 'from'), to = side(v.to, 'to')
      if (!from || !to) return
      if (normalizeName(from.name) === normalizeName(to.name)) { skip(t('{path}: un alimento non può essere variante di se stesso ({name}).', { path: vp, name: from.name })); return }
      variants.push({ from, to }) // le unità dei due lati possono essere diverse (es. 1 pz di uova = 50 g di albume)
    })
  }

  // days: array di {day, meals} oppure oggetto { lunedì: {meals} | [meals] }
  const entries: [unknown, unknown, string][] = []
  if (Array.isArray(raw.days)) raw.days.forEach((d, i) => entries.push([isObj(d) ? d.day ?? i : i, d, `days[${i}]`]))
  else if (isObj(raw.days)) Object.entries(raw.days).forEach(([k, d]) => entries.push([k, d, `days.${k}`]))
  else if (raw.days === undefined && variants.length > 0) {
    // solo varianti: il piano resta com'è
    return { ok: errors.length === 0, errors, warnings, plan: errors.length ? undefined : { member: typeof raw.member === 'string' ? raw.member : undefined, days: DAY_INDEXES.map(() => []), hasDays: false, variants } }
  } else return { ok: false, errors: [...errors, t('Manca il campo "days" (array di 7 giorni oppure oggetto indicizzato per nome del giorno).')], warnings }

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

  return { ok: errors.length === 0, errors, warnings, plan: errors.length ? undefined : { member: typeof raw.member === 'string' ? raw.member : undefined, days, hasDays: true, variants } }
}

export interface ImportReport {
  matched: { from: string; to: string }[]
  created: string[]
  items: number
  /** varianti applicate al catalogo */
  variants: number
  /** varianti non applicate (l'unità indicata non è confrontabile con quella dell'alimento nel catalogo) */
  variantsSkipped: string[]
}

/** Applica un piano validato al membro: normalizza i nomi sul catalogo condiviso e sostituisce il piano. */
export function applyImport(db: AppDatabase, memberId: string, parsed: ParsedPlan): { db: AppDatabase; report: ImportReport } {
  let next = db
  const report: ImportReport = { matched: [], created: [], items: 0, variants: 0, variantsSkipped: [] }
  const resolved = new Map<string, string>() // nome normalizzato → foodId
  const at = nowIso()

  const dayPlans: DayPlan[] = !parsed.hasDays ? [] : parsed.days.map((meals, di) => {
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
  if (parsed.hasDays) next = replacePlan(next, memberId, dayPlans)

  // varianti: si associano (o creano) gli alimenti e si salva il fattore nell'unità del catalogo di ciascuno
  const resolve = (name: string, unit: string) => {
    const r = ensureFood(next, name, unit)
    next = r.db
    if (r.created && !report.created.includes(r.food.name)) report.created.push(r.food.name)
    return r.food
  }
  const inCatalogUnit = (food: { unit: string }, q: number, unit: string): number | undefined => {
    const a = toBase(q, unit), c = toBase(1, food.unit)
    return a.unit === c.unit ? round2(a.quantity / c.quantity) : undefined
  }
  for (const v of parsed.variants) {
    const a = resolve(v.from.name, v.from.unit), b = resolve(v.to.name, v.to.unit)
    const amount = inCatalogUnit(a, v.from.quantity, v.from.unit), variantAmount = inCatalogUnit(b, v.to.quantity, v.to.unit)
    if (a.id === b.id || !amount || !variantAmount) { report.variantsSkipped.push(`${v.from.name} = ${v.to.name}`); continue }
    next = setVariant(next, a.id, b.id, amount, variantAmount)
    report.variants++
  }
  return { db: next, report }
}

/* ---------------- Export ---------------- */

const instructions = () => [
  t('Piano settimanale Meal Duo. Compila "days" da Lunedì a Domenica; ogni giorno ha dei pasti e ogni pasto una lista di alimenti.'),
  t('Ogni alimento: "name" (testo), "quantity" (numero > 0) e "unit" (g, kg, ml, l, pz, cucchiaio, …).'),
  t('I nomi vengono associati al catalogo alimenti della famiglia (es. "pollo" → "Petto di pollo"), così la spesa somma le quantità correttamente.'),
  t('Puoi aggiungere pasti extra: basta un nuovo elemento in "meals". I campi che iniziano con "_" sono ignorati.'),
  t('"variants" (facoltativo) elenca gli alimenti che si sostituiscono con il fattore di conversione: {"from": {"name": "Pasta", "quantity": 100, "unit": "g"}, "to": {"name": "Riso", "quantity": 120, "unit": "g"}} significa 100 g di pasta = 120 g di riso (vale nei due sensi). Si può importare anche da solo, senza "days".'),
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
    variants: exportVariants(db),
  }
}

/** Varianti del catalogo condiviso (dichiarate su un alimento, ognuno nella propria unità). */
export function exportVariants(db: AppDatabase): { from: ParsedItem; to: ParsedItem }[] {
  const out: { from: ParsedItem; to: ParsedItem }[] = []
  for (const f of db.foodCatalog) {
    if (f.deleted) continue
    for (const o of variantsOf(db, f.id)) {
      if (!o.own) continue
      out.push({ from: { name: f.name, quantity: o.variant.amount, unit: f.unit }, to: { name: o.food.name, quantity: o.variant.variantAmount, unit: o.food.unit } })
    }
  }
  return out
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
    variants: kind === 'example' ? [{ from: { name: 'Pasta integrale', quantity: 100, unit: 'g' }, to: { name: 'Riso basmati', quantity: 120, unit: 'g' } }] : [],
    days: DAY_INDEXES.map((i) => ({
      day: DAY_LONG[i],
      meals: DEFAULT_MEALS.map((name) => ({
        name,
        items: kind === 'example' ? (example[DAY_LONG[i]]?.[name] ?? []) : [],
      })),
    })),
  }
}

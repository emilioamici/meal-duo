import { useSyncExternalStore } from 'react'
import { EN } from './en'

/**
 * Lingue dell'app: italiano (la lingua dei testi nel codice) e inglese.
 * `t('testo in italiano', { n: 3 })` restituisce il testo nella lingua in uso: in inglese lo cerca nel dizionario (`en.ts`),
 * dove la chiave è il testo italiano; se manca torna l'italiano. I segnaposto sono {nome}.
 */
export type Lang = 'it' | 'en'
export type LangPref = 'auto' | Lang

export const LANG_KEY = 'mealduo:lang'
export const LANG_NAME: Record<LangPref, string> = { auto: 'Automatico / Automatic', it: 'Italiano', en: 'English' }

export const parseLangPref = (v: unknown): LangPref => (v === 'it' || v === 'en' ? v : 'auto')

export function getLangPref(): LangPref {
  try { return parseLangPref(localStorage.getItem(LANG_KEY)) } catch { return 'auto' }
}

/** La lingua del dispositivo: italiano se il browser è in italiano, altrimenti inglese. */
export function systemLang(): Lang {
  if (typeof window === 'undefined') return 'it'   // test e server: italiano
  const l = navigator.languages?.[0] || navigator.language || 'it'
  return /^it\b/i.test(l) ? 'it' : 'en'
}

const resolve = (pref: LangPref): Lang => (pref === 'auto' ? systemLang() : pref)

let current: Lang = resolve(getLangPref())
const listeners = new Set<() => void>()

export const lang = (): Lang => current
/** Impostazioni internazionali per date e numeri. */
export const locale = (): string => (current === 'en' ? 'en-GB' : 'it-IT')

export function setLangPref(pref: LangPref): void {
  try { if (pref === 'auto') localStorage.removeItem(LANG_KEY); else localStorage.setItem(LANG_KEY, pref) } catch { /* noop */ }
  applyLang(resolve(pref))
}

export function applyLang(l: Lang): void {
  current = l
  if (typeof document !== 'undefined') document.documentElement.lang = l
  listeners.forEach((f) => f())
}

if (typeof document !== 'undefined') document.documentElement.lang = current

const fill = (s: string, params?: Record<string, string | number>): string =>
  params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s

export function t(it: string, params?: Record<string, string | number>): string {
  return fill(current === 'en' ? EN[it] ?? it : it, params)
}

/** Fa rileggere i testi ai componenti quando cambia la lingua. */
export function useLang(): Lang {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, lang, lang)
}

/** Plurale: sceglie fra due testi italiani (singolare / plurale) in base a `n`. */
export const tp = (n: number, one: string, many: string, params?: Record<string, string | number>): string => t(n === 1 ? one : many, params)

const DAYS_EN_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAYS_EN_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DAYS_IT_SHORT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
const DAYS_IT_LONG = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica']
/** Nomi dei giorni nella lingua in uso (0 = Lunedì). Nei file JSON del piano restano sempre in italiano. */
export const dayShort = (d: number): string => (current === 'en' ? DAYS_EN_SHORT : DAYS_IT_SHORT)[d]
export const dayLong = (d: number): string => (current === 'en' ? DAYS_EN_LONG : DAYS_IT_LONG)[d]

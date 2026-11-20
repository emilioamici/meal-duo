import { locale } from '../i18n'
/** Unità: conversione verso l'unità base per poter sommare (kg→g, l→ml …). */

interface UnitInfo {
  base: string
  factor: number
}

const TABLE: Record<string, UnitInfo> = {
  g: { base: 'g', factor: 1 },
  gr: { base: 'g', factor: 1 },
  grammi: { base: 'g', factor: 1 },
  kg: { base: 'g', factor: 1000 },
  hg: { base: 'g', factor: 100 },
  etti: { base: 'g', factor: 100 },
  mg: { base: 'g', factor: 0.001 },
  ml: { base: 'ml', factor: 1 },
  cl: { base: 'ml', factor: 10 },
  dl: { base: 'ml', factor: 100 },
  l: { base: 'ml', factor: 1000 },
  lt: { base: 'ml', factor: 1000 },
  litri: { base: 'ml', factor: 1000 },
  pz: { base: 'pz', factor: 1 },
  pezzi: { base: 'pz', factor: 1 },
  pezzo: { base: 'pz', factor: 1 },
  n: { base: 'pz', factor: 1 },
}

export const COMMON_UNITS = ['g', 'ml', 'pz', 'kg', 'l', 'cucchiaio', 'cucchiaino', 'fetta', 'vasetto', 'bustina'] as const

export function cleanUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/\.$/, '') || 'pz'
}

export function toBase(quantity: number, unit: string): { quantity: number; unit: string } {
  const u = cleanUnit(unit)
  const info = TABLE[u]
  if (!info) return { quantity, unit: u }
  return { quantity: quantity * info.factor, unit: info.base }
}

/** Arrotonda a max 2 decimali evitando errori di virgola mobile. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

const nfFor = () => new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 })

/** Formatta una quantità in unità base in modo leggibile: 1500 g → "1,5 kg". */
export function formatQuantity(quantity: number, unit: string): string {
  const q = round2(quantity)
  if (unit === 'g' && q >= 1000) return `${nfFor().format(round2(q / 1000))} kg`
  if (unit === 'ml' && q >= 1000) return `${nfFor().format(round2(q / 1000))} l`
  if (unit === 'pz') return `${nfFor().format(q)} pz`
  return `${nfFor().format(q)} ${unit}`
}

/** Formattazione compatta senza spazio per le etichette per-membro: "560g". */
export function formatCompact(quantity: number, unit: string): string {
  return formatQuantity(quantity, unit).replace(' ', '')
}

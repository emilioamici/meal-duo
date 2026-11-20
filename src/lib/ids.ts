export function uid(prefix = ''): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14)
  return prefix ? `${prefix}_${rnd}` : rnd
}

export const nowIso = (): string => new Date().toISOString()

/** Indice del giorno corrente con Lunedì = 0 */
export function todayIndex(d: Date = new Date()): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return ((d.getDay() + 6) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6
}

import type { FoodCatalogItem, FoodCategory } from '../types'

const STOP = new Set(['di', 'del', 'della', 'dello', 'dei', 'delle', 'degli', 'al', 'alla', 'allo', 'ai', 'alle', 'a', 'da', 'in', 'con', 'e', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'una', 'uno'])

/** minuscolo, senza accenti/punteggiatura, spazi singoli */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** stemming grossolano per l'italiano: pomodori/pomodoro → pomodor, uova/uovo → uov */
function stem(t: string): string {
  return t.length > 3 ? t.replace(/[aeio]$/, '') : t
}

export function tokens(s: string): string[] {
  return normalizeName(s)
    .split(' ')
    .filter((t) => t && !STOP.has(t))
    .map(stem)
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((t) => b.includes(t))
}

const candidateNames = (f: FoodCatalogItem): string[] => [f.name, ...(f.aliases ?? [])]

/**
 * Punteggio 0..1 di somiglianza tra query e alimento (per autocompletamento).
 *  1.00 uguale · 0.95 stessi token (ordine/plurale) · 0.85 prefisso · 0.75 tutti i token della query contenuti
 *  0.6–0.7 sottostringa / typo lieve
 */
export function scoreFood(query: string, food: FoodCatalogItem): number {
  const nq = normalizeName(query)
  if (!nq) return 0
  const tq = tokens(query)
  let best = 0
  for (const name of candidateNames(food)) {
    const nn = normalizeName(name)
    const tn = tokens(name)
    let s = 0
    if (nn === nq) s = 1
    else if (tq.length && sameSet(tq, tn)) s = 0.95
    else if (nn.startsWith(nq)) s = 0.85
    else if (tn.some((t) => tq.length && t.startsWith(tq[0]) && tq.length === 1)) s = 0.78
    else if (tq.length && tq.every((t) => tn.some((x) => x.startsWith(t) || t.startsWith(x)))) s = 0.75
    else if (nn.includes(nq)) s = 0.65
    else {
      const d = levenshtein(nq, nn)
      const rel = 1 - d / Math.max(nq.length, nn.length)
      if (d <= 2 && nq.length >= 4 && rel >= 0.7) s = 0.6 * rel + 0.2
    }
    best = Math.max(best, s)
  }
  return best
}

/** Autocompletamento: alimenti ordinati per somiglianza (esclude i tombstone). */
export function searchFoods(catalog: FoodCatalogItem[], query: string, limit = 6): FoodCatalogItem[] {
  if (!normalizeName(query)) return []
  return catalog
    .filter((f) => !f.deleted)
    .map((f) => ({ f, s: scoreFood(query, f) }))
    .filter((x) => x.s >= 0.55)
    .sort((a, b) => b.s - a.s || a.f.name.localeCompare(b.f.name, 'it'))
    .slice(0, limit)
    .map((x) => x.f)
}

/**
 * Associazione "sicura" usata dall'import: restituisce l'alimento solo se la corrispondenza è inequivocabile
 *  - nome/alias identico (normalizzato), stessi token (plurale/ordine), typo di 1 carattere
 *  - oppure i token della query sono contenuti in UN SOLO alimento (es. "Pollo" → unico "Petto di pollo")
 */
export function findCanonical(catalog: FoodCatalogItem[], name: string): FoodCatalogItem | undefined {
  const live = catalog.filter((f) => !f.deleted)
  const nq = normalizeName(name)
  if (!nq) return undefined
  const tq = tokens(name)
  const exact = live.find((f) => candidateNames(f).some((n) => normalizeName(n) === nq))
  if (exact) return exact
  const sameTokens = live.filter((f) => candidateNames(f).some((n) => sameSet(tq, tokens(n))))
  if (sameTokens.length === 1) return sameTokens[0]
  const typo = live.filter((f) => candidateNames(f).some((n) => {
    const nn = normalizeName(n)
    return nq.length >= 5 && levenshtein(nq, nn) === 1
  }))
  if (typo.length === 1) return typo[0]
  if (tq.length) {
    const subset = live.filter((f) => candidateNames(f).some((n) => {
      const tn = tokens(n)
      return tq.every((t) => tn.includes(t))
    }))
    if (subset.length === 1) return subset[0]
  }
  return undefined
}

/** Coppie di alimenti probabilmente duplicati (per la funzione "Unisci duplicati"). */
export function findDuplicatePairs(catalog: FoodCatalogItem[]): [FoodCatalogItem, FoodCatalogItem][] {
  const live = catalog.filter((f) => !f.deleted)
  const out: [FoodCatalogItem, FoodCatalogItem][] = []
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]
      const b = live[j]
      if (a.distinct?.includes(b.id) || b.distinct?.includes(a.id)) continue // «lascia entrambi»
      const ta = tokens(a.name)
      const tb = tokens(b.name)
      const subset = (x: string[], y: string[]) => x.length > 0 && x.every((t) => y.includes(t))
      const lev = levenshtein(normalizeName(a.name), normalizeName(b.name))
      if (sameSet(ta, tb) || (lev <= 2 && normalizeName(a.name).length >= 5) || subset(ta, tb) || subset(tb, ta)) out.push([a, b])
    }
  }
  return out
}

const CATEGORY_KEYWORDS: [FoodCategory, string[]][] = [
  ['Frutta e verdura', ['mela', 'pera', 'banana', 'arancia', 'kiwi', 'frutti', 'fragol', 'insalata', 'lattuga', 'rucola', 'spinaci', 'zucchin', 'pomodor', 'carota', 'broccol', 'cavol', 'finocch', 'peperon', 'melanzan', 'patata', 'cipoll', 'aglio', 'verdur', 'funghi', 'limone', 'avocado', 'cetriol', 'fagiolini', 'sedano']],
  ['Carne e pesce', ['pollo', 'tacchino', 'manzo', 'maiale', 'vitello', 'bresaola', 'prosciutto', 'fesa', 'salmone', 'tonno', 'merluzzo', 'orata', 'branzino', 'gamberi', 'pesce', 'carne', 'hamburger', 'sgombro']],
  ['Latticini e uova', ['uova', 'uovo', 'latte', 'yogurt', 'formaggio', 'parmigiano', 'mozzarella', 'ricotta', 'burro', 'fiocchi', 'grana', 'skyr', 'feta', 'albume']],
  ['Pane, pasta e cereali', ['pane', 'pasta', 'riso', 'avena', 'fiocchi di', 'cereali', 'fette biscottate', 'farro', 'orzo', 'cous', 'quinoa', 'gallette', 'biscott', 'cracker', 'farina', 'gnocchi', 'piadina', 'muesli', 'grissini']],
  ['Dispensa', ['olio', 'sale', 'aceto', 'miele', 'marmellata', 'noci', 'mandorle', 'frutta secca', 'legumi', 'ceci', 'lenticchie', 'fagioli', 'passata', 'cacao', 'zucchero', 'spezie', 'burro di', 'tahin', 'cioccolat']],
]

export function guessCategory(name: string): FoodCategory {
  const n = normalizeName(name)
  for (const [cat, kws] of CATEGORY_KEYWORDS) {
    if (kws.some((k) => n.includes(normalizeName(k)))) return cat
  }
  return 'Surgelati e altro'
}

export const FOOD_CATEGORIES: FoodCategory[] = ['Frutta e verdura', 'Carne e pesce', 'Latticini e uova', 'Pane, pasta e cereali', 'Dispensa', 'Surgelati e altro']

/** "petto di pollo" → "Petto di pollo" */
export function capitalize(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ')
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t
}

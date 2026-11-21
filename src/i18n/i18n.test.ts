import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EN } from './en'
import { applyLang, dayLong, dayShort, lang, locale, parseLangPref, t, tp } from './index'
import { tb } from './rich'

const files = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) files(p, out)
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && !p.includes('i18n/')) out.push(p)
  }
  return out
}
const unesc = (s: string) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\').replace(/\\n/g, '\n').replace(/\\"/g, '"')

/** Tutti i testi passati a t('…') / tb('…') / tp(n, '…', '…') nel codice. */
function usedKeys(): string[] {
  const out = new Set<string>()
  const str = String.raw`'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"`
  for (const p of files('src')) {
    const s = readFileSync(p, 'utf8')
    for (const m of s.matchAll(new RegExp(String.raw`(?<![\w.])(?:t|tb)\((?:${str})`, 'g'))) out.add(unesc(m[1] ?? m[2]))
    for (const m of s.matchAll(new RegExp(String.raw`(?<![\w.])tp\([^,]+,\s*(?:${str})\s*,\s*(?:${str})`, 'g'))) { out.add(unesc(m[1] ?? m[2])); out.add(unesc(m[3] ?? m[4])) }
  }
  return [...out]
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
const tags = (s: string) => (s.match(/<\/?(b|code)>/g) ?? []).join('')

afterEach(() => applyLang('it'))

describe('traduzioni in inglese', () => {
  it('ogni testo usato nel codice ha la traduzione inglese', () => {
    expect(usedKeys().filter((k) => !(k in EN))).toEqual([])
  })
  it('categorie degli alimenti, etichette delle tab e stati sync (testi dinamici) tradotti', async () => {
    const { FOOD_CATEGORIES } = await import('../lib/foodMatch')
    const dyn = [...FOOD_CATEGORIES, 'Oggi', 'Settimana', 'Spesa', 'Impostazioni', 'Mochi (Chiaro)', 'Zenitsu (Scuro)', 'Locale', 'Da inviare', 'Sync…', 'Sincronizzato', 'Offline', 'Errore', 'Accedi', 'Non collegato', 'Riconnessione necessaria', 'Da sincronizzare', 'Sincronizzazione…']
    expect(dyn.filter((k) => !(k in EN))).toEqual([])
  })
  it('nessuna voce inglese orfana (non usata nel codice né tra i testi dinamici)', async () => {
    const { FOOD_CATEGORIES } = await import('../lib/foodMatch')
    const dynamic = new Set([...FOOD_CATEGORIES, 'Oggi', 'Settimana', 'Spesa', 'Impostazioni', 'Mochi (Chiaro)', 'Zenitsu (Scuro)', 'Automatico', 'Locale', 'Da inviare', 'Sync…', 'Sincronizzato', 'Offline', 'Errore', 'Accedi', 'Non collegato', 'Riconnessione necessaria', 'Da sincronizzare', 'Sincronizzazione…', 'Spuntino serale', 'Pre-workout', 'Post-workout',
      // scelte con un ternario dentro t(cond ? 'a' : 'b'): la regex non le vede come letterali
      'Sincronizzazione: {s}. Tocca per collegare Google Drive', 'Sincronizzazione: {s}. Tocca per sincronizzare', '{name}: da comprare', '{name}: preso', '{name}: completato', '{name}: da completare', '{n} usi', '{n} uso',
      // descrizioni dei temi (array di oggetti letti con t(o.hint))
      'Chiara, crema e arancio come il gatto bianco e arancione', 'Scura, ardesia come il gatto grigio scuro', 'Segue la modalità del telefono'])
    const used = new Set(usedKeys())
    expect(Object.keys(EN).filter((k) => !used.has(k) && !dynamic.has(k))).toEqual([])
  })
  it('segnaposto e tag (<b>, <code>) coincidono con l\'originale', () => {
    const bad = Object.entries(EN).filter(([k, v]) => placeholders(k) !== placeholders(v) || tags(k) !== tags(v)).map(([k]) => k)
    expect(bad).toEqual([])
  })
  it('nessuna traduzione vuota e nessuna voce inutilizzata di tipo evidente', () => {
    expect(Object.entries(EN).filter(([, v]) => !v.trim())).toEqual([])
  })
  it('nessun testo JSX lasciato fuori da t(): il testo tra i tag deve passare dal dizionario', () => {
    const offenders: string[] = []
    for (const p of files('src').filter((f) => /\/(components|views)\/|App\.tsx$/.test(f) && f.endsWith('.tsx'))) {
      const code = readFileSync(p, 'utf8').split('\n')
      code.forEach((line, i) => {
        const l = line.replace(/=>/g, '').replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/`[^`]*`/g, '``').replace(/\{[^{}]*\}/g, '{}').replace(/\{[^{}]*\}/g, '{}')
        for (const m of l.matchAll(/(?:<\/?[A-Za-z][^<>]*>|\/>)([^<>{}\n]*[A-Za-zÀ-ÿ]{2,}[^<>{}\n]*)(?=<)/g)) {
          if (!/[?=&|]/.test(m[1]) && !/^\s*$/.test(m[1]) && !/^[\s.·,:;…()/«»"'–-]*$/.test(m[1]) && !/^\s*(Meal|Duo|JSON|ID|Google|Drive|Worker|Picker|Editor|VAPID|Client|API|README)[\s\w.]*$/.test(m[1])) offenders.push(`${p}:${i + 1}  «${m[1].trim()}»`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})

describe('t()', () => {
  it('in italiano restituisce il testo e riempie i segnaposto', () => {
    applyLang('it')
    expect(t('Piano di {name}', { name: 'Sara' })).toBe('Piano di Sara')
  })
  it('in inglese traduce, riempie i segnaposto e ripiega sull\'italiano se manca', () => {
    applyLang('en')
    expect(lang()).toBe('en')
    expect(t('Piano di {name}', { name: 'Sara' })).toBe("Sara's plan")
    expect(t('Testo non presente nel dizionario')).toBe('Testo non presente nel dizionario')
  })
  it('plurali e nomi dei giorni seguono la lingua', () => {
    applyLang('it'); expect(tp(1, '{n} alimento', '{n} alimenti', { n: 1 })).toBe('1 alimento'); expect(dayLong(0)).toBe('Lunedì'); expect(dayShort(6)).toBe('Dom')
    applyLang('en'); expect(tp(3, '{n} alimento', '{n} alimenti', { n: 3 })).toBe('3 foods'); expect(dayLong(0)).toBe('Monday'); expect(dayShort(6)).toBe('Sun'); expect(locale()).toBe('en-GB')
  })
  it('tb: grassetto e codice', () => {
    applyLang('en')
    const nodes = tb('Accedi con il <b>tuo account Google</b>. Se qualcuno ti ha invitato in una casa la ritrovo io; altrimenti puoi crearne una nuova. I dati restano nel tuo Drive.') as unknown[]
    expect(nodes.length).toBe(3)
  })
  it('parseLangPref', () => {
    expect(parseLangPref('en')).toBe('en'); expect(parseLangPref('fr')).toBe('auto'); expect(parseLangPref(null)).toBe('auto')
  })
})

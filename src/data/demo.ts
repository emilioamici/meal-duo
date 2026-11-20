/** Dati di esempio realistici per 2 membri (Emilio e Sara): la modalità demo funziona prima del login Google. */
import type { AppDatabase, DayPlan, FoodCatalogItem, Meal, WeeklyPlan } from '../types'
import { DAY_INDEXES } from '../types'
import { EPOCH, DEFAULT_MEALS } from '../services/dbOps'
import { guessCategory } from '../lib/foodMatch'

type Row = [name: string, quantity: number, unit: string]
/** pasto → righe; l'ordine segue DEFAULT_MEALS */
type DayRows = [Row[], Row[], Row[], Row[], Row[]]

let seq = 0
const rid = (p: string) => `${p}_demo${(++seq).toString(36)}`

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function build(): AppDatabase {
  const foodMap = new Map<string, FoodCatalogItem>()
  const food = (name: string, unit: string): string => {
    const id = `food_${slug(name)}`
    if (!foodMap.has(id)) foodMap.set(id, { id, name, unit, category: guessCategory(name), updatedAt: EPOCH })
    return id
  }
  const makeDay = (rows: DayRows): DayPlan => ({
    updatedAt: EPOCH,
    meals: rows.map((items, i): Meal => ({
      id: rid('meal'),
      name: DEFAULT_MEALS[i],
      items: items.map(([n, q, u]) => ({ id: rid('it'), foodId: food(n, u), quantity: q, unit: u })),
    })),
  })
  const plan = (memberId: string, week: DayRows[]): WeeklyPlan => ({ memberId, updatedAt: EPOCH, days: DAY_INDEXES.map((i) => makeDay(week[i])) })

  // k = fattore porzioni (Sara mangia leggermente meno di Emilio)
  const week = (k: number): DayRows[] => {
    const g = (n: number) => Math.round(n * k / 5) * 5
    const colazioneA: Row[] = [['Yogurt greco', g(170), 'g'], ['Fiocchi d\'avena', g(40), 'g'], ['Banana', 1, 'pz']]
    const colazioneB: Row[] = [['Latte parzialmente scremato', g(250), 'ml'], ['Fette biscottate', Math.round(4 * k), 'pz'], ['Marmellata', g(20), 'g']]
    const spuntinoA: Row[] = [['Mela', 1, 'pz'], ['Mandorle', g(15), 'g']]
    const spuntinoB: Row[] = [['Yogurt greco', g(125), 'g'], ['Noci', g(15), 'g']]
    const merenda: Row[] = [['Pane integrale', g(40), 'g'], ['Bresaola', g(40), 'g']]
    const merendaB: Row[] = [['Frutta di stagione', g(150), 'g'], ['Gallette di riso', Math.round(2 * k), 'pz']]
    const pranzoRiso: Row[] = [['Riso basmati', g(90), 'g'], ['Petto di pollo', g(150), 'g'], ['Zucchine', g(200), 'g'], ['Olio EVO', g(10), 'ml']]
    const pranzoPasta: Row[] = [['Pasta integrale', g(90), 'g'], ['Passata di pomodoro', g(100), 'g'], ['Parmigiano Reggiano', g(15), 'g'], ['Olio EVO', g(10), 'ml']]
    const pranzoFarro: Row[] = [['Farro', g(80), 'g'], ['Ceci', g(100), 'g'], ['Spinaci', g(150), 'g'], ['Olio EVO', g(10), 'ml']]
    const cenaPesce: Row[] = [['Salmone', g(150), 'g'], ['Patate', g(200), 'g'], ['Insalata mista', g(100), 'g'], ['Olio EVO', g(10), 'ml']]
    const cenaUova: Row[] = [['Uova', Math.round(2 * k), 'pz'], ['Pane integrale', g(60), 'g'], ['Broccoli', g(200), 'g'], ['Olio EVO', g(10), 'ml']]
    const cenaTacchino: Row[] = [['Fesa di tacchino', g(150), 'g'], ['Peperoni', g(200), 'g'], ['Riso basmati', g(60), 'g'], ['Olio EVO', g(10), 'ml']]
    const cenaMerluzzo: Row[] = [['Merluzzo', g(180), 'g'], ['Fagiolini', g(200), 'g'], ['Pane integrale', g(50), 'g'], ['Olio EVO', g(10), 'ml']]
    const cenaPizza: Row[] = [['Pizza margherita', 1, 'pz'], ['Insalata mista', g(100), 'g']]
    return [
      [colazioneA, spuntinoA, pranzoRiso, merenda, cenaPesce],
      [colazioneB, spuntinoB, pranzoPasta, merendaB, cenaUova],
      [colazioneA, spuntinoA, pranzoFarro, merenda, cenaTacchino],
      [colazioneB, spuntinoB, pranzoRiso, merendaB, cenaMerluzzo],
      [colazioneA, spuntinoA, pranzoPasta, merenda, cenaUova],
      [colazioneB, spuntinoA, pranzoFarro, merendaB, cenaPizza],
      [colazioneA, spuntinoB, pranzoRiso, merenda, cenaTacchino],
    ]
  }

  const emilio = { id: 'mem_emilio', name: 'Emilio', color: '#c9692a', email: '', updatedAt: EPOCH }
  const sara = { id: 'mem_sara', name: 'Sara', color: '#2a8f78', email: '', updatedAt: EPOCH }
  const plans = { [emilio.id]: plan(emilio.id, week(1.3)), [sara.id]: plan(sara.id, week(0.9)) }

  return {
    schema: 'meal-duo-db',
    version: 1,
    houseName: 'Casa Demo',
    members: [{ ...emilio, email: undefined }, { ...sara, email: undefined }],
    foodCatalog: [...foodMap.values()],
    plans,
    shopping: { checks: {}, extras: [{ id: 'x_demo_1', name: 'Carta forno', checked: false, updatedAt: EPOCH }], resetAt: EPOCH },
    lastUpdated: EPOCH,
  }
}

export const createDemoDb = (): AppDatabase => build()

/** Giorni della settimana: 0 = Lunedì … 6 = Domenica */
export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6
export const DAY_INDEXES: DayIndex[] = [0, 1, 2, 3, 4, 5, 6]
export const DAY_SHORT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'] as const
export const DAY_LONG = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'] as const

/** Ogni record unibile (merge last-write-wins) ha un `updatedAt` ISO e un eventuale `deleted` (tombstone). */
export interface Versioned {
  updatedAt: string
  deleted?: boolean
  /** id del membro che ha fatto l'ultima modifica (serve alle notifiche agli altri membri) */
  by?: string
}

export interface Member extends Versioned {
  id: string
  name: string
  /** colore HEX scelto dall'utente (vedi DESIGN_SYSTEM.md §1.6) */
  color: string
  email?: string
  /** primo accesso con l'account Google associato (finché manca, il membro risulta «Invitato») */
  joinedAt?: string
}

export type FoodCategory =
  | 'Frutta e verdura'
  | 'Carne e pesce'
  | 'Latticini e uova'
  | 'Pane, pasta e cereali'
  | 'Dispensa'
  | 'Surgelati e altro'

export interface FoodCatalogItem extends Versioned {
  id: string
  /** nome canonico mostrato ovunque */
  name: string
  /** unità di misura predefinita (es. g, ml, pz) */
  unit: string
  category: FoodCategory
  /** sinonimi che l'import / l'autocompletamento associano a questo alimento */
  aliases?: string[]
  /** varianti: altri alimenti del catalogo che lo sostituiscono con un fattore di conversione */
  variants?: FoodVariant[]
}

/** «`amount` di questo alimento = `variantAmount` dell'alimento `foodId`» (es. 100 g di pasta = 120 g di riso), ognuno nella propria unità del catalogo. */
export interface FoodVariant {
  foodId: string
  amount: number
  variantAmount: number
}

export interface MealItem {
  id: string
  foodId: string
  quantity: number
  unit: string
}

export interface Meal {
  id: string
  name: string
  items: MealItem[]
}

export interface DayPlan extends Versioned {
  meals: Meal[]
}

export interface WeeklyPlan extends Versioned {
  memberId: string
  /** sempre 7 elementi: Lunedì → Domenica */
  days: DayPlan[]
}

export interface ShoppingCheck extends Versioned {
  /** chiave riga: `${foodId}|${unitBase}` oppure `extra:${id}` */
  key: string
  checked: boolean
}

export interface ExtraItem extends Versioned {
  id: string
  name: string
  quantity?: string
  checked: boolean
}

export interface ShoppingCheckState {
  checks: Record<string, ShoppingCheck>
  extras: ExtraItem[]
  /** ISO: spunte precedenti a questa data vengono ignorate ("Nuova spesa") */
  resetAt: string
}

/** Acquisto in dispensa: nasce dalla spunta di una riga della spesa (chiave `${lineKey}|${resetAt}`), si annulla togliendo la spunta. */
export interface PantryPurchase extends Versioned {
  key: string
  foodId: string
  /** unità base (g, ml, pz …) */
  unit: string
  quantity: number
}

/** Correzione manuale della dispensa (quantità con segno). */
export interface PantryAdjustment extends Versioned {
  id: string
  foodId: string
  unit: string
  quantity: number
}

export interface ConsumedItem {
  foodId: string
  unit: string
  quantity: number
}

/** Pasto segnato come completato in una data precisa; conserva cosa è stato scalato dalla dispensa (per poterlo annullare). */
export interface MealLog extends Versioned {
  /** `${memberId}|${YYYY-MM-DD}|${mealId}` */
  key: string
  memberId: string
  date: string
  mealId: string
  done: boolean
  consumed: ConsumedItem[]
  /** alimenti che non erano (abbastanza) in dispensa */
  missing?: number
}

/**
 * La dispensa non è una quantità memorizzata ma un registro: giacenza = acquisti + correzioni − pasti completati.
 * Così due dispositivi che lavorano insieme non si sovrascrivono (ogni record ha chiave propria).
 */
export interface PantryState {
  purchases: Record<string, PantryPurchase>
  adjustments: Record<string, PantryAdjustment>
  meals: Record<string, MealLog>
}

export interface AppDatabase {
  schema: 'meal-duo-db'
  version: 1
  houseName: string
  members: Member[]
  foodCatalog: FoodCatalogItem[]
  plans: Record<string, WeeklyPlan>
  shopping: ShoppingCheckState
  pantry: PantryState
  lastUpdated: string
}

export interface ShoppingFilters {
  excludedMemberIds: string[]
  excludedDays: DayIndex[]
}

export interface ShoppingMemberShare {
  memberId: string
  quantity: number
}

export interface ShoppingLine {
  key: string
  foodId: string
  name: string
  category: FoodCategory
  /** unità base della riga (g, ml, pz o personalizzata) */
  unit: string
  total: number
  perMember: ShoppingMemberShare[]
  checked: boolean
}

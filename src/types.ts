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

export interface AppDatabase {
  schema: 'meal-duo-db'
  version: 1
  houseName: string
  members: Member[]
  foodCatalog: FoodCatalogItem[]
  plans: Record<string, WeeklyPlan>
  shopping: ShoppingCheckState
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

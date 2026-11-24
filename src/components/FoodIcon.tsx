import type { ComponentType } from 'react'
import { Apple, Bean, Cookie, Croissant, Fish, Milk, Salad, Snowflake, Soup, UtensilsCrossed, Wheat, Banana } from 'lucide-react'
import type { FoodCategory } from '../types'
import { normalizeName } from '../lib/foodMatch'

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

const CATEGORY: Record<FoodCategory, Icon> = {
  'Frutta e verdura': Apple,
  'Carne e pesce': Fish,
  'Latticini e uova': Milk,
  'Pane, pasta e cereali': Wheat,
  'Dispensa': Bean,
  'Surgelati e altro': Snowflake,
}

/** Icona della categoria di un alimento (frutta, pesce, latte…). */
export function CategoryIcon({ category, size = 16, className = '' }: { category: FoodCategory; size?: number; className?: string }) {
  const I = CATEGORY[category] ?? Apple
  return <I size={size} className={className} aria-hidden />
}

/** Icona di un pasto in base al nome (colazione → cornetto, pranzo → insalata, cena → zuppa…). */
export function mealIcon(name: string): Icon {
  const n = normalizeName(name)
  if (/colazion|breakfast/.test(n)) return Croissant
  if (/pranzo|lunch/.test(n)) return Salad
  if (/cena|dinner|supper/.test(n)) return Soup
  if (/merenda|snack|spuntino/.test(n)) return Cookie
  if (/workout|palestra|allenament/.test(n)) return Banana
  return UtensilsCrossed
}

export function MealIcon({ name, size = 16, className = '' }: { name: string; size?: number; className?: string }) {
  const I = mealIcon(name)
  return <I size={size} className={className} aria-hidden />
}

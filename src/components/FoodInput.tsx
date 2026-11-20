import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import type { FoodCatalogItem } from '../types'
import { normalizeName, searchFoods } from '../lib/foodMatch'
import { tb } from '../i18n/rich'
import { t } from '../i18n'

/**
 * Campo nome alimento con autocompletamento immediato sul catalogo condiviso
 * (case-insensitive, accenti, plurali e typo lievi). Selezionare un suggerimento condivide foodId e unità.
 */
export function FoodInput({ value, onChange, catalog, onPick, autoFocus }: {
  value: string
  onChange: (text: string) => void
  catalog: FoodCatalogItem[]
  onPick: (food: FoodCatalogItem) => void
  autoFocus?: boolean
}) {
  const [focused, setFocused] = useState(false)
  const suggestions = useMemo(() => searchFoods(catalog, value, 4), [catalog, value])
  const exact = suggestions.some((f) => normalizeName(f.name) === normalizeName(value))
  const showList = focused && value.trim().length > 0 && (suggestions.length > 0 || !exact)

  return (
    <div className="relative">
      <input
        className="field" value={value} autoFocus={autoFocus} placeholder={t('es. Petto di pollo')} autoComplete="off" autoCapitalize="sentences"
        onChange={(e) => onChange(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        aria-autocomplete="list" aria-label={t('Nome alimento')}
      />
      {showList && (
        <ul className="mt-2 overflow-hidden rounded-2xl border border-line bg-surface" role="listbox">
          {suggestions.map((f) => (
            <li key={f.id}>
              <button type="button" role="option" aria-selected={false}
                className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm active:bg-line/40"
                onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(f); setFocused(false) }}>
                <span className="font-semibold">{f.name}</span>
                <span className="shrink-0 text-xs text-muted">{f.unit} · {t(f.category)}</span>
              </button>
            </li>
          ))}
          {!exact && (
            <li className="flex items-center gap-2 border-t border-line/60 px-3.5 py-2.5 text-xs text-muted">
              <Plus size={14} className="text-brand" />
              <span>{tb('Nuovo alimento «<b>{name}</b>»: verrà aggiunto al catalogo condiviso', { name: value.trim() })}</span>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

import type { ReactNode } from 'react'

export type Mascot = 'zenitsu' | 'mochi' | 'pair' | 'mochi-rice' | 'mochi-milk' | 'zenitsu-fish' | 'zenitsu-pizza' | 'pair-table'
/** Stessi PNG di Clean Duo e MoneyDuo (public/cats). */
/** I tre PNG base sono quelli di Clean Duo e MoneyDuo, senza la fessura del salvadanaio (scripts/remove-coin-slot.py);
 * le versioni che mangiano le genera scripts/make-eating-mascots.py. */
const FILE: Record<Mascot, string> = {
  zenitsu: 'cats/zenitsu.png', mochi: 'cats/mochi.png', pair: 'cats/pair.png',
  'mochi-rice': 'cats/mochi-rice.png', 'mochi-milk': 'cats/mochi-milk.png', 'zenitsu-fish': 'cats/zenitsu-fish.png', 'zenitsu-pizza': 'cats/zenitsu-pizza.png', 'pair-table': 'cats/pair-table.png',
}

export function MascotImg({ kind, className = '' }: { kind: Mascot; className?: string }) {
  return <img src={import.meta.env.BASE_URL + FILE[kind]} alt="" draggable={false} decoding="async" className={`pointer-events-none select-none ${className}`} />
}

/** Il gattino fa capolino da dietro il bordo superiore di una scheda. `pair` = tutti e due, uno per lato. */
export function MascotPeek({ kind, side = 'right', children }: { kind: Mascot; side?: 'left' | 'right'; children: ReactNode }) {
  return (
    <div className="relative pt-11">
      {kind === 'pair' ? (
        <>
          <MascotImg kind="zenitsu" className="absolute left-6 top-0 h-16 w-auto" />
          <MascotImg kind="mochi" className="absolute right-6 top-0 h-16 w-auto" />
        </>
      ) : (
        <MascotImg kind={kind} className={`absolute top-0 h-16 w-auto ${side === 'left' ? 'left-6' : 'right-6'}`} />
      )}
      <div className="relative">{children}</div>
    </div>
  )
}

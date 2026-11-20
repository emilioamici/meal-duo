import { createContext, useContext } from 'react'

/**
 * Nodo di montaggio del FAB, FUORI dal contenitore animato (le pagine usano filter: blur → containing block, §2.2).
 * È nello stato di Shell (ref callback) così i consumatori si ri-renderizzano appena il nodo esiste.
 * I fogli (Sheet) non lo usano più: vanno in un portal su document.body, come in MoneyDuo.
 */
export interface OverlayHosts { overlay: HTMLElement | null }
export const OverlayCtx = createContext<OverlayHosts>({ overlay: null })
export const useOverlay = (): OverlayHosts => useContext(OverlayCtx)

import { createContext, useContext } from 'react'

/**
 * Nodi di montaggio FUORI dal contenitore animato (le pagine usano filter: blur → containing block, §2.2):
 *  - overlay: strato del FAB (#shell-overlay)
 *  - sheets: fogli e scrim
 * Sono nello stato di Shell (ref callback) così i consumatori si ri-renderizzano appena i nodi esistono.
 */
export interface OverlayHosts { overlay: HTMLElement | null; sheets: HTMLElement | null }
export const OverlayCtx = createContext<OverlayHosts>({ overlay: null, sheets: null })
export const useOverlay = (): OverlayHosts => useContext(OverlayCtx)

import type { ReactNode } from 'react'
import { t } from './index'

/** Come `t` ma il testo può contenere <b>…</b> (grassetto) e <code>…</code>. */
export function tb(it: string, params?: Record<string, string | number>): ReactNode {
  const parts = t(it, params).split(/(<b>.*?<\/b>|<code>.*?<\/code>)/g)
  return parts.map((p, i) => (p.startsWith('<b>') ? <b key={i} className="font-bold text-ink">{p.slice(3, -4)}</b> : p.startsWith('<code>') ? <code key={i}>{p.slice(6, -7)}</code> : p))
}

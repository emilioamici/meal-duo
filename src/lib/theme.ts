export type Theme = 'auto' | 'light' | 'dark'
export const THEME_COLOR = { light: '#fff7ee', dark: '#16181d' } // = --bg dei due temi
const KEY = 'mealduo:theme'

export function applyTheme(t: Theme): void {
  const root = document.documentElement
  if (t === 'auto') delete root.dataset.theme
  else root.dataset.theme = t
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const mode = (m.media || '').includes('dark') ? 'dark' : 'light'
    m.content = t === 'auto' ? THEME_COLOR[mode] : THEME_COLOR[t]
  })
}

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : 'auto'
  } catch { return 'auto' }
}

export function setTheme(t: Theme): void {
  try { if (t === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t) } catch { /* ignore */ }
  applyTheme(t)
}

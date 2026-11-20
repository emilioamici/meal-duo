/** Interpola i segnaposto `{nome}`: l'app è solo in italiano, quindi niente catalogo di traduzioni. */
export function t(text: string, vars?: Record<string, string | number>): string {
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text
}

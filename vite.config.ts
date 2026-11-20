import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Base path dinamico per GitHub Pages:
 *  1. VITE_BASE (se impostato esplicitamente, es. "/" per un dominio custom)
 *  2. in GitHub Actions: "/<nome-repo>/" ricavato da GITHUB_REPOSITORY
 *  3. altrimenti "/" (sviluppo locale)
 */
function resolveBase(): string {
  const explicit = process.env.VITE_BASE
  if (explicit) return explicit.endsWith('/') ? explicit : `${explicit}/`
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]
  if (process.env.GITHUB_ACTIONS && repo && !repo.endsWith('.github.io')) return `/${repo}/`
  return '/'
}

const base = resolveBase()
// Colore del tema chiaro (Mochi) = --bg, vedi DESIGN_SYSTEM.md §1.2
const THEME_BG = '#fff7ee'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'cats/*.svg', 'cats/*.png'],
      manifest: {
        name: 'Meal Duo',
        short_name: 'Meal Duo',
        description: 'Piani alimentari settimanali condivisi e lista della spesa di famiglia',
        lang: 'it',
        start_url: base,
        scope: base,
        id: base,
        display: 'standalone',
        orientation: 'portrait',
        theme_color: THEME_BG,
        background_color: THEME_BG,
        // Per sostituire l'icona: vedi README → "Icona dell'app" (npm run icons)
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: `${base}index.html`,
        // Le API Google non vanno mai messe in cache dal service worker
        navigateFallbackDenylist: [/^\/api\//, /privacy\.html$/],
        cleanupOutdatedCaches: true,
        // gestori delle notifiche push (public/push-sw.js), caricati dal service worker generato
        importScripts: ['push-sw.js'],
      },
    }),
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts', 'worker/src/**/*.test.ts'] },
})

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App'
import { applyTheme, getTheme } from './lib/theme'
import { initCache } from './state/cache'
import { consumeSessionFromUrl } from './sync/auth'

applyTheme(getTheme())

// ritorno dal login con il Worker: salva la sessione, ripulisce l'indirizzo e riapre da solo il flusso di collegamento
if (consumeSessionFromUrl()) { try { sessionStorage.setItem('mealduo:resume-connect', '1') } catch { /* noop */ } }

registerSW({ immediate: true })

// la copia locale (IndexedDB) si legge prima di mostrare l'app, così parte subito con i dati
void initCache().finally(() => createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>))

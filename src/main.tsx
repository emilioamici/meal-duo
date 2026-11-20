import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App'
import { applyTheme, getTheme } from './lib/theme'
import { initCache } from './state/cache'
import { consumeSessionFromUrl } from './sync/auth'
import { consumeInviteFromUrl } from './sync/invite'

applyTheme(getTheme())

// ritorno dal login con il Worker: salva la sessione, ripulisce l'indirizzo e riapre da solo il flusso di collegamento
if (consumeSessionFromUrl()) { try { sessionStorage.setItem('mealduo:resume-connect', '1') } catch { /* noop */ } }

consumeInviteFromUrl() // link d'invito (#join=<ID famiglia>): si ricorda e sopravvive al giro su Google

registerSW({ immediate: true })

// la copia locale (IndexedDB) si legge prima di mostrare l'app, così parte subito con i dati
void initCache().finally(() => createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>))

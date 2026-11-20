/**
 * Modalità "senza account": l'utente ha scelto di provare l'app con i dati demo / solo su questo dispositivo.
 * Senza questo flag e senza un database collegato si vede il Gate (accesso con Google), come in MoneyDuo.
 */
const KEY = 'mealduo:local'
export const isLocalMode = (): boolean => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }
export const setLocalMode = (on: boolean): void => { try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY) } catch { /* noop */ } }

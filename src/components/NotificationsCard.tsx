import { useState } from 'react'
import { Toggle } from './ui'
import { useStore } from '../state/store'
import { engine } from '../sync/engine'
import { disablePush, enablePush, pushConfigured, pushSupported, sendPush } from '../sync/push'
import { t } from '../i18n'

/**
 * Notifiche di questo dispositivo: un solo interruttore che le accende tutte
 * (notifiche del dispositivo e, se il Worker è configurato, push anche con l'app chiusa). La campanella nell'app c'è sempre.
 */
export function NotificationsCard() {
  const { prefs, setPrefs, sync, me } = useStore()
  const supported = typeof Notification !== 'undefined'
  const [perm, setPerm] = useState<NotificationPermission>(supported ? Notification.permission : 'denied')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const on = (prefs.systemNotif || prefs.pushEnabled) && perm === 'granted'
  const server = pushConfigured() && pushSupported()

  const needToken = (): string => {
    const tok = engine.currentToken()
    if (!tok) throw new Error(t('Sessione Google scaduta: riconnettiti e riprova.'))
    return tok
  }
  const err = (e: unknown) => (e instanceof Error ? e.message : String(e))

  /** Iscrive il dispositivo al Worker (se c'è). Non lancia: ritorna l'errore da mostrare. */
  const startPush = async (): Promise<string | null> => {
    if (!server) return null
    try {
      if (!sync.fileId) throw new Error(t('Nessuna casa collegata.'))
      await enablePush(sync.fileId, needToken())
      setPrefs({ pushEnabled: true })
      return null
    } catch (e) { return err(e) }
  }

  const turnOn = async () => {
    setMsg(null); setBusy(true)
    try {
      const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
      setPerm(p)
      if (p !== 'granted') return setMsg({ text: t('Il permesso per le notifiche è stato negato: abilitalo dalle impostazioni del browser o del telefono per questo sito.'), bad: true })
      setPrefs({ systemNotif: true })
      const e = await startPush()
      setMsg(e ? { text: t('Notifiche attivate, ma il server delle notifiche non risponde ({e}). Le riceverai finché l\'app è aperta o in background; puoi riprovare dal pulsante qui sotto.', { e }), bad: true } : { text: t('Notifiche attivate su questo dispositivo.') })
    } finally { setBusy(false) }
  }

  const turnOff = async () => {
    setMsg(null); setBusy(true)
    try {
      if (sync.fileId && prefs.pushEnabled && pushConfigured()) await disablePush(sync.fileId, engine.currentToken()).catch(() => undefined)
      setPrefs({ systemNotif: false, pushEnabled: false })
    } finally { setBusy(false) }
  }

  const retry = async () => {
    setMsg(null); setBusy(true)
    const e = await startPush()
    setMsg(e ? { text: e, bad: true } : { text: t('Notifiche attive anche con l\'app chiusa.') })
    setBusy(false)
  }

  const test = async () => {
    setMsg(null); setBusy(true)
    try {
      if (prefs.pushEnabled && server && sync.fileId && me?.email) {
        await sendPush(sync.fileId, needToken(), { recipients: [me.email], title: t('Notifica di prova'), body: t('Le notifiche di Meal Duo funzionano.'), tag: 'mealduo-push-test', test: true })
        setMsg({ text: t('Prova inviata dal server: dovrebbe arrivare tra pochi secondi (con l\'app in background).') })
      } else {
        const opts: NotificationOptions = { body: t('Le notifiche di Meal Duo funzionano su questo dispositivo.'), icon: './icons/pwa-192.png', tag: 'mealduo-test' }
        const reg = await navigator.serviceWorker?.getRegistration()
        if (reg) await reg.showNotification(t('Notifica di prova'), opts)
        else new Notification(t('Notifica di prova'), opts)
      }
    } catch (e) { setMsg({ text: err(e), bad: true }) } finally { setBusy(false) }
  }

  return (
    <div>
      <p className="mb-3 text-xs text-muted">{t('Nell\'app trovi sempre la campanella: ti avviso quando un altro membro aggiunge una voce alla spesa, spunta un articolo o modifica il tuo piano. Attivando le notifiche le ricevi anche come avviso del telefono.')}</p>
      {!supported ? (
        <p className="rounded-xl bg-bg p-3 text-sm text-muted">{t('Questo browser non supporta le notifiche di sistema. Su iPhone servono iOS 16.4+ e l\'app aggiunta alla schermata Home.')}</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-bg/60 p-3">
            <span className="min-w-0"><span className="block font-semibold">{t('Attiva notifiche')}</span><span className="block text-xs text-muted">{server ? t('Anche con l\'app chiusa') : t('Quando l\'app è aperta o in background')}</span></span>
            <Toggle checked={on} onChange={(v) => void (v ? turnOn() : turnOff())} label={t('Attiva notifiche')} />
          </div>
          {on && <button className="glass-btn mt-3 w-full" disabled={busy} onClick={() => void test()}>{t('Invia una notifica di prova')}</button>}
          {on && server && !prefs.pushEnabled && <button className="glass-btn mt-2 w-full" disabled={busy} onClick={() => void retry()}>{t('Riprova ad attivarle anche con l\'app chiusa')}</button>}
          {msg && <p className={`mt-2 text-sm ${msg.bad ? 'text-exp' : 'text-muted'}`}>{msg.text}</p>}
        </>
      )}
      <p className="mt-3 text-xs text-muted">
        {server ? t('Con l\'app chiusa le notifiche arrivano dal Worker.') : t('Senza il Worker il sito non può svegliare il telefono: le notifiche arrivano mentre l\'app è aperta o in background (si controlla ogni 2 minuti) e quelle perse le trovi alla riapertura.')}
        {' '}{sync.persistent ? t('L\'accesso persistente tiene attiva la sessione Google anche in background.') : t('La sessione Google dura 1 ora: con l\'accesso persistente (scheda Google Drive) non serve rinnovarla.')}
      </p>
    </div>
  )
}

import { MascotImg } from './Mascots'
import { ConnectFlow } from './ConnectSheet'
import { t } from '../i18n'

/**
 * Schermata iniziale (come in MoneyDuo): accesso con Google, poi la casa viene trovata e collegata in automatico (o se ne crea una).
 * `reconnect`: sessione scaduta con una casa già collegata, la schermata copre l'app finché non si rientra.
 */
export function Gate({ reconnect = false, onLocal }: { reconnect?: boolean; onLocal?: () => void }) {
  return (
    <>
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10 pt-safe">
        <div className="mb-8 text-center">
          <MascotImg kind="pair" className="mx-auto mb-3 w-44" />
          <h1 className="text-3xl font-extrabold tracking-tight">Meal <span className="text-brand">Duo</span></h1>
          <p className="mt-2 text-sm text-muted">{t('Piani alimentari e spesa di famiglia, nel tuo Google Drive.')}</p>
        </div>
        <div className="glass-strong space-y-4 p-5">
          <ConnectFlow active reconnect={reconnect} allowLocal={!reconnect} onClose={onLocal ?? (() => undefined)} />
        </div>
        <p className="mt-6 text-center text-xs text-muted">{t('I dati restano nel Drive del proprietario e in questo browser: nessun server di terze parti per i dati.')}{' '}<a className="font-semibold text-brand" href={import.meta.env.BASE_URL + 'privacy.html'}>{t('Informativa sulla privacy')}</a></p>
      </div>
    </>
  )
}

import { useState } from 'react'
import { Check } from 'lucide-react'
import { THEME_NAME, getTheme, setTheme, type Theme } from '../lib/theme'
import { MascotImg } from './Mascots'
import { LANG_NAME, getLangPref, setLangPref, t, useLang, type LangPref } from '../i18n'

const OPTIONS: Array<{ id: Theme; hint: string }> = [
  { id: 'light', hint: 'Chiara, crema e arancio come il gatto bianco e arancione' },
  { id: 'dark', hint: 'Scura, ardesia come il gatto grigio scuro' },
  { id: 'auto', hint: 'Segue la modalità del telefono' },
]

/** Scelta del tema (Mochi chiaro, Zenitsu scuro, automatico) e della lingua: stessa scheda di Clean Duo. */
export function AppearanceCard() {
  useLang()
  const [theme, setT] = useState<Theme>(getTheme)
  const [langPref, setLang] = useState<LangPref>(getLangPref)
  return (
    <>
      <div role="radiogroup" aria-label={t('Tema dell\'app')} className="space-y-2">
        {OPTIONS.map((o) => {
          const on = theme === o.id
          return (
            <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => { setT(o.id); setTheme(o.id) }}
              className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition active:scale-[0.98] ${on ? 'border-brand bg-brand/10' : 'border-line active:bg-line/30'}`}>
              {/* riquadri di anteprima: eccezione hex ammessa dal Design System (§0.2) */}
              <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl" style={{ background: o.id === 'dark' ? '#16181d' : o.id === 'light' ? '#fff7ee' : 'linear-gradient(135deg,#fff7ee 50%,#16181d 50%)' }}>
                {o.id === 'auto' ? <MascotImg kind="pair" className="h-10 w-auto" /> : <MascotImg kind={o.id === 'dark' ? 'zenitsu' : 'mochi'} className="h-12 w-auto" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t(THEME_NAME[o.id])}</span>
                <span className="block text-xs text-muted">{t(o.hint)}</span>
              </span>
              {on && <Check size={20} className="shrink-0 text-brand" />}
            </button>
          )
        })}
      </div>
      <p className="label">{t('Lingua')}</p>
      <div role="radiogroup" aria-label={t('Lingua')} className="flex gap-2">
        {(['auto', 'it', 'en'] as LangPref[]).map((id) => (
          <button key={id} type="button" role="radio" aria-checked={langPref === id} onClick={() => { setLangPref(id); setLang(id) }}
            className={`chip flex-1 justify-center ${langPref === id ? 'chip-active' : ''}`}>{id === 'auto' ? t('Automatico') : LANG_NAME[id]}</button>
        ))}
      </div>
    </>
  )
}

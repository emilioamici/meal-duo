import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileUp } from 'lucide-react'
import { Avatar, Sheet } from './ui'
import { useStore } from '../state/store'
import { useUi } from '../state/ui'
import { applyImport, parsePlanJson, planTemplate } from '../services/planIO'
import { downloadJson, readFileText } from '../lib/files'
import { tb } from '../i18n/rich'
import { t, tp } from '../i18n'

/** Foglio di importazione del piano (JSON): scelta del membro, file o testo, validazione, anteprima. Include i tracciati da scaricare. */
export function ImportSheet({ open, onClose, initialMemberId }: { open: boolean; onClose: () => void; initialMemberId: string }) {
  const { db, members, commit } = useStore()
  const { showToast } = useUi()
  const [text, setText] = useState('')
  const [memberId, setMemberId] = useState(initialMemberId)
  const file = useRef<HTMLInputElement>(null)
  // il foglio resta montato: a ogni apertura riparte dal membro attualmente selezionato
  useEffect(() => { if (open) setMemberId(initialMemberId) }, [open, initialMemberId])

  const target = members.find((m) => m.id === memberId) ?? members[0]
  const parsed = useMemo(() => (text.trim() ? parsePlanJson(text) : null), [text])
  const preview = useMemo(() => (parsed?.ok && parsed.plan && target ? applyImport(db, target.id, parsed.plan) : null), [parsed, db, target])

  const reset = () => { setText(''); if (file.current) file.current.value = '' }
  const close = () => { reset(); onClose() }
  const doImport = () => {
    if (!parsed?.plan || !target) return
    commit((d) => applyImport(d, target.id, parsed.plan!).db)
    showToast(t('Piano di {name} importato', { name: target.name }))
    close()
  }

  return (
    <Sheet open={open} onClose={close} title={t('Importa piano JSON')}
      footer={<button className="glass-btn btn-primary w-full !py-3.5" disabled={!parsed?.ok} onClick={doImport}>{t('Importa piano di {name}', { name: target?.name ?? '' })}</button>}>
      <label className="label !mt-2">{t('Importa per')}</label>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {members.map((m) => (
          <button key={m.id} type="button" className={`chip !pl-1.5 ${target?.id === m.id ? 'chip-active' : ''}`} onClick={() => setMemberId(m.id)}><Avatar member={m} size={22} />{m.name}</button>
        ))}
      </div>

      <div className="mt-3 rounded-2xl border border-line bg-bg/60 p-3">
        <p className="text-sm font-semibold">{t('Non sai da dove partire?')}</p>
        <p className="mt-0.5 text-xs text-muted">{t('Scarica il tracciato di esempio, compilalo (anche con un assistente AI) e poi caricalo qui sotto.')}</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button className="glass-btn btn-primary !px-2 !text-xs" onClick={() => { downloadJson('meal-duo-esempio.json', planTemplate('example')); showToast(t('Tracciato di esempio scaricato')) }}><Download size={15} />{t('Tracciato di esempio')}</button>
          <button className="glass-btn !px-2 !text-xs" onClick={() => { downloadJson('meal-duo-tracciato-vuoto.json', planTemplate('empty')); showToast(t('Tracciato vuoto scaricato')) }}><Download size={15} />{t('Tracciato vuoto')}</button>
        </div>
      </div>

      <label className="label">{t('File o testo JSON')}</label>
      <input ref={file} type="file" accept="application/json,.json" className="hidden" aria-label={t('Carica file JSON')}
        onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await readFileText(f)) }} />
      <button className="glass-btn mb-2 w-full" onClick={() => file.current?.click()}><FileUp size={16} />{t('Scegli file .json')}</button>
      <textarea className="field min-h-32 font-mono !text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('{"format":"meal-duo-plan","days":[…]}')} spellCheck={false} aria-label={t('JSON del piano')} />

      {parsed && !parsed.ok && (
        <div className="mt-3 rounded-xl bg-exp/15 p-3 text-xs text-ink" role="alert">
          <p className="font-bold text-exp">{tp(parsed.errors.length, '{n} errore nel file', '{n} errori nel file', { n: parsed.errors.length })}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{parsed.errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul>
          {parsed.errors.length > 8 && <p className="mt-1 text-muted">{t('…e altri {n}', { n: parsed.errors.length - 8 })}</p>}
        </div>
      )}
      {parsed?.ok && preview && (
        <div className="mt-3 space-y-2 rounded-2xl border border-line bg-bg/60 p-3 text-sm">
          <p className="font-bold">{tp(preview.report.items, 'Anteprima: {n} alimento', 'Anteprima: {n} alimenti', { n: preview.report.items })}</p>
          {preview.report.matched.length > 0 && (
            <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">{t('Associati al catalogo')}</p>
              <ul className="mt-1 space-y-0.5 text-xs">{preview.report.matched.slice(0, 8).map((m) => <li key={m.from}>«{m.from}» → <span className="font-semibold">{m.to}</span></li>)}</ul></div>
          )}
          {preview.report.created.length > 0 && (
            <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">{t('Nuovi nel catalogo ({n})', { n: preview.report.created.length })}</p>
              <p className="mt-1 text-xs">{preview.report.created.slice(0, 12).join(', ')}{preview.report.created.length > 12 ? '…' : ''}</p></div>
          )}
          {parsed.warnings.map((w) => <p key={w} className="text-xs text-muted">⚠ {w}</p>)}
          <p className="text-xs text-muted">{tb('Il piano attuale di {name} verrà <b>sostituito</b>.', { name: target?.name ?? '' })}</p>
        </div>
      )}
    </Sheet>
  )
}

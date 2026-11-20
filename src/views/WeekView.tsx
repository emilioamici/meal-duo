import { useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronRight, Copy, Download, FileJson, FileUp, Upload } from 'lucide-react'
import { PageHeader, Sheet } from '../components/ui'
import { HeaderActions } from '../components/Chrome'
import { MascotPeek } from '../components/Mascots'
import { MemberPills } from '../components/MemberPills'
import { CopyDaySheet } from '../components/Sheets'
import { Avatar } from '../components/ui'
import { useStore } from '../state/store'
import { useUi } from '../state/ui'
import { useActiveMember } from '../state/hooks'
import { DAY_INDEXES, DAY_LONG, type DayIndex } from '../types'
import { dayTotals } from '../services/shoppingListEngine'
import { applyImport, exportPlan, parsePlanJson, planTemplate } from '../services/planIO'
import { downloadJson, copyText, readFileText } from '../lib/files'
import { formatQuantity } from '../lib/units'
import { todayIndex } from '../lib/ids'

export function WeekView() {
  const { db, members } = useStore()
  const { setDay, setTab, setMemberId, showToast } = useUi()
  const member = useActiveMember()
  const plan = db.plans[member.id]
  const today = todayIndex()
  const [copyFrom, setCopyFrom] = useState<DayIndex | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const fileName = `meal-duo-${member.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`

  return (
    <>
      <PageHeader title="Settimana" subtitle={`Piano di ${member.name}`} right={<HeaderActions />} />
      <MemberPills members={members} value={member.id} onChange={setMemberId} />

      <div className="mt-2">
        <MascotPeek kind="zenitsu" side="left">
          <div className="card divide-y divide-line/60 overflow-hidden">
            {DAY_INDEXES.map((d, i) => {
              const day = plan?.days[d]
              const t = dayTotals(day)
              const meals = (day?.meals ?? []).filter((m) => m.items.length > 0).length
              return (
                <motion.div key={d} className="flex items-center gap-1 pr-2" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  <button className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left active:bg-line/30" onClick={() => { setDay(d); setTab('today') }}>
                    <span className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-2xl text-xs font-bold ${d === today ? 'bg-brand text-onbrand' : 'bg-line/60 text-ink'}`}>
                      {DAY_LONG[d].slice(0, 3).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold leading-tight">{DAY_LONG[d]}{d === today && <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-ink">oggi</span>}</span>
                      <span className="block truncate text-xs text-muted">
                        {t.foods === 0 ? 'Giorno vuoto' : `${meals} pasti · ${t.foods} alimenti${t.grams ? ` · ${formatQuantity(t.grams, 'g')}` : ''}`}
                      </span>
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-muted" />
                  </button>
                  <button className="glass-btn !h-10 !w-10 shrink-0 !p-0" aria-label={`Copia ${DAY_LONG[d]} su altri giorni`} onClick={() => setCopyFrom(d)}><Copy size={16} /></button>
                </motion.div>
              )
            })}
          </div>
        </MascotPeek>
      </div>

      <section className="card mt-3 p-4">
        <div className="flex items-center gap-2"><FileJson size={20} className="text-brand" /><h2 className="font-bold">Piano in JSON</h2></div>
        <p className="mt-1 text-sm text-muted">Esporta il piano di {member.name} o un tracciato da compilare altrove (anche con un assistente AI), poi reimportalo: i nomi vengono associati al catalogo della casa.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className="glass-btn" onClick={() => { downloadJson(fileName, exportPlan(db, member.id)); showToast('Piano esportato') }}><Download size={16} />Esporta piano</button>
          <button className="glass-btn btn-primary" onClick={() => setImportOpen(true)}><Upload size={16} />Importa piano</button>
          <button className="glass-btn" onClick={() => downloadJson('meal-duo-tracciato-vuoto.json', planTemplate('empty'))}><FileUp size={16} />Tracciato vuoto</button>
          <button className="glass-btn" onClick={() => downloadJson('meal-duo-esempio.json', planTemplate('example'))}><FileUp size={16} />Esempio</button>
        </div>
        <button className="mt-3 text-sm font-semibold text-brand" onClick={async () => showToast((await copyText(JSON.stringify(exportPlan(db, member.id), null, 2))) ? 'JSON copiato negli appunti' : 'Copia non riuscita')}>Copia il JSON negli appunti</button>
      </section>

      {copyFrom !== null && <CopyDaySheet open onClose={() => setCopyFrom(null)} memberId={member.id} from={copyFrom} />}
      <ImportSheet open={importOpen} onClose={() => setImportOpen(false)} initialMemberId={member.id} />
    </>
  )
}

/* ---------------- Foglio di importazione ---------------- */
function ImportSheet({ open, onClose, initialMemberId }: { open: boolean; onClose: () => void; initialMemberId: string }) {
  const { db, members, commit } = useStore()
  const { showToast } = useUi()
  const [text, setText] = useState('')
  const [memberId, setMemberId] = useState(initialMemberId)
  const file = useRef<HTMLInputElement>(null)

  const target = members.find((m) => m.id === memberId) ?? members[0]
  const parsed = useMemo(() => (text.trim() ? parsePlanJson(text) : null), [text])
  const preview = useMemo(() => (parsed?.ok && parsed.plan && target ? applyImport(db, target.id, parsed.plan) : null), [parsed, db, target])

  const reset = () => { setText(''); if (file.current) file.current.value = '' }
  const close = () => { reset(); onClose() }
  const doImport = () => {
    if (!parsed?.plan || !target) return
    commit((d) => applyImport(d, target.id, parsed.plan!).db)
    showToast(`Piano di ${target.name} importato`)
    close()
  }

  return (
    <Sheet open={open} onClose={close} title="Importa piano JSON">
      <label className="label !mt-2">Importa per</label>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {members.map((m) => (
          <button key={m.id} type="button" className={`chip !pl-1.5 ${target?.id === m.id ? 'chip-active' : ''}`} onClick={() => setMemberId(m.id)}><Avatar member={m} size={22} />{m.name}</button>
        ))}
      </div>

      <label className="label">File o testo JSON</label>
      <input ref={file} type="file" accept="application/json,.json" className="hidden" aria-label="Carica file JSON"
        onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await readFileText(f)) }} />
      <button className="glass-btn mb-2 w-full" onClick={() => file.current?.click()}><FileUp size={16} />Scegli file .json</button>
      <textarea className="field min-h-32 font-mono !text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder='{"format":"meal-duo-plan","days":[…]}' spellCheck={false} aria-label="JSON del piano" />

      {parsed && !parsed.ok && (
        <div className="mt-3 rounded-xl bg-exp/15 p-3 text-xs text-ink" role="alert">
          <p className="font-bold text-exp">{parsed.errors.length} {parsed.errors.length === 1 ? 'errore' : 'errori'} nel file</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{parsed.errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul>
          {parsed.errors.length > 8 && <p className="mt-1 text-muted">…e altri {parsed.errors.length - 8}</p>}
        </div>
      )}
      {parsed?.ok && preview && (
        <div className="mt-3 space-y-2 rounded-2xl border border-line bg-bg/60 p-3 text-sm">
          <p className="font-bold">Anteprima: {preview.report.items} alimenti</p>
          {preview.report.matched.length > 0 && (
            <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">Associati al catalogo</p>
              <ul className="mt-1 space-y-0.5 text-xs">{preview.report.matched.slice(0, 8).map((m) => <li key={m.from}>«{m.from}» → <span className="font-semibold">{m.to}</span></li>)}</ul></div>
          )}
          {preview.report.created.length > 0 && (
            <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">Nuovi nel catalogo ({preview.report.created.length})</p>
              <p className="mt-1 text-xs">{preview.report.created.slice(0, 12).join(', ')}{preview.report.created.length > 12 ? '…' : ''}</p></div>
          )}
          {parsed.warnings.map((w) => <p key={w} className="text-xs text-muted">⚠ {w}</p>)}
          <p className="text-xs text-muted">Il piano attuale di {target?.name} verrà <span className="font-semibold text-ink">sostituito</span>.</p>
        </div>
      )}
      <button className="glass-btn btn-primary mt-4 w-full !py-3.5" disabled={!parsed?.ok} onClick={doImport}>Importa piano di {target?.name}</button>
    </Sheet>
  )
}

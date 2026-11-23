import { useMemo, useRef, useState } from 'react'
import { Bell, ChevronDown, Cloud, Database, FileJson, Palette, Plus, Search, ShieldCheck, Trash2, Users, Utensils } from 'lucide-react'
import { Accordion, ConfirmButton, PageHeader, Sheet } from '../components/ui'
import { HeaderActions } from '../components/Chrome'
import { MascotPeek } from '../components/Mascots'
import { useStore } from '../state/store'
import { useUi } from '../state/ui'
import type { FoodCatalogItem } from '../types'
import { deleteFood, foodUsage, keepBoth, liveFoods, mergeFoods, removeVariant, setVariant, updateFood } from '../services/dbOps'
import { variantsOf } from '../services/variants'
import { FoodInput } from '../components/FoodInput'
import { toBase } from '../lib/units'
import { parseDb } from '../services/dbSchema'
import { findDuplicatePairs, FOOD_CATEGORIES, normalizeName, searchFoods } from '../lib/foodMatch'
import { COMMON_UNITS } from '../lib/units'
import { downloadJson, readFileText } from '../lib/files'
import { THEME_NAME, getTheme } from '../lib/theme'
import { FamilyCard } from '../components/FamilyCard'
import { AppearanceCard } from '../components/AppearanceCard'
import { MemberPills } from '../components/MemberPills'
import { PlanJsonCard } from '../components/PlanJsonCard'
import { useActiveMember } from '../state/hooks'
import { LANG_NAME, getLangPref, useLang } from '../i18n'
import { SyncCard } from '../components/SyncCard'
import { NotificationsCard } from '../components/NotificationsCard'
import { t, tp } from '../i18n'

/** Impostazioni: stessa struttura di MoneyDuo e Clean Duo (Aspetto sotto i gattini, Famiglia, Sincronizzazione e account, Notifiche, …). */
export function SettingsView() {
  useLang()
  const [, refresh] = useState(0) // il riepilogo di Aspetto legge tema e lingua dal dispositivo: si ridisegna a ogni cambio
  const { db, members, sync, prefs } = useStore()
  const { setMemberId } = useUi()
  const member = useActiveMember()
  const foods = liveFoods(db)
  const lp = getLangPref()
  const themeLabel = t(THEME_NAME[getTheme()])
  const syncSummary = `${t(SYNC_LABEL[sync.status])}${sync.email ? ` · ${sync.email}` : ''}`
  return (
    <>
      <PageHeader title={t('Impostazioni')} subtitle={t('Famiglia, sincronizzazione e dati')} right={<HeaderActions />} />
      <div className="space-y-3">
        <MascotPeek kind="pair">
          <Accordion id="look" title={t('Aspetto')} icon={<Palette size={20} />} summary={`${themeLabel} · ${lp === 'auto' ? t('Automatico') : LANG_NAME[lp]}`}>
            <AppearanceCard onChange={() => refresh((n) => n + 1)} />
          </Accordion>
        </MascotPeek>

        <Accordion id="family" title={t('Famiglia')} icon={<Users size={20} />} summary={`${db.houseName} · ${tp(members.length, '{n} membro', '{n} membri', { n: members.length })}`}>
          <FamilyCard />
        </Accordion>

        <Accordion id="sync" title={t('Sincronizzazione e account')} icon={<Cloud size={20} />} summary={syncSummary}>
          <SyncCard />
        </Accordion>

        <Accordion id="notif" title={t('Notifiche')} icon={<Bell size={20} />} summary={prefs.systemNotif || prefs.pushEnabled ? t('Attive su questo dispositivo') : t('Disattivate (solo la campanella)')}>
          <NotificationsCard />
        </Accordion>

        <Accordion id="catalog" title={t('Catalogo alimenti')} icon={<Utensils size={20} />} summary={t('{n} alimenti condivisi', { n: foods.length })}>
          <CatalogSection />
        </Accordion>

        <Accordion id="plan" title={t('Piano alimentare (JSON)')} icon={<FileJson size={20} />} summary={t('Importa ed esporta il piano settimanale')}>
          <MemberPills members={members} value={member.id} onChange={setMemberId} />
          <PlanJsonCard bare />
        </Accordion>

        <Accordion id="data" title={t('Backup e dati')} icon={<Database size={20} />} summary={t('{a} alimenti · {b} membri', { a: foods.length, b: members.length })}>
          <DataSection />
        </Accordion>

        <p className="flex gap-2 px-1 pb-4 text-xs text-muted"><ShieldCheck size={16} className="shrink-0" /><span>{t('I dati restano nel tuo Google Drive e su questo dispositivo. Il server della famiglia (il tuo Cloudflare Worker) li fa solo transitare per gli invitati e non li conserva.')} · Meal Duo · <a className="font-semibold text-brand" href={import.meta.env.BASE_URL + 'privacy.html'}>{t('Informativa sulla privacy')}</a></span></p>
      </div>
    </>
  )
}

const SYNC_LABEL: Record<string, string> = { off: 'Non collegato', auth: 'Riconnessione necessaria', pending: 'Da sincronizzare', syncing: 'Sincronizzazione…', synced: 'Sincronizzato', offline: 'Offline', error: 'Errore' }

/* =============== Catalogo alimenti =============== */
function CatalogSection() {
  const { db, commit } = useStore()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<FoodCatalogItem | null>(null)
  const foods = liveFoods(db)
  const list = useMemo(() => (q.trim() ? searchFoods(foods, q, 40) : [...foods].sort((a, b) => a.name.localeCompare(b.name, 'it'))), [foods, q])
  const allDupes = useMemo(() => findDuplicatePairs(foods), [foods])
  const dupes = allDupes.slice(0, 5)
  const [dupesOpen, setDupesOpen] = useState<boolean>(() => { try { return localStorage.getItem('mealduo:acc:dupes') !== '0' } catch { return true } })
  const toggleDupes = () => { setDupesOpen(!dupesOpen); try { localStorage.setItem('mealduo:acc:dupes', dupesOpen ? '0' : '1') } catch { /* ignore */ } }
  const { showToast } = useUi()
  const current = edit ? db.foodCatalog.find((f) => f.id === edit.id && !f.deleted) : undefined

  return (
    <div>
      {dupes.length > 0 && (
        <div className="mb-4 rounded-2xl border border-brand/40 bg-brand/10 p-3">
          <button type="button" className="flex w-full items-center justify-between gap-2 text-left" aria-expanded={dupesOpen} onClick={toggleDupes}>
            <span className="min-w-0">
              <span className="block text-sm font-bold">{t('Possibili duplicati')} ({allDupes.length})</span>
              {dupesOpen && <span className="block text-xs text-muted">{t('Unirli fa sommare correttamente le quantità nella spesa.')}</span>}
            </span>
            <ChevronDown size={18} className={`shrink-0 text-muted transition-transform ${dupesOpen ? 'rotate-180' : ''}`} />
          </button>
          {dupesOpen && <ul className="mt-2 space-y-2">
            {dupes.map(([a, b]) => (
              <li key={a.id + b.id} className="rounded-xl bg-surface p-2.5 text-sm">
                <p className="font-semibold">«{a.name}» ≈ «{b.name}»</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <ConfirmButton className="!px-2 !py-1.5 !text-xs" label={t('Tieni «{name}»', { name: a.name })} confirmLabel={t('Conferma')} onConfirm={() => commit((d) => mergeFoods(d, a.id, b.id))} />
                  <ConfirmButton className="!px-2 !py-1.5 !text-xs" label={t('Tieni «{name}»', { name: b.name })} confirmLabel={t('Conferma')} onConfirm={() => commit((d) => mergeFoods(d, b.id, a.id))} />
                </div>
                <button type="button" className="glass-btn mt-2 w-full !px-2 !py-1.5 !text-xs" onClick={() => { commit((d) => keepBoth(d, a.id, b.id)); showToast(t('Alimenti tenuti separati')) }}>{t('Sono diversi: tieni entrambi')}</button>
              </li>
            ))}
          </ul>}
        </div>
      )}
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input className="field !pl-10" value={q} placeholder={t('Cerca nel catalogo')} onChange={(e) => setQ(e.target.value)} aria-label={t('Cerca alimento')} />
      </div>
      <ul className="mt-2 divide-y divide-line/60">
        {list.map((f) => (
          <li key={f.id}>
            <button className="flex w-full items-center justify-between gap-3 py-2.5 text-left active:bg-line/30" onClick={() => setEdit(f)}>
              <span className="min-w-0"><span className="block truncate font-semibold leading-tight">{f.name}</span><span className="block text-xs text-muted">{t(f.category)} · {f.unit}</span></span>
              <span className="shrink-0 rounded-full bg-line/60 px-2 py-0.5 text-[11px] font-semibold">{tp(foodUsage(db, f.id), '{n} uso', '{n} usi', { n: foodUsage(db, f.id) })}</span>
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="py-4 text-center text-sm text-muted">{t('Nessun alimento')}</li>}
      </ul>
      <FoodSheet food={current} onClose={() => setEdit(null)} />
    </div>
  )
}

function FoodSheet({ food, onClose }: { food?: FoodCatalogItem; onClose: () => void }) {
  const { db, commit } = useStore()
  const { showToast } = useUi()
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('g')
  const [category, setCategory] = useState<FoodCatalogItem['category']>('Dispensa')
  const [aliases, setAliases] = useState('')
  const [mergeQ, setMergeQ] = useState('')
  const [seeded, setSeeded] = useState('')
  const [varName, setVarName] = useState('')
  const [varId, setVarId] = useState<string | undefined>()
  const [varAmount, setVarAmount] = useState('100')
  const [varTo, setVarTo] = useState('')
  if (food && seeded !== food.id) { setSeeded(food.id); setVarName(''); setVarId(undefined); setVarAmount(toBase(1, food.unit).unit === 'pz' ? '1' : '100'); setVarTo(''); setName(food.name); setUnit(food.unit); setCategory(food.category); setAliases((food.aliases ?? []).join(', ')); setMergeQ('') }
  if (!food && seeded) setSeeded('')
  const usage = food ? foodUsage(db, food.id) : 0
  const variants = food ? variantsOf(db, food.id) : []
  const varFood = varId ? liveFoods(db).find((f) => f.id === varId) : undefined
  const a = Number(varAmount.replace(',', '.')), b = Number(varTo.replace(',', '.'))
  const canAddVariant = !!food && !!varFood && a > 0 && b > 0
  const candidates = food && mergeQ.trim() ? searchFoods(liveFoods(db).filter((f) => f.id !== food.id), mergeQ, 4) : []
  const save = () => {
    if (!food || !name.trim()) return
    commit((d) => updateFood(d, food.id, { name: name.trim(), unit: unit.trim() || 'g', category, aliases: aliases.split(',').map((a) => a.trim()).filter((a) => a && normalizeName(a) !== normalizeName(name)) }))
    showToast(t('Alimento aggiornato'))
    onClose()
  }
  return (
    <Sheet open={!!food} onClose={onClose} title={t('Alimento')}
      footer={<button className="glass-btn btn-primary w-full !py-3.5" disabled={!name.trim()} onClick={save}>{t('Salva')}</button>}>
      <label className="label !mt-2">{t('Nome canonico')}</label>
      <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">{t('Unità predefinita')}</label><input className="field" list="catunits" value={unit} onChange={(e) => setUnit(e.target.value)} /><datalist id="catunits">{COMMON_UNITS.map((u) => <option key={u} value={u} />)}</datalist></div>
        <div><label className="label">{t('Usi nei piani')}</label><p className="field !border-transparent !bg-transparent font-semibold">{usage}</p></div>
      </div>
      <label className="label">{t('Categoria')}</label>
      <div className="-mx-1 flex flex-wrap gap-2 px-1">{FOOD_CATEGORIES.map((c) => <button key={c} type="button" className={`chip !text-xs ${category === c ? 'chip-active' : ''}`} onClick={() => setCategory(c)}>{c}</button>)}</div>
      <label className="label">{t('Sinonimi (separati da virgola)')}</label>
      <input className="field" value={aliases} placeholder={t('pollo, petto pollo')} onChange={(e) => setAliases(e.target.value)} />

      <label className="label">{t('Varianti')}</label>
      <p className="text-xs text-muted">{t('Alimenti che lo sostituiscono, con il fattore di conversione (es. 100 g di pasta = 120 g di riso). Valgono nei due sensi.')}</p>
      <ul className="mt-2 space-y-1.5">
        {variants.map((v) => (
          <li key={v.food.id} className="flex items-center justify-between gap-2 rounded-2xl border border-line px-3 py-2 text-sm">
            <span className="min-w-0">{v.own ? `${v.variant.amount} ${food?.unit} ${food?.name} = ${v.variant.variantAmount} ${v.food.unit} ${v.food.name}` : `${v.variant.variantAmount} ${food?.unit} ${food?.name} = ${v.variant.amount} ${v.food.unit} ${v.food.name}`}</span>
            <button className="glass-btn !h-9 !w-9 shrink-0 !p-0" aria-label={t('Rimuovi variante {name}', { name: v.food.name })} onClick={() => commit((d) => removeVariant(d, food!.id, v.food.id))}><Trash2 size={15} /></button>
          </li>
        ))}
      </ul>
      <div className="mt-2">
        <FoodInput value={varName} catalog={liveFoods(db).filter((f) => f.id !== food?.id)} onChange={(x) => { setVarName(x); setVarId(undefined) }} onPick={(f) => { setVarName(f.name); setVarId(f.id) }} />
      </div>
      {varFood && (
        <>
          <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <div><input className="field" inputMode="decimal" value={varAmount} onChange={(e) => setVarAmount(e.target.value)} aria-label={t('Quantità di {name}', { name: food?.name ?? '' })} /><p className="mt-1 text-xs text-muted">{food?.unit} {food?.name}</p></div>
            <span className="pb-5 font-bold">=</span>
            <div><input className="field" inputMode="decimal" value={varTo} placeholder="120" onChange={(e) => setVarTo(e.target.value)} aria-label={t('Quantità di {name}', { name: varFood.name })} /><p className="mt-1 text-xs text-muted">{varFood.unit} {varFood.name}</p></div>
          </div>
          <button className="glass-btn mt-2 w-full" disabled={!canAddVariant}
            onClick={() => { commit((d) => setVariant(d, food!.id, varFood.id, a, b)); showToast(t('Variante salvata')); setVarName(''); setVarId(undefined); setVarTo('') }}><Plus size={16} />{t('Aggiungi variante')}</button>
        </>
      )}

      <label className="label">{t('Unisci un duplicato in «{name}»', { name: food?.name ?? '' })}</label>
      <input className="field" value={mergeQ} placeholder={t('Cerca l\'alimento duplicato')} onChange={(e) => setMergeQ(e.target.value)} />
      {candidates.map((c) => (
        <ConfirmButton key={c.id} className="mt-2 w-full" label={t('Unisci «{name}» qui', { name: c.name })} confirmLabel={t('Tocca ancora: «{name}» sparirà', { name: c.name })}
          onConfirm={() => { commit((d) => mergeFoods(d, food!.id, c.id)); showToast(t('Alimenti uniti')); setMergeQ('') }} />
      ))}
      {usage === 0 && <ConfirmButton className="mt-4 w-full" label={<><Trash2 size={16} />{t('Elimina dal catalogo')}</>} onConfirm={() => { commit((d) => deleteFood(d, food!.id)); onClose() }} />}
    </Sheet>
  )
}

/* =============== Dati =============== */
function DataSection() {
  const { db, startFresh, importDatabase } = useStore()
  const { showToast } = useUi()
  const file = useRef<HTMLInputElement>(null)
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <button className="glass-btn" onClick={() => downloadJson('meal-duo-backup.json', db)}>{t('Backup JSON')}</button>
        <button className="glass-btn" onClick={() => file.current?.click()}>{t('Ripristina')}</button>
      </div>
      <input ref={file} type="file" accept="application/json,.json" className="hidden" aria-label={t('Ripristina da backup')}
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (!f) return
          try { importDatabase(parseDb(JSON.parse(await readFileText(f)))); showToast(t('Backup unito ai dati attuali')) } catch (err) { showToast((err as Error).message) }
          e.target.value = ''
        }} />
      <p className="mt-2 px-1 text-xs text-muted">{t('Il ripristino unisce il backup ai dati attuali (vince la modifica più recente per ogni elemento).')}</p>
      <ConfirmButton className="mt-4 w-full" label={<><Trash2 size={16} />{t('Ricomincia da zero')}</>} confirmLabel={t('Tocca ancora: cancella membri, piani e catalogo')} onConfirm={() => { startFresh(); showToast(t('Database svuotato')) }} />
    </div>
  )
}

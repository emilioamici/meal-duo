import { useMemo, useRef, useState } from 'react'
import { Check, Cloud, Copy, Database, KeyRound, Link2, LogOut, Palette, Pencil, Plus, Search, Send, Share2, Trash2, Users, Utensils } from 'lucide-react'
import { Accordion, Avatar, ConfirmButton, PageHeader, Sheet } from '../components/ui'
import { SyncPill } from '../components/Chrome'
import { MascotImg, MascotPeek } from '../components/Mascots'
import { useStore } from '../state/store'
import { useUi } from '../state/ui'
import type { FoodCatalogItem, Member } from '../types'
import { addMember, deleteFood, foodUsage, liveFoods, MEMBER_COLORS, mergeFoods, removeMember, renameHouse, updateFood, updateMember } from '../services/dbOps'
import { parseDb } from '../services/dbSchema'
import { findDuplicatePairs, FOOD_CATEGORIES, normalizeName, searchFoods } from '../lib/foodMatch'
import { COMMON_UNITS } from '../lib/units'
import { copyText, downloadJson, readFileText } from '../lib/files'
import { getTheme, setTheme, type Theme } from '../lib/theme'
import { pickerAvailable } from '../services/googleDriveService'

const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'mai')

export function FamilyView() {
  const { db, members, status } = useStore()
  const foods = liveFoods(db)
  return (
    <>
      <PageHeader title="Famiglia" subtitle={db.houseName} right={<SyncPill />} />
      <MascotPeek kind="pair">
        <div className="space-y-3">
          <Accordion id="sync" title="Google Drive & Sync" icon={<Cloud size={22} />} defaultOpen
            summary={status === 'local' ? 'Non collegato · dati solo su questo dispositivo' : 'Collegato a meal-duo-db.json'}>
            <SyncSection />
          </Accordion>
          <Accordion id="members" title="Membri" icon={<Users size={22} />} summary={members.map((m) => m.name).join(', ')}>
            <MembersSection />
          </Accordion>
          <Accordion id="catalog" title="Catalogo alimenti" icon={<Utensils size={22} />} summary={`${foods.length} alimenti condivisi`}>
            <CatalogSection />
          </Accordion>
          <Accordion id="look" title="Aspetto" icon={<Palette size={22} />} summary="Tema chiaro, scuro o automatico">
            <AppearanceSection />
          </Accordion>
          <Accordion id="data" title="Dati" icon={<Database size={22} />} summary="Nome casa, backup, ripristino">
            <DataSection />
          </Accordion>
        </div>
      </MascotPeek>
    </>
  )
}

/* =============== Sincronizzazione =============== */
function SyncSection() {
  const s = useStore()
  const { showToast } = useUi()
  const [joinId, setJoinId] = useState('')
  const [fresh, setFresh] = useState(true)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const connected = !!s.fileId
  const hasClient = s.cfg.clientId.trim().length > 0

  const act = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true)
    try { await fn(); if (ok) showToast(ok) } catch { /* l'errore è mostrato da s.error */ } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="rounded-2xl border border-line bg-bg/60 p-3 text-sm">
        <div className="flex items-center justify-between gap-2"><span className="text-muted">Stato</span><span className="font-semibold">{{ local: 'Solo locale', idle: 'In attesa', syncing: 'Sincronizzazione…', synced: 'Sincronizzato', offline: 'Offline', error: 'Errore', auth: 'Accesso richiesto' }[s.status]}</span></div>
        {connected && <div className="mt-1 flex items-center justify-between gap-2"><span className="text-muted">Ultima sync</span><span className="font-semibold">{fmtTime(s.lastSyncAt)}</span></div>}
        {s.account && <div className="mt-1 flex items-center justify-between gap-2"><span className="text-muted">Account</span><span className="truncate font-semibold">{s.account}</span></div>}
        {s.demo && <p className="mt-2 text-xs text-muted">Stai usando i dati demo (Emilio e Sara).</p>}
      </div>
      {s.error && <p role="alert" className="mt-3 rounded-xl bg-exp/15 p-3 text-xs text-ink"><span className="font-bold text-exp">Errore: </span>{s.error}</p>}

      <label className="label">Google Client ID</label>
      <input className="field" value={s.cfg.clientId} placeholder="123456-abc.apps.googleusercontent.com" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        onChange={(e) => s.setCfg({ clientId: e.target.value })} />
      <p className="mt-1.5 px-1 text-xs text-muted">Creato in Google Cloud Console (vedi README). Resta solo su questo dispositivo.</p>

      <details className="mt-3 rounded-2xl border border-line bg-bg/60 p-3 text-sm">
        <summary className="cursor-pointer font-semibold">Avanzate: Picker (API Key e App ID)</summary>
        <label className="label">API Key</label>
        <input className="field" value={s.cfg.apiKey} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => s.setCfg({ apiKey: e.target.value })} />
        <label className="label">App ID (numero progetto)</label>
        <input className="field" inputMode="numeric" value={s.cfg.appId} onChange={(e) => s.setCfg({ appId: e.target.value })} />
        <p className="mt-2 text-xs text-muted">Servono per "Scegli da Drive", il modo corretto per collegarsi a un file creato da un altro account con lo scope <code>drive.file</code>.</p>
      </details>

      {!connected ? (
        <>
          <button className="glass-btn btn-primary mt-4 w-full !py-3" disabled={!hasClient || busy} onClick={() => act(s.connect, 'Accesso eseguito')}><KeyRound size={16} />Accedi con Google</button>

          <p className="label">Sei il primo della casa?</p>
          {s.demo && (
            <div className="mb-2 flex gap-2">
              <button className={`chip ${fresh ? 'chip-active' : ''}`} onClick={() => setFresh(true)}>Parti da zero</button>
              <button className={`chip ${!fresh ? 'chip-active' : ''}`} onClick={() => setFresh(false)}>Carica dati demo</button>
            </div>
          )}
          <button className="glass-btn w-full" disabled={!hasClient || busy} onClick={() => act(() => s.createHouse({ fresh: s.demo ? fresh : false }), 'Casa creata su Drive')}><Cloud size={16} />Crea casa su Drive</button>

          <p className="label">Unisciti a una casa</p>
          <input className="field" value={joinId} placeholder="ID o link del file meal-duo-db.json" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => setJoinId(e.target.value)} />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button className="glass-btn" disabled={!hasClient || !joinId.trim() || busy} onClick={() => act(() => s.joinHouse(joinId), 'Casa collegata')}><Link2 size={16} />Collega ID</button>
            <button className="glass-btn" disabled={!hasClient || !pickerAvailable({ clientId: s.cfg.clientId, apiKey: s.cfg.apiKey, appId: s.cfg.appId }) || busy} onClick={() => act(s.pickAndJoin, 'Casa collegata')}><Search size={16} />Scegli da Drive</button>
          </div>
          <p className="mt-2 px-1 text-xs text-muted">Il file deve essere stato condiviso con il tuo account Google. I dati su questo dispositivo verranno sostituiti da quelli della casa.</p>
        </>
      ) : (
        <>
          <button className="glass-btn btn-primary mt-4 w-full !py-3" disabled={busy || s.status === 'syncing'} onClick={() => act(() => s.syncNow(true), 'Sincronizzato')}>Sincronizza ora</button>

          <label className="label">ID del database (da condividere)</label>
          <div className="flex gap-2">
            <input className="field font-mono !text-xs" readOnly value={s.fileId} aria-label="ID del file su Drive" onFocus={(e) => e.currentTarget.select()} />
            <button className="glass-btn !h-11 !w-11 shrink-0 !p-0" aria-label="Copia ID" onClick={async () => showToast((await copyText(s.fileId!)) ? 'ID copiato' : 'Copia non riuscita')}><Copy size={16} /></button>
          </div>

          <label className="label">Invita un familiare (email Google)</label>
          <div className="flex gap-2">
            <input className="field" type="email" value={email} placeholder="nome@gmail.com" autoCapitalize="none" onChange={(e) => setEmail(e.target.value)} />
            <button className="glass-btn btn-primary !h-11 !w-11 shrink-0 !p-0" aria-label="Invia invito" disabled={!email.includes('@') || busy}
              onClick={() => act(async () => { await s.share(email); setEmail('') }, 'Invito inviato: ora può unirsi dall\'app')}><Send size={16} /></button>
          </div>
          <p className="mt-2 px-1 text-xs text-muted"><Share2 size={12} className="mr-1 inline" />Drive concede il ruolo Editor. Il familiare, in Meal Duo, accede con Google → «Scegli da Drive».</p>

          <ConfirmButton className="mt-4 w-full" label={<><LogOut size={16} />Scollega da Drive</>} confirmLabel="Tocca ancora: i dati restano su questo dispositivo" onConfirm={s.disconnect} />
        </>
      )}
    </div>
  )
}

/* =============== Membri =============== */
function MembersSection() {
  const { members } = useStore()
  const [sheet, setSheet] = useState<{ member?: Member } | null>(null)
  return (
    <div>
      <ul className="divide-y divide-line/60">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-3 py-2.5">
            <Avatar member={m} size={40} />
            <div className="min-w-0 flex-1"><p className="truncate font-semibold leading-tight">{m.name}</p><p className="truncate text-xs text-muted">{m.email || 'Nessuna email associata'}</p></div>
            <button className="glass-btn !h-10 !w-10 !p-0" aria-label={`Modifica ${m.name}`} onClick={() => setSheet({ member: m })}><Pencil size={16} /></button>
          </li>
        ))}
      </ul>
      <button className="glass-btn mt-3 w-full" onClick={() => setSheet({})}><Plus size={16} />Aggiungi membro</button>
      <MemberSheet open={!!sheet} member={sheet?.member} onClose={() => setSheet(null)} />
    </div>
  )
}

function MemberSheet({ open, member, onClose }: { open: boolean; member?: Member; onClose: () => void }) {
  const { members, commit } = useStore()
  const { setMemberId } = useUi()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [color, setColor] = useState(MEMBER_COLORS[0])
  const [key, setKey] = useState('')
  const k = member?.id ?? 'new'
  if (open && key !== k + open) { setKey(k + open); setName(member?.name ?? ''); setEmail(member?.email ?? ''); setColor(member?.color ?? MEMBER_COLORS[members.length % MEMBER_COLORS.length]) }
  const save = () => {
    if (!name.trim()) return
    if (member) commit((d) => updateMember(d, member.id, { name: name.trim(), email: email.trim() || undefined, color }))
    else {
      let id = ''
      commit((d) => { const r = addMember(d, name, color, email); id = r.member.id; return r.db })
      if (id) setMemberId(id)
    }
    onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} title={member ? 'Modifica membro' : 'Nuovo membro'}>
      <label className="label !mt-2">Nome</label>
      <input className="field" value={name} autoFocus={!member} onChange={(e) => setName(e.target.value)} />
      <label className="label">Email Google (facoltativa)</label>
      <input className="field" type="email" value={email} autoCapitalize="none" onChange={(e) => setEmail(e.target.value)} />
      <label className="label">Colore</label>
      <div className="flex flex-wrap gap-3 px-1">
        {MEMBER_COLORS.map((c) => (
          <button key={c} type="button" aria-label={`Colore ${c}`} aria-pressed={color === c} onClick={() => setColor(c)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-white transition active:scale-90" style={{ background: c }}>
            {color === c && <Check size={18} strokeWidth={3} />}
          </button>
        ))}
      </div>
      <button className="glass-btn btn-primary mt-5 w-full !py-3.5" disabled={!name.trim()} onClick={save}>Salva</button>
      {member && members.length > 1 && (
        <ConfirmButton className="mt-2 w-full" label={<><Trash2 size={16} />Rimuovi membro</>} confirmLabel="Tocca ancora: il suo piano verrà eliminato" onConfirm={() => { commit((d) => removeMember(d, member.id)); onClose() }} />
      )}
    </Sheet>
  )
}

/* =============== Catalogo alimenti =============== */
function CatalogSection() {
  const { db, commit } = useStore()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<FoodCatalogItem | null>(null)
  const foods = liveFoods(db)
  const list = useMemo(() => (q.trim() ? searchFoods(foods, q, 40) : [...foods].sort((a, b) => a.name.localeCompare(b.name, 'it'))), [foods, q])
  const dupes = useMemo(() => findDuplicatePairs(foods).slice(0, 5), [foods])
  const current = edit ? db.foodCatalog.find((f) => f.id === edit.id && !f.deleted) : undefined

  return (
    <div>
      {dupes.length > 0 && (
        <div className="mb-4 rounded-2xl border border-brand/40 bg-brand/10 p-3">
          <p className="text-sm font-bold">Possibili duplicati</p>
          <p className="text-xs text-muted">Unirli fa sommare correttamente le quantità nella spesa.</p>
          <ul className="mt-2 space-y-2">
            {dupes.map(([a, b]) => (
              <li key={a.id + b.id} className="rounded-xl bg-surface p-2.5 text-sm">
                <p className="font-semibold">«{a.name}» ≈ «{b.name}»</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <ConfirmButton className="!px-2 !py-1.5 !text-xs" label={`Tieni «${a.name}»`} confirmLabel="Conferma" onConfirm={() => commit((d) => mergeFoods(d, a.id, b.id))} />
                  <ConfirmButton className="!px-2 !py-1.5 !text-xs" label={`Tieni «${b.name}»`} confirmLabel="Conferma" onConfirm={() => commit((d) => mergeFoods(d, b.id, a.id))} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input className="field !pl-10" value={q} placeholder="Cerca nel catalogo" onChange={(e) => setQ(e.target.value)} aria-label="Cerca alimento" />
      </div>
      <ul className="mt-2 divide-y divide-line/60">
        {list.map((f) => (
          <li key={f.id}>
            <button className="flex w-full items-center justify-between gap-3 py-2.5 text-left active:bg-line/30" onClick={() => setEdit(f)}>
              <span className="min-w-0"><span className="block truncate font-semibold leading-tight">{f.name}</span><span className="block text-xs text-muted">{f.category} · {f.unit}</span></span>
              <span className="shrink-0 rounded-full bg-line/60 px-2 py-0.5 text-[11px] font-semibold">{foodUsage(db, f.id)} usi</span>
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="py-4 text-center text-sm text-muted">Nessun alimento</li>}
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
  if (food && seeded !== food.id) { setSeeded(food.id); setName(food.name); setUnit(food.unit); setCategory(food.category); setAliases((food.aliases ?? []).join(', ')); setMergeQ('') }
  if (!food && seeded) setSeeded('')
  const usage = food ? foodUsage(db, food.id) : 0
  const candidates = food && mergeQ.trim() ? searchFoods(liveFoods(db).filter((f) => f.id !== food.id), mergeQ, 4) : []
  const save = () => {
    if (!food || !name.trim()) return
    commit((d) => updateFood(d, food.id, { name: name.trim(), unit: unit.trim() || 'g', category, aliases: aliases.split(',').map((a) => a.trim()).filter((a) => a && normalizeName(a) !== normalizeName(name)) }))
    showToast('Alimento aggiornato')
    onClose()
  }
  return (
    <Sheet open={!!food} onClose={onClose} title="Alimento">
      <label className="label !mt-2">Nome canonico</label>
      <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">Unità predefinita</label><input className="field" list="catunits" value={unit} onChange={(e) => setUnit(e.target.value)} /><datalist id="catunits">{COMMON_UNITS.map((u) => <option key={u} value={u} />)}</datalist></div>
        <div><label className="label">Usi nei piani</label><p className="field !border-transparent !bg-transparent font-semibold">{usage}</p></div>
      </div>
      <label className="label">Categoria</label>
      <div className="-mx-1 flex flex-wrap gap-2 px-1">{FOOD_CATEGORIES.map((c) => <button key={c} type="button" className={`chip !text-xs ${category === c ? 'chip-active' : ''}`} onClick={() => setCategory(c)}>{c}</button>)}</div>
      <label className="label">Sinonimi (separati da virgola)</label>
      <input className="field" value={aliases} placeholder="pollo, petto pollo" onChange={(e) => setAliases(e.target.value)} />
      <button className="glass-btn btn-primary mt-4 w-full !py-3.5" disabled={!name.trim()} onClick={save}>Salva</button>

      <label className="label">Unisci un duplicato in «{food?.name}»</label>
      <input className="field" value={mergeQ} placeholder="Cerca l'alimento duplicato" onChange={(e) => setMergeQ(e.target.value)} />
      {candidates.map((c) => (
        <ConfirmButton key={c.id} className="mt-2 w-full" label={`Unisci «${c.name}» qui`} confirmLabel={`Tocca ancora: «${c.name}» sparirà`}
          onConfirm={() => { commit((d) => mergeFoods(d, food!.id, c.id)); showToast('Alimenti uniti'); setMergeQ('') }} />
      ))}
      {usage === 0 && <ConfirmButton className="mt-4 w-full" label={<><Trash2 size={16} />Elimina dal catalogo</>} onConfirm={() => { commit((d) => deleteFood(d, food!.id)); onClose() }} />}
    </Sheet>
  )
}

/* =============== Aspetto =============== */
function AppearanceSection() {
  const [theme, setT] = useState<Theme>(getTheme())
  const opts: { id: Theme; label: string; swatch: string; cat: 'mochi' | 'zenitsu' | 'pair' }[] = [
    { id: 'light', label: 'Mochi', swatch: '#fff7ee', cat: 'mochi' },
    { id: 'dark', label: 'Zenitsu', swatch: '#16181d', cat: 'zenitsu' },
    { id: 'auto', label: 'Automatico', swatch: 'linear-gradient(135deg, #fff7ee 50%, #16181d 50%)', cat: 'pair' },
  ]
  return (
    <div className="grid grid-cols-3 gap-2">
      {opts.map((o) => (
        <button key={o.id} aria-pressed={theme === o.id} onClick={() => { setT(o.id); setTheme(o.id) }}
          className={`relative flex flex-col items-center gap-2 rounded-2xl border p-2.5 transition active:scale-95 ${theme === o.id ? 'border-brand bg-brand/10' : 'border-line bg-bg/60'}`}>
          <span className="flex h-14 w-full items-end justify-center overflow-hidden rounded-xl border border-line" style={{ background: o.swatch }}>
            <MascotImg kind={o.cat} className="h-12 w-auto" />
          </span>
          <span className="text-xs font-semibold">{o.label}</span>
          {theme === o.id && <Check size={14} className="absolute right-1.5 top-1.5 text-brand" strokeWidth={3} />}
        </button>
      ))}
    </div>
  )
}

/* =============== Dati =============== */
function DataSection() {
  const { db, commit, startFresh, importDatabase } = useStore()
  const { showToast } = useUi()
  const [house, setHouse] = useState(db.houseName)
  const file = useRef<HTMLInputElement>(null)
  return (
    <div>
      <label className="label !mt-0">Nome della casa</label>
      <div className="flex gap-2">
        <input className="field" value={house} onChange={(e) => setHouse(e.target.value)} />
        <button className="glass-btn btn-primary shrink-0" disabled={!house.trim() || house === db.houseName} onClick={() => commit((d) => renameHouse(d, house))}>Salva</button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button className="glass-btn" onClick={() => downloadJson('meal-duo-backup.json', db)}>Backup JSON</button>
        <button className="glass-btn" onClick={() => file.current?.click()}>Ripristina</button>
      </div>
      <input ref={file} type="file" accept="application/json,.json" className="hidden" aria-label="Ripristina da backup"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (!f) return
          try { importDatabase(parseDb(JSON.parse(await readFileText(f)))); showToast('Backup unito ai dati attuali') } catch (err) { showToast((err as Error).message) }
          e.target.value = ''
        }} />
      <p className="mt-2 px-1 text-xs text-muted">Il ripristino unisce il backup ai dati attuali (vince la modifica più recente per ogni elemento).</p>
      <ConfirmButton className="mt-4 w-full" label={<><Trash2 size={16} />Ricomincia da zero</>} confirmLabel="Tocca ancora: cancella membri, piani e catalogo" onConfirm={() => { startFresh(); showToast('Database svuotato') }} />
    </div>
  )
}

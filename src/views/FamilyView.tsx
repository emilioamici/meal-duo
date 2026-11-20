import { useMemo, useRef, useState } from 'react'
import { Bell, Check, Cloud, Database, Mail, Palette, Pencil, Plus, Search, Trash2, Users, Utensils } from 'lucide-react'
import { Accordion, Avatar, ConfirmButton, PageHeader, Sheet } from '../components/ui'
import { HeaderActions } from '../components/Chrome'
import { MascotImg, MascotPeek } from '../components/Mascots'
import { useStore } from '../state/store'
import { useUi } from '../state/ui'
import type { FoodCatalogItem, Member } from '../types'
import { addMember, deleteFood, foodUsage, liveFoods, MEMBER_COLORS, mergeFoods, removeMember, renameHouse, updateFood, updateMember } from '../services/dbOps'
import { parseDb } from '../services/dbSchema'
import { findDuplicatePairs, FOOD_CATEGORIES, normalizeName, searchFoods } from '../lib/foodMatch'
import { COMMON_UNITS } from '../lib/units'
import { downloadJson, readFileText } from '../lib/files'
import { getTheme, setTheme, type Theme } from '../lib/theme'
import { SyncCard } from '../components/SyncCard'
import { NotificationsCard } from '../components/NotificationsCard'
import { engine } from '../sync/engine'
import { isPristine } from '../services/dbOps'

export function FamilyView() {
  const { db, members, sync, prefs } = useStore()
  const foods = liveFoods(db)
  return (
    <>
      <PageHeader title="Famiglia" subtitle={db.houseName} right={<HeaderActions />} />
      <MascotPeek kind="pair">
        <div className="space-y-3">
          <Accordion id="sync" title="Google Drive & Sync" icon={<Cloud size={22} />} defaultOpen
            summary={!sync.fileId ? (isPristine(db) ? 'Modalità demo · dati solo su questo dispositivo' : 'Non collegato · dati solo su questo dispositivo') : `Collegato · ${sync.email ?? ''}`}>
            <SyncCard />
          </Accordion>
          <Accordion id="notif" title="Notifiche" icon={<Bell size={22} />} summary={prefs.systemNotif || prefs.pushEnabled ? 'Attive su questo dispositivo' : 'Disattivate'}>
            <NotificationsCard />
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

/* =============== Membri =============== */
function MembersSection() {
  const { members, sync } = useStore()
  const [sheet, setSheet] = useState<{ member?: Member } | null>(null)
  const [invite, setInvite] = useState(false)
  const owner = sync.ownerEmail?.toLowerCase()
  return (
    <div>
      <ul className="divide-y divide-line/60">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-3 py-2.5">
            <Avatar member={m} size={40} />
            <div className="min-w-0 flex-1"><p className="truncate font-semibold leading-tight">{m.name}{!!owner && m.email?.toLowerCase() === owner && <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold">proprietario</span>}</p><p className="truncate text-xs text-muted">{m.email || 'Nessun account Google associato'}</p></div>
            <button className="glass-btn !h-10 !w-10 !p-0" aria-label={`Modifica ${m.name}`} onClick={() => setSheet({ member: m })}><Pencil size={16} /></button>
          </li>
        ))}
      </ul>
      <button className="glass-btn mt-3 w-full" onClick={() => setSheet({})}><Plus size={16} />Aggiungi membro</button>
      {sync.fileId && sync.canShare && <button className="glass-btn btn-primary mt-2 w-full" onClick={() => setInvite(true)}><Mail size={16} />Invita con Google Drive</button>}
      {sync.fileId && !sync.canShare && <p className="mt-2 px-1 text-xs text-muted">Solo il proprietario ({sync.ownerEmail ?? 'altro account'}) può invitare o rimuovere persone dal database su Drive.</p>}
      <MemberSheet open={!!sheet} member={sheet?.member} onClose={() => setSheet(null)} />
      <InviteSheet open={invite} onClose={() => setInvite(false)} />
    </div>
  )
}

function MemberSheet({ open, member, onClose }: { open: boolean; member?: Member; onClose: () => void }) {
  const { members, commit, sync } = useStore()
  const { setMemberId, showToast } = useUi()
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
        <ConfirmButton className="mt-2 w-full" label={<><Trash2 size={16} />Rimuovi membro</>} confirmLabel={member.email && sync.canShare ? 'Tocca ancora: perderà l\'accesso a Drive e il suo piano verrà eliminato' : 'Tocca ancora: il suo piano verrà eliminato'}
          onConfirm={async () => {
            // il proprietario revoca anche l'accesso al file su Drive
            if (member.email && sync.canShare) { try { await engine.revoke(member.email) } catch (e) { showToast((e as Error).message) } }
            commit((d) => removeMember(d, member.id)); onClose()
          }} />
      )}
    </Sheet>
  )
}

function InviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, members, commit } = useStore()
  const { showToast } = useUi()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [target, setTarget] = useState('new') // 'new' = nuovo membro, altrimenti id di un membro esistente senza account
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const unclaimed = members.filter((m) => !m.email)
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  const send = async () => {
    setBusy(true); setErr('')
    try {
      const mail = email.trim()
      if (members.some((m) => m.email?.toLowerCase() === mail.toLowerCase())) throw new Error('Questa persona è già nella casa.')
      await engine.invite(mail, db.houseName)
      const claimed = target !== 'new' ? members.find((m) => m.id === target) : undefined
      // l'invito si collega a un membro già presente (es. dopo un import) invece di crearne uno duplicato
      commit((d) => (claimed ? updateMember(d, claimed.id, { email: mail }) : addMember(d, name.trim() || mail.split('@')[0], MEMBER_COLORS[d.members.length % MEMBER_COLORS.length], mail).db))
      showToast(`Invito inviato a ${mail}`)
      setEmail(''); setName(''); setTarget('new'); onClose()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Invita un familiare">
      <p className="text-sm text-muted">Drive concede il ruolo <b className="text-ink">Editor</b> sul database e manda l'email di invito. Il familiare, in Meal Duo, accede con Google e sceglie il database condiviso (Picker).</p>
      {err && <p role="alert" className="mt-3 rounded-xl bg-exp/15 p-3 text-sm"><span className="font-bold text-exp">Errore: </span>{err}</p>}
      <label className="label">Email Google</label>
      <input className="field" type="email" value={email} autoCapitalize="none" placeholder="nome@gmail.com" onChange={(e) => setEmail(e.target.value)} />
      {unclaimed.length > 0 && (
        <>
          <label className="label">Chi è?</label>
          <div className="-mx-1 flex flex-wrap gap-2 px-1">
            <button className={`chip ${target === 'new' ? 'chip-active' : ''}`} onClick={() => setTarget('new')}>Nuovo membro</button>
            {unclaimed.map((m) => <button key={m.id} className={`chip !pl-1.5 ${target === m.id ? 'chip-active' : ''}`} onClick={() => setTarget(m.id)}><Avatar member={m} size={22} />{m.name}</button>)}
          </div>
        </>
      )}
      {target === 'new' && (<><label className="label">Nome</label><input className="field" value={name} placeholder="es. Sara" onChange={(e) => setName(e.target.value)} /></>)}
      <button className="glass-btn btn-primary mt-5 w-full !py-3.5" disabled={!valid || busy} onClick={() => void send()}><Mail size={16} />Invia invito</button>
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

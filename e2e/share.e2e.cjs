/**
 * End-to-end della condivisione del database (Playwright). Simula Google (login, Drive con permesso ristretto `drive.file`:
 * solo chi ha creato il file lo vede direttamente) e il Worker (sessione persistente, ponte, /house/join). Si lancia con `npm run e2e`.
 */
const { chromium, devices } = require('playwright')
const http = require('http')

let failures = 0
const ok = (c, m) => { console.log(c ? 'ok  :' : 'FAIL:', m); if (!c) failures++ }

// ---------------------------- stato condiviso (Drive + Worker) ----------------------------
const FILE_ID = 'file1234567890abcdef12'
const D = { file: null, perms: [], log: [], conflictOnce: false, house: null, regs: 0, direct: [], joins: 0 }
const pickerRequests = []
const sessions = { ['a'.repeat(40)]: 'anna@x.it', ['b'.repeat(40)]: 'bruno@x.it', ['c'.repeat(40)]: 'carla@x.it', ['d'.repeat(40)]: 'dave@x.it', ['e'.repeat(40)]: 'eve@x.it' }
const emailOf = (auth) => (auth || '').replace('Bearer tok-', '')
const roleOf = (email) => (D.file && D.file.owner === email ? 'owner' : (D.perms.find((p) => p.email === email) || {}).role)
const meta = () => ({ id: FILE_ID, name: 'meal-duo-db.json', version: String(D.file.version), modifiedTime: new Date().toISOString() })

const worker = http.createServer((req, res) => {
  const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Content-Type': 'application/json' }
  const send = (s, o) => { res.writeHead(s, h); res.end(JSON.stringify(o)) }
  if (req.method === 'OPTIONS') { res.writeHead(204, h); return res.end() }
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const auth = req.headers.authorization || ''; const sid = auth.replace('Bearer ', '')
    const email = emailOf(auth); const b = body ? JSON.parse(body) : {}
    switch (req.url) {
      case '/health': return send(200, { ok: true, auth: true, push: true, bridge: true })
      case '/auth/refresh': return sessions[sid] ? send(200, { access_token: 'tok-' + sessions[sid], expires_in: 3600, email: sessions[sid] }) : send(401, { error: 'x' })
      case '/notify': return send(200, { ok: true, sent: 0, failed: 0, removed: 0 })
      case '/house/register': if (roleOf(email) !== 'owner') return send(403, { error: 'Solo chi ha creato la famiglia' }); D.house = { owner: email }; D.regs++; D.log.push('register by ' + email); return send(200, { ok: true })
      case '/house/join': {
        if (!D.house || b.fileId !== FILE_ID) return send(404, { error: 'Codice sconosciuto, oppure chi ha creato la famiglia deve riaprire l’app con l’accesso persistente.' })
        if (roleOf(email)) return send(200, { ok: true, joined: false })
        D.perms.push({ id: 'p' + D.perms.length, email, role: 'writer' }); D.joins++; D.log.push('join ' + email); return send(200, { ok: true, joined: true })
      }
      case '/house/mine': return send(200, { houses: D.house && D.file && roleOf(email) ? [meta()] : [] })
      case '/db/meta': case '/db/read': case '/db/write': {
        if (!D.house || !D.file || !roleOf(email)) { D.log.push(`bridge ${req.url} DENIED ${email}`); return send(403, { error: 'Nessun accesso al database della famiglia' }) }
        if (req.url === '/db/meta') return send(200, { meta: meta() })
        if (req.url === '/db/read') { D.log.push('bridge read by ' + email); return send(200, { meta: meta(), db: JSON.parse(D.file.content) }) }
        if (!['owner', 'writer'].includes(roleOf(email))) return send(403, { error: 'sola lettura' })
        if (D.conflictOnce || b.expectedVersion !== String(D.file.version)) { D.conflictOnce = false; D.log.push('bridge write 409 for ' + email); return send(409, { error: 'Versione cambiata' }) }
        D.file.content = JSON.stringify(b.db); D.file.version++; D.log.push(`bridge write by ${email} v${D.file.version}`); return send(200, { meta: meta() })
      }
    }
    send(404, { error: 'Non trovato' })
  })
}).listen(8788)

async function mockGoogle(ctx) {
  await ctx.route('https://apis.google.com/**', (route) => { pickerRequests.push(route.request().url()); return route.abort() })
  await ctx.route('https://www.googleapis.com/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const me = emailOf(req.headers()['authorization'])
    const json = (o, s = 200) => route.fulfill({ status: s, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(o) })
    const fm = () => ({ ...meta(), ownedByMe: true, owners: [{ emailAddress: D.file.owner }], properties: { mealduo: 'db' }, capabilities: { canEdit: true, canShare: true } })
    if (p === '/drive/v3/about') return json({ user: { emailAddress: me, displayName: me.split('@')[0] } })
    // con `drive.file` solo chi ha creato il file lo vede
    if (p === '/drive/v3/files' && req.method() === 'GET') return json({ files: D.file && me === D.file.owner ? [fm()] : [] })
    if (p === '/upload/drive/v3/files' && req.method() === 'POST') {
      const parts = (req.postData() || '').split(/--mealduo\w+/).filter((x) => x.includes('Content-Type'))
      D.file = { owner: me, version: 1, content: parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '') }
      D.log.push('create by ' + me); return json(fm())
    }
    const m = /^\/(upload\/)?drive\/v3\/files\/([\w-]+)(\/permissions(?:\/(\w+))?)?$/.exec(p)
    if (m) {
      if (!D.file || me !== D.file.owner) { D.direct.push(`${me} ${req.method()} ${p}`); return json({ error: { message: 'File not found' } }, 404) }
      if (m[3] && req.method() === 'POST') { const j = JSON.parse(req.postData()); D.perms.push({ id: 'p' + D.perms.length, email: j.emailAddress, role: j.role }); D.log.push('share ' + j.emailAddress); return json({}) }
      if (m[3] && req.method() === 'GET') return json({ permissions: [{ id: 'po', emailAddress: D.file.owner, role: 'owner' }, ...D.perms.map((x) => ({ id: x.id, emailAddress: x.email, role: x.role }))] })
      if (m[3] && req.method() === 'DELETE') { D.perms = D.perms.filter((x) => x.id !== m[4]); D.log.push('unshare'); return json({}) }
      if (req.method() === 'PATCH') { D.file.content = req.postData(); D.file.version++; D.log.push(`drive update by ${me} v${D.file.version}`); return json(fm()) }
      if (url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: D.file.content })
      return json(fm())
    }
    return json({ error: { message: 'unmocked ' + p } }, 500)
  })
}

async function device(browser, sid, hash = '') {
  const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'it-IT', serviceWorkers: 'block' })
  await ctx.addInitScript((s) => { try { if (!localStorage.getItem('mealduo:session')) localStorage.setItem('mealduo:session', s) } catch {} }, sid)
  await mockGoogle(ctx)
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message))
  await page.goto('http://localhost:4174/' + hash); await page.waitForTimeout(1800)
  return { ctx, page, errs }
}
const nav = (page, name) => page.getByRole('button', { name, exact: true }).click()
const syncOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mealduo:sync') || '{}'))
const dbHas = (text) => !!D.file && D.file.content.includes(text)
async function addExtra(page, name) {
  await nav(page, 'Spesa'); await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Aggiungi voce extra' }).click(); await page.waitForTimeout(400)
  await page.getByPlaceholder('Carta forno').fill(name); await page.getByRole('button', { name: /Aggiungi alla spesa/ }).click()
}

;(async () => {
  const browser = await chromium.launch()

  // ===== 1) Anna crea la famiglia: viene affidata al ponte e il codice «basta» =====
  const A = await device(browser, 'a'.repeat(40))
  await A.page.getByRole('button', { name: 'Crea famiglia', exact: true }).click(); await A.page.waitForTimeout(2200)
  ok(dbHas('meal-duo-db') && D.log.includes('create by anna@x.it'), 'Anna: famiglia creata nel suo Drive')
  ok(D.log.includes('register by anna@x.it'), 'Anna: la famiglia è affidata al ponte (accesso persistente)')
  await nav(A.page, 'Impostazioni'); await A.page.waitForTimeout(400)
  await A.page.getByText('Famiglia', { exact: true }).first().click(); await A.page.waitForTimeout(400)
  ok(await A.page.getByRole('textbox', { name: 'ID famiglia' }).inputValue() === FILE_ID, 'Anna: il codice è l\'ID del file, copiabile')
  ok(await A.page.getByText(/Il codice basta/).count() > 0, 'Anna: la UI dice onestamente che «il codice basta» (ponte attivo + registrata)')

  // ===== 2) Bruno entra con il SOLO codice (link), con la chiave API del Picker NON valida: il Picker non si apre mai =====
  const B = await device(browser, 'b'.repeat(40), '#join=' + FILE_ID)
  await B.page.waitForTimeout(1500)
  const sb = await syncOf(B.page)
  ok(sb.fileId === FILE_ID && sb.bridged === true, 'Bruno: con il solo codice la famiglia si collega dal ponte')
  ok(D.perms.some((p) => p.email === 'bruno@x.it' && p.role === 'writer') && D.log.includes('join bruno@x.it'), 'Bruno: il Worker lo ha aggiunto tra gli scrittori (nessuna email di invito)')
  ok(pickerRequests.length === 0 && await B.page.getByText('Scegli il file e unisciti').count() === 0, 'Bruno: il Picker non è mai stato aperto (nessuna richiesta a apis.google.com, chiave API non valida)')
  ok(!(await B.page.evaluate(() => location.hash)) && await B.page.evaluate(() => localStorage.getItem('mealduo:joinId')) === null, 'Bruno: il link #join è tolto dalla barra e dimenticato dopo il collegamento riuscito')

  // ===== 3) Bruno scrive dal ponte; scritture concorrenti → 409 gestito senza perdere nulla =====
  await addExtra(A.page, 'Sapone')                        // Anna scrive su Drive (versione avanza)
  await A.page.waitForTimeout(3500)
  D.conflictOnce = true                                    // e la prima scrittura di Bruno trova una versione cambiata
  await addExtra(B.page, 'Detersivo'); await B.page.waitForTimeout(5000)
  ok(D.log.includes('bridge write 409 for bruno@x.it'), 'Bruno: scrittura rifiutata con 409 (versione cambiata)')
  ok(D.log.some((l) => /^bridge write by bruno@x.it/.test(l)), 'Bruno: dopo il merge la scrittura riesce dal ponte')
  ok(dbHas('Sapone') && dbHas('Detersivo'), 'Il database su Drive contiene sia la voce di Anna sia quella di Bruno (nessuna perdita)')
  ok(await B.page.getByRole('alert').count() === 0, 'Bruno: il 409 non è mostrato come errore')

  // ===== 4) Carla: invito con email (prima si condivide, poi si registra); la trova da sola dopo l'accesso, senza link né codice =====
  await nav(A.page, 'Impostazioni'); await A.page.waitForTimeout(500)
  await A.page.getByPlaceholder('Email Google della persona').fill('carla@x.it'); await A.page.getByPlaceholder('Nome (opzionale)').fill('Carla')
  await A.page.getByRole('button', { name: 'Invia invito', exact: true }).click(); await A.page.waitForTimeout(2200)
  const iShare = D.log.lastIndexOf('share carla@x.it'), iReg = D.log.lastIndexOf('register by anna@x.it')
  ok(iShare >= 0 && iReg > iShare, 'Anna: prima condivide il file con l\'email, poi registra sul ponte (ordine)')
  const C = await device(browser, 'c'.repeat(40))
  await C.page.waitForTimeout(1500)
  ok((await syncOf(C.page)).fileId === FILE_ID && (await syncOf(C.page)).bridged === true, 'Carla: l\'invito via email viene trovato da solo dopo l\'accesso (/house/mine) e si collega')
  ok(pickerRequests.length === 0, 'Carla: nessun Picker')

  // ===== 5) Secondo dispositivo del proprietario: non sovrascrive i dati su Drive =====
  const A2 = await device(browser, 'a'.repeat(40))
  await A2.page.waitForTimeout(2500)
  ok((await syncOf(A2.page)).fileId === FILE_ID, 'Anna (secondo dispositivo): si collega alla famiglia esistente')
  await A2.page.waitForTimeout(3000)
  ok(dbHas('Sapone') && dbHas('Detersivo') && D.log.filter((l) => l === 'create by anna@x.it').length === 1, 'Anna (secondo dispositivo): non crea un nuovo file né cancella i dati su Drive')

  // ===== 6) Il codice di un'altra persona: Dave entra con il solo codice; un codice sbagliato no =====
  const Dv = await device(browser, 'd'.repeat(40))
  await Dv.page.getByPlaceholder('ID famiglia').fill(FILE_ID); await Dv.page.getByRole('button', { name: 'Entra', exact: true }).click(); await Dv.page.waitForTimeout(2200)
  ok((await syncOf(Dv.page)).fileId === FILE_ID && D.perms.some((p) => p.email === 'dave@x.it'), 'Dave: incollando il codice entra (compromesso noto: il codice è un segreto condiviso)')
  const E = await device(browser, 'e'.repeat(40))
  await E.page.getByPlaceholder('ID famiglia').fill('codice-sbagliato-0000'); await E.page.getByRole('button', { name: 'Entra', exact: true }).click(); await E.page.waitForTimeout(1800)
  ok((await syncOf(E.page)).fileId == null && !D.perms.some((p) => p.email === 'eve@x.it') && !D.log.includes('join eve@x.it'), 'Eve: un codice sbagliato non entra e non la aggiunge a nessun file')
  ok(await E.page.getByText('Scegli il file e unisciti').count() === 1 && pickerRequests.length === 0, 'Eve: con il Picker configurato si arriva al passo «Scegli il file», che si apre solo con un tocco (mai in automatico)')
  ok(pickerRequests.length === 0, 'In nessuno scenario è stato aperto il Picker')

  // ===== 7) Revoca: togliendo l'account da Drive il ponte si chiude =====
  await nav(A.page, 'Impostazioni'); await A.page.waitForTimeout(500)
  await A.page.getByRole('button', { name: 'Rimuovi Bruno' }).click(); await A.page.getByRole('button', { name: 'Conferma' }).click(); await A.page.waitForTimeout(1800)
  await B.page.evaluate(() => window.dispatchEvent(new Event('online'))); await B.page.waitForTimeout(3000)
  ok(D.log.some((l) => l.includes('DENIED bruno@x.it')), 'Bruno: tolto da Drive, alla sincronizzazione successiva il ponte lo rifiuta')

  console.log('Errori pagina:', [...A.errs, ...B.errs, ...C.errs, ...A2.errs, ...Dv.errs, ...E.errs].length ? 'PRESENTI' : 'nessuno')
  await browser.close(); worker.close()
  if (failures) { console.log(`\n${failures} controlli falliti`); process.exit(1) }
  console.log('\ntutto ok')
})().catch((e) => { console.error(e); process.exit(1) })

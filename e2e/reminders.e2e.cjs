/**
 * End-to-end dei promemoria dei pasti (Playwright): la scheda nelle Impostazioni, con Google, Drive e Worker simulati.
 * Il Worker simulato registra le richieste: si controlla cosa invia l'app (orari, giorni, fuso, testi) e cosa mostra.
 */
const { chromium, devices } = require('playwright')
const http = require('http')

let failures = 0
const ok = (c, m) => { console.log(c ? 'ok  :' : 'FAIL:', m); if (!c) failures++ }

const W = { reminders: true, lastRunAt: null, doc: null, hasToken: false, token: null, saved: null, calls: [], sent: 1 }
const FILE = { content: null, id: 'file1234567890abcdef12' }

const worker = http.createServer((req, res) => {
  const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Content-Type': 'application/json' }
  const send = (s, o) => { res.writeHead(s, h); res.end(JSON.stringify(o)) }
  if (req.method === 'OPTIONS') { res.writeHead(204, h); return res.end() }
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const b = body ? JSON.parse(body) : {}
    W.calls.push(req.url)
    switch (req.url) {
      case '/health': return send(200, { ok: true, auth: true, push: true, bridge: true, ...(W.reminders ? { reminders: true } : {}) })
      case '/auth/refresh': return send(200, { access_token: 'tok-anna@x.it', expires_in: 3600, email: 'anna@x.it' })
      case '/house/register': return send(200, { ok: true })
      case '/subscribe': return send(200, { ok: true })
      case '/reminders/get': return send(200, { ok: true, doc: W.doc, hasToken: W.hasToken, lastRunAt: W.lastRunAt, house: true })
      case '/reminders/save': W.saved = b; W.doc = { rules: b.rules }; return send(200, { ok: true })
      case '/reminders/token': if (W.hasToken && b.rotate !== true) return send(200, { ok: true, exists: true }); W.hasToken = true; W.token = 'TOK' + 'x'.repeat(30); return send(200, { ok: true, exists: false, token: W.token })
      case '/reminders/revoke': W.hasToken = false; W.token = null; return send(200, { ok: true })
      case '/reminders/test': return send(200, { ok: true, sent: W.sent, failed: 0, removed: 0, preview: { title: 'È ora di ' + (b.meal || ''), body: 'Riso basmati 90g · Petto di pollo 150g' }, personalised: true })
    }
    if (req.url.startsWith('/reminder/in/')) return W.token && req.url.includes(W.token) ? send(200, { ok: true, sent: 1, failed: 0, removed: 0 }) : send(404, { error: 'Token non valido o revocato' })
    send(404, { error: 'Non trovato' })
  })
}).listen(8788)

async function mockGoogle(ctx) {
  await ctx.route('https://www.googleapis.com/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const json = (o, s = 200) => route.fulfill({ status: s, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(o) })
    const fm = () => ({ id: FILE.id, name: 'meal-duo-db.json', version: '1', modifiedTime: new Date().toISOString(), ownedByMe: true, owners: [{ emailAddress: 'anna@x.it' }], properties: { mealduo: 'db' }, capabilities: { canEdit: true, canShare: true } })
    if (p === '/drive/v3/about') return json({ user: { emailAddress: 'anna@x.it', displayName: 'anna' } })
    if (p === '/drive/v3/files' && req.method() === 'GET') return json({ files: FILE.content ? [fm()] : [] })
    if (p === '/upload/drive/v3/files' && req.method() === 'POST') {
      const parts = (req.postData() || '').split(/--mealduo\w+/).filter((x) => x.includes('Content-Type'))
      FILE.content = parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''); return json(fm())
    }
    if (/^\/(upload\/)?drive\/v3\/files\/[\w-]+$/.test(p)) {
      if (req.method() === 'PATCH') { FILE.content = req.postData(); return json(fm()) }
      if (url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: FILE.content })
      return json(fm())
    }
    if (/\/permissions/.test(p)) return json({ permissions: [{ id: 'p', emailAddress: 'anna@x.it', role: 'owner' }] })
    return json({ error: { message: 'unmocked ' + p } }, 500)
  })
}

async function open(browser, hash = '') {
  const ctx = await browser.newContext({ ...devices['iPhone 14'], locale: 'it-IT', serviceWorkers: 'block' })
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('mealduo:session')) localStorage.setItem('mealduo:session', 'a'.repeat(40)) } catch {} })
  await mockGoogle(ctx)
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message))
  await page.goto('http://localhost:4174/' + hash); await page.waitForTimeout(1800)
  return { ctx, page, errs }
}
const openCard = async (page) => {
  await page.getByRole('button', { name: 'Impostazioni', exact: true }).first().click(); await page.waitForTimeout(500)
  await page.getByText('Promemoria pasti', { exact: true }).first().click(); await page.waitForTimeout(900)
}

;(async () => {
  const browser = await chromium.launch()

  // ----- Worker vecchio: il campo `reminders` manca → «non disponibile» -----
  W.reminders = false
  let a = await open(browser)
  await a.page.getByRole('button', { name: 'Crea famiglia', exact: true }).click(); await a.page.waitForTimeout(2200)
  await openCard(a.page)
  ok(await a.page.getByText(/Servono il server delle notifiche aggiornato/).count() === 1, 'Worker senza promemoria: la scheda dice che non è disponibile (non «spento»)')
  await a.ctx.close()

  // ----- Worker aggiornato, cron che non gira -----
  W.reminders = true
  a = await open(browser)
  await openCard(a.page)
  ok(await a.page.getByText('Nessun promemoria a orario.').count() === 1, 'scheda caricata dal Worker (nessun promemoria)')
  await a.page.getByRole('button', { name: 'Orari tipici', exact: true }).click(); await a.page.waitForTimeout(300)
  const meals = await a.page.getByRole('combobox', { name: 'Pasto' }).evaluateAll((els) => els.map((e) => e.value))
  ok(JSON.stringify(meals) === JSON.stringify(['Colazione', 'Pranzo', 'Cena']), 'orari tipici: colazione, pranzo e cena dal piano (' + meals.join(', ') + ')')
  const times = a.page.getByLabel('Orario')
  await times.nth(1).fill('12:30')
  await a.page.getByRole('group', { name: 'Giorni' }).nth(1).getByRole('button', { name: 'Sab' }).click()
  await a.page.getByRole('button', { name: 'Salva promemoria', exact: true }).click(); await a.page.waitForTimeout(700)
  const s = W.saved
  ok(s && s.fileId === FILE.id && typeof s.tz === 'string' && s.tz.length > 2, 'salvataggio: file e fuso orario del dispositivo (' + (s && s.tz) + ')')
  ok(s && s.rules.length === 3 && s.rules[1].meal === 'Pranzo' && s.rules[1].time === '12:30', 'salvataggio: pranzo alle 12:30')
  ok(s && JSON.stringify(s.rules[1].days) === JSON.stringify([0, 1, 2, 3, 4, 6]), 'salvataggio: giorni = tutti tranne sabato (' + (s && JSON.stringify(s.rules[1].days)) + ')')
  ok(s && s.texts.title === 'È ora di {meal}' && s.texts.titleAny === 'È ora di mangiare', 'salvataggio: testi con il segnaposto {meal}')
  ok(await a.page.getByRole('alert').filter({ hasText: 'non sta eseguendo gli orari' }).count() === 1, 'senza battito del cron l\'app avvisa che il server non sta eseguendo gli orari')

  // ----- indirizzo per le automazioni -----
  await a.page.getByRole('button', { name: "Crea l'indirizzo per le automazioni" }).click(); await a.page.waitForTimeout(700)
  const url1 = await a.page.getByTestId('reminder-url').innerText()
  ok(url1 === `http://localhost:8788/reminder/in/${W.token}`, 'indirizzo personale mostrato (senza pasto)')
  await a.page.getByRole('combobox', { name: 'Pasto di questa automazione' }).selectOption('Cena')
  const url2 = await a.page.getByTestId('reminder-url').innerText()
  ok(url2 === `http://localhost:8788/reminder/in/${W.token}?meal=Cena`, 'scegliendo il pasto l\'indirizzo diventa «?meal=Cena»')
  const r = await (await fetch(url2, { method: 'POST' })).json()
  ok(JSON.stringify(Object.keys(r).sort()) === JSON.stringify(['failed', 'ok', 'removed', 'sent']), 'la chiamata dell\'automazione risponde solo con numeri')
  ok(await a.page.getByText('Comandi', { exact: false }).count() > 0, 'istruzioni per Comandi presenti')

  // ----- prova -----
  await a.page.getByRole('button', { name: 'Invia un promemoria di prova' }).click(); await a.page.waitForTimeout(700)
  ok(await a.page.getByText(/Prova inviata dal server/).count() === 1 && await a.page.getByText(/Riso basmati 90g/).count() === 1, 'prova: esito vero del server e anteprima del testo')
  W.sent = 0
  await a.page.getByRole('button', { name: 'Invia un promemoria di prova' }).click(); await a.page.waitForTimeout(700)
  ok(await a.page.getByText(/nessun dispositivo iscritto/).count() === 1, 'prova con 0 dispositivi: lo dice (non finge)')

  // ----- revoca -----
  await a.page.getByRole('button', { name: 'Disattiva', exact: true }).click(); await a.page.waitForTimeout(600)
  ok(!W.hasToken && await a.page.getByRole('button', { name: "Crea l'indirizzo per le automazioni" }).count() === 1, 'disattivato: l\'indirizzo smette di funzionare')
  ok((await fetch(url2, { method: 'POST' })).status === 404, 'la vecchia chiamata ora dà 404')
  await a.ctx.close()

  // ----- cron che gira: niente avviso, regole ricaricate dal Worker -----
  W.lastRunAt = Date.now() - 10 * 60_000
  const b = await open(browser)
  await openCard(b.page)
  ok(await b.page.getByRole('alert').count() === 0 && await b.page.getByLabel('Orario').count() === 3, 'con il cron che gira: nessun avviso e le regole salvate tornano')
  ok(b.errs.length === 0 && a.errs.length === 0, 'nessun errore di pagina')
  await b.ctx.close()

  await browser.close(); worker.close()
  if (failures) { console.log(`\n${failures} controlli falliti`); process.exit(1) }
  console.log('\ntutto ok')
})().catch((e) => { console.error(e); process.exit(1) })

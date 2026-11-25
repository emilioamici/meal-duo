/**
 * End-to-end del layout responsive (Playwright, modalità demo locale): telefono, tablet e PC, navigazione da tastiera e da mouse.
 * Si lancia con `npm run e2e` (insieme alla condivisione).
 */
const { chromium } = require('playwright')

let failures = 0
const ok = (c, m) => { console.log(c ? 'ok  :' : 'FAIL:', m); if (!c) failures++ }

const SIZES = [
  ['telefono 390×844', 390, 844, true],
  ['tablet verticale 820×1180', 820, 1180, false],
  ['tablet orizzontale 1024×768', 1024, 768, false],
  ['PC 1440×900', 1440, 900, false],
]

async function open(browser, w, h, touch) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'it-IT', serviceWorkers: 'block', hasTouch: touch, isMobile: touch })
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message))
  await page.goto('http://localhost:4174/'); await page.waitForTimeout(900)
  await page.getByText('Prova senza account', { exact: false }).first().click(); await page.waitForTimeout(900)
  return { ctx, page, errs }
}
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false)

;(async () => {
  const browser = await chromium.launch()

  for (const [name, w, h, touch] of SIZES) {
    const { ctx, page, errs } = await open(browser, w, h, touch)
    const wide = w >= 768
    const side = await visible(page, 'aside')
    const bottom = await page.locator('nav.glass').first().isVisible().catch(() => false)
    ok(side === wide && bottom === !wide, `${name}: ${wide ? 'barra laterale' : 'barra in basso'}`)
    for (const label of ['Oggi', 'Settimana', 'Spesa', 'Impostazioni']) {
      await page.getByRole('button', { name: label, exact: true }).first().click(); await page.waitForTimeout(450)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      ok(overflow <= 0, `${name} · ${label}: nessuno scorrimento orizzontale`)
    }
    if (wide) {
      await page.getByRole('button', { name: 'Oggi', exact: true }).first().click(); await page.waitForTimeout(450)
      const xs = await page.locator('section.card').evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))])
      ok(xs.length >= 2, `${name} · Oggi: i pasti stanno su più colonne (${xs.length})`)
    }
    ok(errs.length === 0, `${name}: nessun errore di pagina`)
    await ctx.close()
  }

  // PC: tastiera e mouse
  const { ctx, page } = await open(browser, 1280, 800, false)
  await page.keyboard.press('3'); await page.waitForTimeout(450)
  ok(await page.getByRole('heading', { name: 'Spesa' }).count() === 1, 'tastiera: il tasto 3 apre la Spesa')
  await page.keyboard.press('1'); await page.waitForTimeout(450)
  ok(await page.getByRole('heading', { name: 'Oggi' }).count() === 1, 'tastiera: il tasto 1 apre Oggi')
  await page.getByRole('button', { name: 'Spesa', exact: true }).first().click(); await page.waitForTimeout(450)
  const q = page.getByRole('textbox', { name: /Quantità di Banana/ }); await q.click(); await page.keyboard.press('1'); await page.waitForTimeout(250)
  ok(await page.getByRole('heading', { name: 'Spesa' }).count() === 1, 'tastiera: digitando in un campo i numeri non cambiano schermata')
  await page.locator('body').click({ position: { x: 700, y: 20 } })
  await page.getByRole('button', { name: 'Oggi', exact: true }).first().focus(); await page.keyboard.press('Tab')
  ok(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Settimana', 'tastiera: Tab scorre le voci della barra laterale')
  await page.getByRole('button', { name: 'Spesa', exact: true }).first().click(); await page.waitForTimeout(450)
  const row = page.getByRole('textbox', { name: /Quantità di Bresaola/ }).locator('xpath=ancestor::li[1]')
  await row.scrollIntoViewIfNeeded(); await row.hover(); await page.waitForTimeout(250)
  const del = row.getByRole('button', { name: 'Rimuovi Bresaola' }).last()
  ok(await del.isVisible(), 'mouse: il cestino compare al passaggio sulla riga')
  await del.click(); await page.waitForTimeout(500)
  ok(await page.getByText(/1 articolo eliminato/).count() === 1, 'mouse: il cestino elimina la riga')
  await page.getByRole('button', { name: 'Oggi', exact: true }).first().click(); await page.waitForTimeout(450)
  await page.getByRole('button', { name: /Aggiungi alimento a/ }).first().click(); await page.waitForTimeout(500)
  const dlg = await page.getByRole('dialog').boundingBox()
  ok(!!dlg && dlg.x > 250 && dlg.x + dlg.width < 1030, 'i fogli sono finestre centrate su schermo largo')
  await page.keyboard.press('Escape'); await page.waitForTimeout(900)
  await page.keyboard.press('2'); await page.waitForTimeout(450)
  ok(await page.getByRole('heading', { name: 'Settimana' }).count() === 1, 'tastiera: chiuso il foglio i tasti tornano a funzionare')
  await ctx.close()

  await browser.close()
  if (failures) { console.log(`\n${failures} controlli falliti`); process.exit(1) }
  console.log('\ntutto ok')
})().catch((e) => { console.error(e); process.exit(1) })

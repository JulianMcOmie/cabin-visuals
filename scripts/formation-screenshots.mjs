// Real Particle screenshots plus browser control checks. Start a dev server first.
// BASE=http://localhost:3198 OUTPUT_DIR=/tmp/formations node scripts/formation-screenshots.mjs fractal
// Choices: fractal, wallpaper, parametricPattern (Lissajous), scatter.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
const output = process.env.OUTPUT_DIR ?? resolve('artifacts/formations')
mkdirSync(output, { recursive: true })
const id = process.argv[2] ?? 'fractal'
const demos = { scatter: { name: 'Scatter', params: { distribution: 2, copies: 90, spread: 2.3, seed: 42 }, color: '#34d399', size: .06 }, parametricPattern: { name: 'Parametric Pattern', params: { pattern: 6, copies: 180, radius: 2.2, amount: .8, frequencyA: 3, frequencyB: 2, phaseDegrees: 0 }, color: '#67e8f9', size: .035 }, wallpaper: { name: 'Wallpaper', params: { mode: 3, rows: 3, columns: 4, spacing: 1.25, offsetX: .25, offsetY: .12 }, color: '#fb923c', size: .065 }, fractal: { name: 'Fractal', params: { pattern: 0, depth: 3, branches: 5, shrink: .42, angle: 36, spread: 1.4 }, color: '#c084fc', size: .2 } }
const demo = demos[id]
if (!demo) throw new Error(`Unknown formation: ${id}`)
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.goto(`${process.env.BASE ?? 'http://localhost:3198'}/editor`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__cabinStores, null, { timeout: 120000 })
await page.evaluate(({ id, demo }) => {
  const p = window.__cabinStores.project.getState()
  const scene = Object.values(p.scenes).find(s => !s.isMain)
  p.setActiveScene(scene.id)
  const common = { muted: false, solo: false, blocks: [], childIds: [], color: '#7dd3fc' }
  p.addTrack({ ...common, id: 'hex-particle', name: 'Particle', type: 'base', instrumentId: 'particle', params: { size: demo.size, glow: .5 }, stringParams: { color: demo.color } })
  p.addTrack({ ...common, id: 'hex-grid', name: demo.name, type: 'splitter', instrumentId: '', splitterId: id, parentId: 'hex-particle', inputValues: demo.params })
  const u = window.__cabinStores.ui.getState()
  u.setCanvasView('scene')
  u.setSelectedTrackId('hex-grid')
  u.setTopPanelFraction(0.76)
  for (const t of Object.values(window.__cabinStores.project.getState().tracks)) if (t.name === 'Lighting') u.setTrackCollapsed(t.id, true)
}, { id, demo })
const panelId = id === 'parametricPattern' ? 'lissajous' : id
await page.getByTestId(`${panelId}-user-interface`).waitFor()
const stored = () => page.evaluate(() => window.__cabinStores.project.getState().tracks['hex-grid'].inputValues)
if (id === 'fractal') {
  await page.getByRole('radio', { name: 'Branches', exact: true }).click()
  assert.equal((await stored()).pattern, 1)
  await page.getByRole('radio', { name: 'Snowflake', exact: true }).click()
  assert.equal((await stored()).pattern, 0)
} else if (id === 'wallpaper') {
  await page.getByRole('radio', { name: 'Mirror', exact: true }).click()
  assert.equal((await stored()).mode, 1)
  await page.getByRole('radio', { name: 'Quarter-turn', exact: true }).click()
  assert.equal((await stored()).mode, 3)
} else if (id === 'parametricPattern') {
  await page.getByRole('button', { name: 'Figure eight', exact: true }).click()
  assert.equal((await stored()).frequencyA, 1)
  assert.equal((await stored()).frequencyB, 2)
  await page.getByRole('button', { name: 'Weave', exact: true }).click()
  assert.equal((await stored()).frequencyA, 3)
  assert.equal((await stored()).frequencyB, 2)
  assert.equal((await stored()).phaseDegrees, 0)
} else if (id === 'scatter') {
  await page.getByRole('radio', { name: 'Clustered', exact: true }).click()
  assert.equal((await stored()).distribution, 1)
  await page.getByRole('slider', { name: /^clusters$/i }).waitFor({ state: 'visible' })
  await page.getByRole('radio', { name: 'Uniform', exact: true }).click()
  assert.equal((await stored()).distribution, 0)
  await page.getByRole('radio', { name: 'Even', exact: true }).click()
  assert.equal((await stored()).distribution, 2)
  await page.getByRole('slider', { name: /^clusters$/i }).waitFor({ state: 'hidden' })
}
await page.waitForTimeout(3000)
console.log(await page.evaluate(() => ({ three: !!window.__three, panel: document.querySelector('[data-testid$=user-interface]')?.textContent })))
await page.screenshot({ path: join(output, `particle-${id}.png`) })
await browser.close()
assert.deepEqual(errors, [], 'No page errors during the Particle demonstration')

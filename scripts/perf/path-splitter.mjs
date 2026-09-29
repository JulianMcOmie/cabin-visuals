import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = process.env.BASE ?? 'http://127.0.0.1:3312'
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } })
const errors = []
page.on('pageerror', error => errors.push(String(error)))
page.setDefaultTimeout(60000)
try {
  await page.route(/supabase\.co\/(rest|auth|storage)/, route => route.abort())
  await page.goto(`${base}/editor`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__cabinStores && !!window.__three)
  await page.evaluate(() => {
    const store = window.__cabinStores.project, p = store.getState()
    const common = { color: '#62d8f5', muted: false, solo: false, blocks: [] }
    const tracks = {
      base: { ...common, id: 'base', name: 'Cube', type: 'base', instrumentId: 'cube', childIds: ['path'], params: { size: 0.4 } },
      path: { ...common, id: 'path', name: 'Path', type: 'splitter', splitterId: 'path', parentId: 'base', childIds: [], inputValues: { bend: 1, amplitude: 0.3 }, stringParams: {} },
    }
    const rootTrackIds = ['base']
    store.setState({ tracks, rootTrackIds, scenes: { ...p.scenes, [p.activeSceneId]: { ...p.scenes[p.activeSceneId], tracks, rootTrackIds, isMain: false } } })
    window.__cabinStores.ui.setState({ selectedTrackId: 'path', selectedTrackIds: new Set(['path']), canvasView: 'scene', topPanelFraction: 0.85 })
  })
  const panel = page.getByTestId('path-user-interface')
  await panel.waitFor()
  await page.waitForFunction(() => window.__cabinVisual.getVisualCopies('base').length === 12)
  const appearance = await page.evaluate(() => window.__cabinVisual.getVisualCopies('base')
    .map(copy => ({ size: Math.hypot(...copy.transform.elements.slice(0, 3)), tint: copy.colorShift.tint, opacity: copy.opacity })))
  assert.ok(appearance[0].size < appearance[11].size)
  assert.notEqual(appearance[0].tint, appearance[11].tint)
  assert.ok(appearance[11].opacity > 0 && appearance[11].opacity < appearance[10].opacity)
  assert.equal(await panel.getByRole('radio', { name: 'Repeat', exact: true }).getAttribute('aria-checked'), 'true')
  await panel.getByRole('radio', { name: 'Forward', exact: true }).click()
  await page.evaluate(() => window.__cabinStores.time.getState().setCurrentBeat(100))
  await page.waitForFunction(() => window.__cabinVisual.getVisualCopies('base').some(c => c.opacity > 0))
  await panel.getByRole('radio', { name: 'Once', exact: true }).click()
  await page.waitForFunction(() => window.__cabinStores.project.getState().tracks.path.inputValues.repeat === 0
    && window.__cabinVisual.getVisualCopies('base').every(c => c.opacity === 0))
  await panel.getByRole('radio', { name: 'Repeat', exact: true }).click()
  await page.waitForFunction(() => window.__cabinStores.project.getState().tracks.path.inputValues.repeat === 1
    && window.__cabinVisual.getVisualCopies('base').some(c => c.opacity > 0))
  await page.evaluate(() => window.__cabinStores.time.getState().setCurrentBeat(0))
  await panel.getByRole('radio', { name: 'Loop', exact: true }).click()
  await page.waitForFunction(() => window.__cabinStores.project.getState().tracks.path.inputValues.pathMode === 1)
  assert.equal(await panel.getByRole('slider', { name: 'End fade (path fraction)', exact: true }).count(), 0)
  assert.equal(await panel.getByRole('radio', { name: 'Repeat', exact: true }).count(), 0)
  await panel.getByRole('radio', { name: 'Forward', exact: true }).click()
  await page.waitForFunction(() => window.__cabinStores.project.getState().tracks.path.inputValues.motion === 1)
  const speed = panel.getByRole('slider', { name: 'Speed (units/beat)', exact: true })
  await speed.focus(); await speed.press('ArrowUp')
  await page.waitForFunction(() => window.__cabinStores.project.getState().tracks.path.inputValues.speed > 1)
  await page.waitForFunction(() => {
    const canvas = document.querySelector('[data-testid="path-preview"] canvas')
    return canvas && canvas.width > 0 && [...canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data].some((v, i) => i % 4 === 3 && v > 0)
  })
  await page.getByTestId('path-preview').scrollIntoViewIfNeeded()
  await panel.screenshot({ path: '/tmp/path-splitter-loop.png' })
  await panel.getByRole('radio', { name: 'Open', exact: true }).click()
  await panel.getByRole('radio', { name: 'MIDI', exact: true }).click()
  await panel.getByRole('slider', { name: 'End fade (path fraction)', exact: true }).focus()
  await panel.getByRole('slider', { name: 'End fade (path fraction)', exact: true }).press('ArrowUp')
  await page.waitForFunction(() => window.__cabinStores.project.getState().tracks.path.inputValues.fadeEnd > 0.2)
  await page.getByTestId('path-preview').scrollIntoViewIfNeeded()
  await panel.screenshot({ path: '/tmp/path-splitter-open.png' })
  assert.deepEqual(errors, [])
  console.log('PASS: Repeat persists and remains visible after many cycles; Once exits; closed loops hide Repeat; motion, speed and fade controls save; preview paints; no runtime errors.')
} catch (error) {
  await page.screenshot({ path: '/tmp/path-splitter-failure.png' })
  console.error((await page.locator('body').innerText()).slice(-4000))
  throw error
} finally {
  await browser.close()
}

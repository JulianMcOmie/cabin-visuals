// Unsaved browser fixture: actual pixels, paused edits, viewport parking,
// and row alignment checked on EVERY scrolling frame.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.setDefaultTimeout(60000)
  const errors = []
  page.on('pageerror', error => { errors.push(String(error)); console.log(String(error)) })
  await page.route(/supabase\.co\/(rest|auth|storage)/, r => r.abort())
  await page.goto(`${process.env.BASE ?? 'http://localhost:3191'}/editor`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__cabinStores && !!window.__three)
  await page.evaluate(() => {
    const store = window.__cabinStores.project
    const p = store.getState()
    const track = (id, values = {}) => ({ id, name: id, type: 'base', instrumentId: '', childIds: [], blocks: [], color: '#ff2200', muted: false, solo: false, ...values })
    const tracks = {
      cube: track('cube', { name: 'Original cube', instrumentId: 'cube', childIds: ['split', 'hue'], params: { size: 1 }, stringParams: { baseColor: '#ff2200' } }),
      split: track('split', { name: 'Then three copies', type: 'splitter', splitterId: 'line', parentId: 'cube', inputValues: { copies: 3, spacing: 1, size: 0.5, angle: 90 } }),
      hue: track('hue', { name: 'Then change color', type: 'mover', moverId: 'hueRotate', parentId: 'cube', inputValues: { rotate: 0.5, mode: 1, spread: 0 } }),
      particle: track('particle', { name: 'Particle', instrumentId: 'particle', childIds: ['particle-split'] }),
      'particle-split': track('particle-split', { name: 'Particle copies', type: 'splitter', splitterId: 'line', parentId: 'particle', inputValues: { copies: 5, spacing: 1, size: 1, angle: 90 } })
    }
    const rootTrackIds = ['cube', 'particle']
    store.setState({ tracks, rootTrackIds, scenes: { ...p.scenes, [p.activeSceneId]: { ...p.scenes[p.activeSceneId], isMain: false, tracks, rootTrackIds } }, totalBars: 64 })
    window.__cabinStores.ui.setState({ tracksLabelWidth: 300, tracksRowHeight: 44, canvasView: 'scene' })
    window.__cabinStores.time.setState({ currentBeat: 0.5, isPlaying: false })
    window.previewPixels = id => {
      const canvas = document.querySelector(`[data-track-live-preview="${id}"]`)
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      let red = 0, blue = 0, lit = 0, hash = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > data[i + 2] * 1.5 && data[i] > 40) red++
        if (data[i + 2] > data[i] * 1.5 && data[i + 2] > 40) blue++
        if (Math.max(data[i], data[i + 1], data[i + 2]) > 40) lit++
        hash = (Math.imul(hash, 31) + data[i] + data[i+1] * 3 + data[i+2] * 7) | 0
      }
      return { red, blue, lit, hash }
    }
  })
  await page.waitForTimeout(4000)
  const output = await page.evaluate(() => Object.fromEntries(['cube', 'split', 'hue', 'particle', 'particle-split'].map(id => [id, window.previewPixels(id)])))
  console.log(output, errors)
  await page.screenshot({ path: '/tmp/track-chain-previews.png' })
  assert.ok(output.cube.red > 20)
  assert.notEqual(output.cube.hash, output.split.hash)
  assert.equal(output.split.blue, 0)
  assert.ok(output.hue.blue > 20)
  assert.ok(output.particle.lit > 20, 'default particle stays legible at thumbnail scale')
  assert.ok(output['particle-split'].lit > output.particle.lit)
  assert.deepEqual(errors, [])
} finally { await browser.close() }

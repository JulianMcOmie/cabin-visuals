// Cold poster paint, decoder handoff, scrolling and folder continuity in an
// unsaved browser session. Does not write to the project or remote storage.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const base = process.env.BASE || 'http://localhost:3201'
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const errors = []
const folder = (page, name) => page.locator('[data-library-scroll]').getByText(name, { exact: true }).click()
try {
  const cold = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  cold.on('pageerror', e => errors.push(String(e)))
  await cold.route(/supabase\.co\/storage\//, route => route.abort())
  await cold.route('**/instrument-previews/*.webp', route => route.abort())
  await cold.goto(`${base}/editor`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await cold.waitForFunction(() => !!window.__cabinStores)
  await cold.locator('[data-library-scroll]').getByText('Objects', { exact: true }).waitFor()
  await cold.evaluate(() => {
    document.addEventListener('click', () => { window.__previewClickedAt = performance.now() }, { once: true, capture: true })
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-instrument-preview]')) {
        window.__previewMountedAt = performance.now()
        observer.disconnect()
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })
  await folder(cold, 'Objects')
  await cold.waitForFunction(() => {
    const cards = [...document.querySelectorAll('[data-instrument-preview]')]
    return cards.length > 0 && cards.every(card => card.querySelector('canvas') || card.style.backgroundImage.includes('data:image/webp'))
  })
  console.log('All Objects previews have inline stills with storage AND image requests blocked; click-to-card:', await cold.evaluate(() => Math.round(window.__previewMountedAt - window.__previewClickedAt)), 'ms')
  await cold.screenshot({ path: '/tmp/instant-preview-check/offline-objects.png' })
  assert.ok(await cold.locator('[data-instrument-preview="cube"] img').count())
  await cold.close()

  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(`${base}/editor`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForFunction(() => !!window.__cabinStores)
  await folder(page, 'Objects')
  const cube = page.locator('[data-instrument-preview="cube"] video')
  await cube.waitFor()
  await page.waitForFunction(() => {
    const v = document.querySelector('[data-instrument-preview="cube"] video')
    return v && v.currentTime > 0.5 && !v.paused && getComputedStyle(v).opacity === '1'
  }, undefined, { timeout: 30000 })
  console.log('Video handoff:', await cube.evaluate(v => ({ time: v.currentTime, opacity: getComputedStyle(v).opacity, playing: !v.paused })))
  const scroller = page.locator('[data-library-scroll]')
  await scroller.evaluate(e => { e.scrollTop = e.scrollHeight })
  await page.waitForFunction(() => document.querySelector('[data-instrument-preview="cube"] video')?.paused)
  const pausedAt = await cube.evaluate(v => v.currentTime)
  await scroller.evaluate(e => { e.scrollTop = 0 })
  await page.waitForFunction(() => !document.querySelector('[data-instrument-preview="cube"] video')?.paused)
  assert.ok(await cube.evaluate((v, time) => v.currentTime >= time, pausedAt))
  console.log('Offscreen playback parks and resumes at', pausedAt)
  await page.getByRole('button', { name: 'Back to the library' }).click()
  await folder(page, 'Objects')
  await page.waitForFunction(() => [...document.querySelectorAll('[data-instrument-preview="cube"] img')].some(img => img.src.startsWith('data:image/webp')))
  await page.waitForFunction(() => {
    const v = document.querySelector('[data-instrument-preview="cube"] video')
    return v && v.currentTime > 0.5 && getComputedStyle(v).opacity === '1'
  })
  console.log('Folder return restores cached frame and playback position')
  await page.screenshot({ path: '/tmp/instant-preview-check/playing-objects.png' })
  const capture = await browser.newPage()
  await capture.goto(`${base}/dev/instrument-previews`, { timeout: 120000 })
  await capture.waitForFunction(() => !!window.__instrumentPreviewIds)
  const { readFile } = await import('node:fs/promises')
  const posters = JSON.parse(await readFile(new URL('../../src/components/instrumentPreviewPosters.json', import.meta.url), 'utf8'))
  const ids = await capture.evaluate(() => window.__instrumentPreviewIds)
  assert.deepEqual(ids.filter(id => !posters[id]?.placeholder), [], 'every capturable instrument has an immediate still')
  console.log('All', ids.length, 'current 3D instrument previews have bundled stills')
  assert.deepEqual(errors, [])
} finally { await browser.close() }

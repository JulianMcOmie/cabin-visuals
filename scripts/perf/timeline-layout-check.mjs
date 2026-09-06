// Regression check for grid-sized track rows: nested brackets, tag thresholds,
// sticky labels, and collapse/expand. Uses only an unsaved in-memory fixture.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.setDefaultTimeout(60000)
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.route(/supabase\.co\/(rest|auth|storage)/, r => r.abort())
  await page.goto(`${process.env.BASE ?? 'http://localhost:3091'}/editor`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__cabinStores && !!window.__three)
  await page.evaluate(() => {
    const store = window.__cabinStores.project
    const p = store.getState()
    const base = id => ({ id, name: id, type: 'base', parentId: null, childIds: [], params: {}, stringParams: {}, color: '#65aaff', muted: false, solo: false, blocks: [] })
    const tracks = {
      outer: { ...base('outer'), type: 'group', childIds: ['tagged', 'inner'] },
      tagged: { ...base('tagged'), parentId: 'outer', instrumentId: 'cube', tags: ['perf-tag'] },
      inner: { ...base('inner'), type: 'group', parentId: 'outer', childIds: ['a', 'b'] },
      a: { ...base('a'), parentId: 'inner' },
      b: { ...base('b'), parentId: 'inner' },
      last: base('last'),
    }
    const rootTrackIds = ['outer', 'last']
    store.setState({ tracks, rootTrackIds, scenes: { ...p.scenes, [p.activeSceneId]: { ...p.scenes[p.activeSceneId], isMain: false, tracks, rootTrackIds } }, totalBars: 64 })
  })
  await page.waitForFunction(() => document.querySelectorAll('[data-track-lane]').length === 6)
  const checkRows = async (ids, descendants) => {
    const actual = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-track-lane]')].map(lane => {
        const row = lane.parentElement
        const rect = row.getBoundingClientRect()
        const strip = row.querySelector('span.bg-inherit')
        return { id: lane.dataset.trackLane, top: rect.top, height: rect.height, strip: strip?.getBoundingClientRect().height ?? null }
      })
      return { rows, height: window.__cabinStores.ui.getState().tracksRowHeight }
    })
    assert.deepEqual(actual.rows.map(r => r.id), ids)
    for (let i = 0; i < actual.rows.length; i++) {
      const row = actual.rows[i]
      assert.ok(Math.abs(row.height - actual.height) < 0.02, `${row.id} row height`)
      if (i) assert.ok(Math.abs(row.top - actual.rows[i - 1].top - actual.height) < 0.02, `${row.id} row spacing`)
      if (descendants[row.id]) assert.ok(Math.abs(row.strip - descendants[row.id] * actual.height) < 0.02, `${row.id} bracket span`)
    }
  }
  for (const height of [28, 44.5, 63, 64, 96]) {
    await page.evaluate(height => window.__cabinStores.ui.getState().setTracksRowHeight(height), height)
    await page.waitForTimeout(220)
    await checkRows(['outer', 'tagged', 'inner', 'a', 'b', 'last'], { outer: 4, inner: 2 })
    assert.equal(await page.getByText('perf-tag', { exact: true }).count(), height >= 64 ? 1 : 0)
  }
  await page.evaluate(() => document.querySelector('[data-tracks-scroll]').scrollLeft = 500)
  await page.waitForTimeout(100)
  const labelOffset = await page.evaluate(() => {
    const sc = document.querySelector('[data-tracks-scroll]')
    const label = document.querySelector('[data-track-lane="tagged"]').parentElement.firstElementChild
    return label.getBoundingClientRect().left - sc.getBoundingClientRect().left
  })
  assert.ok(Math.abs(labelOffset) < 0.02, 'labels remain sticky under horizontal scroll')
  await page.evaluate(() => window.__cabinStores.ui.getState().setTrackCollapsed('inner', true))
  await page.waitForTimeout(100)
  await checkRows(['outer', 'tagged', 'inner', 'last'], { outer: 2 })
  await page.evaluate(() => window.__cabinStores.ui.getState().setTrackCollapsed('outer', true))
  await page.waitForTimeout(100)
  await checkRows(['outer', 'last'], {})
  await page.evaluate(() => { const ui = window.__cabinStores.ui.getState(); ui.setTrackCollapsed('outer', false); ui.setTrackCollapsed('inner', false) })
  await page.waitForTimeout(100)
  await checkRows(['outer', 'tagged', 'inner', 'a', 'b', 'last'], { outer: 4, inner: 2 })
  assert.deepEqual(errors, [])
  console.log('PASS: row geometry, nested bracket spans, tag threshold, sticky labels, collapse/expand')
} finally { await browser.close() }

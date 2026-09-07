import { chromium } from 'playwright'
import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
const bundle = await build({
  entryPoints: ['scripts/perf/glow-fixture.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
})
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } }),
    errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.route('http://glow.test/', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<html><body style="margin:0;background:#03040a"></body></html>',
    }),
  )
  await page.goto('http://glow.test/')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const results = await page.evaluate(() => window.glowResults)
  mkdirSync('artifacts/glow', { recursive: true })
  await page.screenshot({ path: 'artifacts/glow/render-fixture.png' })
  const presets = await page.evaluate(() => window.glowPresetCaptures ?? {})
  for (const [name, url] of Object.entries(presets))
    writeFileSync(
      `artifacts/glow/preset-${name.toLowerCase().replaceAll(' ', '-')}.png`,
      Buffer.from(url.split(',')[1], 'base64'),
    )
  writeFileSync('artifacts/glow/gpu-results.json', JSON.stringify({ results, errors }, null, 2))
  console.log(JSON.stringify({ results, errors }, null, 2))
  if (errors.length || !results) process.exitCode = 1
} finally {
  await browser.close()
}

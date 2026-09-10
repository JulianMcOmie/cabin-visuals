// Real worker smoke test, no account or database writes. Requires local listen
// and Chromium (npx playwright install chromium if it is not installed).
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import assert from 'node:assert/strict'

const directory = await mkdtemp(join(tmpdir(), 'cabin-thumbnail-'))
let browser, server
try {
  const outfile = join(directory, 'worker.js')
  await build({ entryPoints: ['src/editor/core/visual/preview.worker.ts'], outfile,
    bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' } })
  const code = await readFile(outfile)
  const fixture = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '-e',
    "const {doc,track,block,n}=require('./src/templates/builder.ts'); process.stdout.write(JSON.stringify(doc({bpm:120,tracks:[track({name:'Cube',instrumentId:'cube',blocks:[block(2,4,[n(0,60,4)])]})]})))"], { encoding: 'utf8' }))
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/worker.js' ? 'application/javascript' : 'text/html')
    response.end(request.url === '/worker.js' ? code : '<html><body>Thumbnail worker check</body></html>')
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const result = await page.evaluate(document => new Promise(resolve => {
    const worker = new Worker('/worker.js', { type: 'module' })
    const start = performance.now()
    let ticks = 0
    const interval = setInterval(() => ticks++, 10)
    const timeout = setTimeout(() => finish({ error: 'timeout' }), 15000)
    function finish(result) {
      worker.terminate(); clearInterval(interval); clearTimeout(timeout)
      resolve({ ...result, ticks, ms: performance.now() - start })
    }
    worker.onerror = event => finish({ error: event.message })
    worker.onmessage = async event => {
      if (event.data.kind !== 'thumbnail') return
      if (!event.data.image) { finish(event.data); return }
      const bitmap = await createImageBitmap(await (await fetch(event.data.image)).blob())
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d')
      ctx.drawImage(bitmap, 0, 0)
      const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
      let lit = 0
      for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 40) lit++
      finish({ width: bitmap.width, height: bitmap.height, lit })
      bitmap.close()
    }
    worker.postMessage({ kind: 'thumbnail', document })
  }), fixture)
  assert.equal(result.error, undefined)
  assert.equal(result.width, 320)
  assert.equal(result.height, 180)
  assert.ok(result.lit > 1000, 'A valid JPEG must contain the visible cube, not an empty WebGL buffer')
  assert.ok(result.ticks > 0, 'The browser thread must remain schedulable')
  console.log(JSON.stringify(result))
} finally {
  await browser?.close()
  if (server?.listening) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}

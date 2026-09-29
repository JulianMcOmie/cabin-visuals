// Open the printed URL in a normal visible browser and click Run validation.
// Serves production modules without browser automation or saved project edits.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'

const port = Number(process.env.PORT ?? 3302), directory = 'artifacts/particle-color-program'
await mkdir(directory, { recursive: true })
const bundle = await build({ entryPoints: ['scripts/perf/particle-color-program-gpu-fixture.ts'],
  bundle: true, write: false, platform: 'browser', format: 'esm',
  define: { 'process.env.NODE_ENV': '"production"' } })
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Particle color program GPU validation</title>
<style>body{background:#10141a;color:#e9f0f7;font:16px system-ui;margin:24px}button{font:inherit;padding:12px 18px}p{max-width:850px;line-height:1.5}canvas{display:block;max-width:100%;margin-top:20px}pre{font:13px ui-monospace,monospace;white-space:pre-wrap}</style>
<h1>Particle color program GPU validation</h1><p>Compares all five production colorizers on the compact Particle shader against expanded CPU references. Covers palette lookups, perceptual mixing, full appearance composition, spatial and copy-index mapping at intermediate stages, nested transforms, notes, automation-compatible sampling and seeks. Optional large-population timing keeps each colorizer after all splitters. Keep this tab visible while measuring.</p><label><input id="measure" type="checkbox" checked>Measure 32K and million-particle colorizer populations</label>
<button>Run validation</button><pre>Ready. Results save to artifacts/particle-color-program/gpu.json.</pre><script type="module" src="/fixture.js"></script></html>`
createServer(async (req, res) => {
  try {
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return }
    if (req.url === '/results' && req.method === 'POST') {
      const chunks = []; let size = 0
      for await (const chunk of req) { size += chunk.length; if (size > 2_000_000) { res.writeHead(413); res.end(); return } chunks.push(chunk) }
      const body = Buffer.concat(chunks).toString(), result = JSON.parse(body)
      await writeFile(`${directory}/gpu.json`, body)
      console.log(`Particle color program GPU results saved; pass=${result.pass}`)
      res.end('{"saved":true}'); return
    }
    res.setHeader('Content-Type', 'text/html'); res.end(html)
  } catch (error) { console.error(error); res.writeHead(500); res.end(String(error)) }
}).listen(port, '127.0.0.1', () => console.log(`Particle color program GPU validation ready: http://127.0.0.1:${port}`))

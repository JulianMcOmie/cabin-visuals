// Open the printed URL in a normal visible browser and click Run validation.
// Serves production modules without browser automation or saved project edits.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'

const port = Number(process.env.PORT ?? 3301), directory = 'artifacts/fluid-impact'
await mkdir(directory, { recursive: true })
const bundle = await build({ entryPoints: ['scripts/perf/fluid-impact-gpu-fixture.ts'],
  bundle: true, write: false, platform: 'browser', format: 'esm',
  define: { 'process.env.NODE_ENV': '"production"' } })
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Fluid Impact GPU validation</title>
<style>body{background:#10141a;color:#e9f0f7;font:16px system-ui;margin:24px}button{font:inherit;padding:12px 18px}p{max-width:850px;line-height:1.5}canvas{display:block;max-width:100%;margin-top:20px}pre{font:13px ui-monospace,monospace;white-space:pre-wrap}</style>
<h1>Fluid Impact GPU validation</h1><p>Compares the production Fluid Impact particle renderer with expanded CPU reference images. Covers overlapping notes, seeks, fluid parameter extremes, appearance, nested frames and placement. Optional timings measure 32,768 and 1,048,576 particles with the impact field after every splitter. Keep this tab visible while measuring.</p><label><input id="measure" type="checkbox" checked>Measure 32K and million-particle Fluid Impact populations</label>
<button>Run validation</button><pre>Ready. Results save to artifacts/fluid-impact/gpu.json.</pre><script type="module" src="/fixture.js"></script></html>`
createServer(async (req, res) => {
  try {
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return }
    if (req.url === '/results' && req.method === 'POST') {
      const chunks = []; let size = 0
      for await (const chunk of req) { size += chunk.length; if (size > 2_000_000) { res.writeHead(413); res.end(); return } chunks.push(chunk) }
      const body = Buffer.concat(chunks).toString(), result = JSON.parse(body)
      await writeFile(`${directory}/gpu.json`, body)
      console.log(`Fluid Impact GPU results saved; pass=${result.pass}`)
      res.end('{"saved":true}'); return
    }
    res.setHeader('Content-Type', 'text/html'); res.end(html)
  } catch (error) { console.error(error); res.writeHead(500); res.end(String(error)) }
}).listen(port, '127.0.0.1', () => console.log(`Fluid Impact GPU validation ready: http://127.0.0.1:${port}`))

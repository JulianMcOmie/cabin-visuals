// Normal-browser GPU validation. Open the printed URL and click Run validation.
// This starts no browser and edits no saved project or browser preference.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'

const port = Number(process.env.PORT ?? 3298)
const output = 'artifacts/radial-transforms'
await mkdir(output, { recursive: true })
const built = await build({
  entryPoints: ['scripts/perf/radial-transform-gpu-fixture.ts'], bundle: true,
  write: false, format: 'esm', platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const html = `<!doctype html><html lang="en"><meta charset="utf-8">
<title>Radial transform GPU validation</title>
<style>body{margin:24px;background:#10141a;color:#e9f0f7;font:16px system-ui}button{font:inherit;padding:12px 18px}pre{white-space:pre-wrap;font:13px ui-monospace,monospace}canvas{display:block;max-width:100%;margin-top:20px}p{max-width:850px;line-height:1.5}</style>
<h1>Radial transform GPU validation</h1>
<p>Compares expanded Particle quads with compact Particle quads across rotating and orbiting Radial chains, then checks picking and measures 32,768 and 1,048,576 particles. Keep this tab visible during the run. The benchmark measures the production renderer in isolation; it does not measure whole-editor FPS.</p>
<button>Run validation</button><pre>Ready. Results will be saved to artifacts/radial-transforms/gpu.json.</pre>
<script type="module" src="/fixture.js"></script></html>`
createServer(async (req, res) => {
  try {
    if (req.url === '/fixture.js') {
      res.setHeader('Content-Type', 'text/javascript'); res.end(built.outputFiles[0].contents); return
    }
    if (req.url === '/results' && req.method === 'POST') {
      const chunks = []; let length = 0
      for await (const chunk of req) {
        length += chunk.length
        if (length > 2_000_000) { res.writeHead(413); res.end('Result too large'); return }
        chunks.push(chunk)
      }
      const body = Buffer.concat(chunks).toString()
      const result = JSON.parse(body)
      await writeFile(`${output}/gpu.json`, body)
      console.log(`GPU validation saved: ${output}/gpu.json; pass=${result.pass}`)
      res.setHeader('Content-Type', 'application/json'); res.end('{"saved":true}'); return
    }
    res.setHeader('Content-Type', 'text/html'); res.end(html)
  } catch (error) {
    console.error(error); res.writeHead(500); res.end(String(error))
  }
}).listen(port, '127.0.0.1', () => console.log(`GPU validation ready: http://127.0.0.1:${port}`))

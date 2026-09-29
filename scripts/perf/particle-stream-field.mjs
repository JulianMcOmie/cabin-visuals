// Serve the production sampler/shader validation in a normal browser tab.
// Open the printed URL and click Run. No project document or browser settings change.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
const port = Number(process.env.PORT ?? 3295)
const out = 'artifacts/particle-stream-field'
await mkdir(out, { recursive: true })
const built = await build({ entryPoints: ['scripts/perf/particle-stream-field-fixture.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } })
const html = '<!doctype html><title>Particle Stream GPU validation</title><style>body{background:#111;color:#eee;font:16px system-ui}button{font:inherit;padding:12px}pre{white-space:pre-wrap}canvas{max-width:100%}</style><h1>Particle Stream GPU validation</h1><p>Compares the shared field with the existing renderer, then measures one and four million particles. This is a renderer benchmark, not whole-editor FPS.</p><button>Run validation</button><pre>Ready</pre><script type="module" src="/fixture.js"></script>'
createServer(async (req, res) => {
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(built.outputFiles[0].contents); return }
  if (req.url === '/results' && req.method === 'POST') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString(); JSON.parse(text)
    await writeFile(`${out}/results.json`, text); console.log(text); res.end('saved'); return
  }
  res.setHeader('Content-Type', 'text/html'); res.end(html)
}).listen(port, '127.0.0.1', () => console.log(`Validation ready: http://127.0.0.1:${port}`))

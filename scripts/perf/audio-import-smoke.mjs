// Import a synthetic 120bpm click track via "Load audio"; check duration + BPM land, and how long the main thread blocked.
import { chromium } from 'playwright'
import { writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// 24s mono 44.1k WAV: click every 0.5s (120 BPM), first click at 0.25s
const sr = 44100, secs = 24, n = sr * secs
const pcm = new Int16Array(n)
for (let t = 0.25; t < secs; t += 0.5) { const s0 = Math.floor(t * sr); for (let i = 0; i < 2000; i++) pcm[s0 + i] = Math.round(30000 * Math.exp(-i / 400) * Math.sin(i * 0.3)) }
const buf = Buffer.alloc(44 + n * 2)
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
Buffer.from(pcm.buffer).copy(buf, 44)
const wav = join(tmpdir(), 'click120.wav'); writeFileSync(wav, buf)

const BASE = process.env.BASE ?? 'http://localhost:3050'
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
await page.route(/supabase\.co\/(rest|auth|storage)/, (r) => r.abort())
const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__three && !!window.__cabinStores, null, { timeout: 60000 })
await page.evaluate(() => { window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration) }).observe({ type: 'longtask' }) })
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Load audio' }).click()])
const t0 = Date.now()
await chooser.setFiles(wav)
await page.waitForFunction(() => { const p = window.__cabinStores.project.getState(); return Object.values(p.tracks).some((t) => t.type === 'audio' && (t.audioBlocks?.[0]?.trimEnd ?? 0) > 0) }, null, { timeout: 30000 })
const res = await page.evaluate(() => { const p = window.__cabinStores.project.getState(); const t = Object.values(p.tracks).find((t) => t.type === 'audio'); return { bpm: p.bpm, trimStart: t.audioBlocks[0].trimStart, trimEnd: t.audioBlocks[0].trimEnd, longTasks: window.__lt.length, longTaskMax: Math.max(0, ...window.__lt).toFixed(0), longTaskTotal: window.__lt.reduce((a, b) => a + b, 0).toFixed(0) } })
console.log(`import took ${Date.now() - t0}ms`, res, 'errors:', errors.length ? errors : 'none')
await browser.close()

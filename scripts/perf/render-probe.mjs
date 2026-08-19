// Per-frame render-loop probe while a real project plays.
//   node scripts/perf/render-probe.mjs <project.json|template:<id>> [seconds]
// Reports averages per frame: WebGL draw calls / triangles, gl.render passes,
// render-target binds, texture uploads (count + MB), r3f frame JS ms, and the
// per-frame beat→state work. GPU speed under swiftshader is meaningless; the
// COUNTS and JS ms are what to compare across changes.
import { chromium } from 'playwright'
import { readFileSync } from 'fs'

const [src, secsArg] = process.argv.slice(2)
const secs = Number(secsArg ?? 6)
const BASE = process.env.BASE ?? 'http://localhost:3050'
const isTemplate = src.startsWith('template:')
const proj = isTemplate ? null : JSON.parse(readFileSync(src, 'utf8'))

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.route(/supabase\.co\/(rest|auth)/, (r) => r.abort())
await page.addInitScript(() => {
  // Wrap WebGL2 texture upload + framebuffer binds before any context exists.
  window.__gl = { texUploads: 0, texBytes: 0, fbBinds: 0, drawCalls: 0 }
  const P = WebGL2RenderingContext.prototype
  const wrap = (name, fn) => { const o = P[name]; P[name] = function (...a) { fn.call(this, ...a); return o.apply(this, a) } }
  const bytesOf = (w, h) => (typeof w === 'number' && typeof h === 'number' ? w * h * 4 : 0)
  wrap('texImage2D', function (...a) { window.__gl.texUploads++; if (a.length >= 9) window.__gl.texBytes += bytesOf(a[3], a[4]); else if (a[5] && a[5].width) window.__gl.texBytes += bytesOf(a[5].width, a[5].height) })
  wrap('texSubImage2D', function (...a) { window.__gl.texUploads++; if (a.length >= 9) window.__gl.texBytes += bytesOf(a[4], a[5]); else if (a[6] && a[6].width) window.__gl.texBytes += bytesOf(a[6].width, a[6].height) })
  wrap('bindFramebuffer', function () { window.__gl.fbBinds++ })
  window.__gl.tris = 0
  wrap('drawElements', function (mode, count) { window.__gl.drawCalls++; if (mode === 4) window.__gl.tris += count / 3 })
  wrap('drawArrays', function (mode, first, count) { window.__gl.drawCalls++; if (mode === 4) window.__gl.tris += count / 3 })
  wrap('drawElementsInstanced', function (mode, count, type, off, inst) { window.__gl.drawCalls++; if (mode === 4) window.__gl.tris += (count / 3) * inst })
  wrap('drawArraysInstanced', function (mode, first, count, inst) { window.__gl.drawCalls++; if (mode === 4) window.__gl.tris += (count / 3) * inst })
})
await page.goto(`${BASE}/editor${isTemplate ? `?template=${src.slice(9)}` : ''}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__three && !!window.__cabinStores && !!window.__cabinHydrate, null, { timeout: 90000 })
if (proj) await page.evaluate(async (p) => { await window.__cabinHydrate(p.document, p.name) }, proj)
await page.waitForTimeout(4000)
const info = await page.evaluate(() => { const p = window.__cabinStores.project.getState(); const tracks = Object.values(p.tracks); return { tracks: tracks.length, notes: tracks.reduce((a, t) => a + t.blocks.reduce((b, k) => b + k.notes.length, 0), 0), scenes: Object.keys(p.scenes).length } })
console.log('project:', proj?.name ?? src, info)

// Count screen frames (rAF ticks) and gl.render() passes; time the r3f frame
// by wrapping the renderer's render (first call in a rAF marks frame start).
await page.evaluate(() => {
  const st = window.__r3fState()
  const gl = st.gl
  window.__probe = { frames: 0, renders: 0 }
  const origRender = gl.render.bind(gl)
  gl.render = (...a) => { window.__probe.renders++; return origRender(...a) }
  const tick = () => { window.__probe.frames++; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
})
await page.evaluate(() => { window.__cabinStores.time.getState().setCurrentBeat(0); Object.assign(window.__gl, { texUploads: 0, texBytes: 0, fbBinds: 0, drawCalls: 0, tris: 0 }); window.__probe.frames = 0; window.__probe.renders = 0 })
// Time spent inside rAF callbacks per frame (main-thread frame cost) via long-task-free sampling: measure wall gaps.
await page.evaluate(() => { window.__gaps = []; let last = performance.now(); const t = () => { const n = performance.now(); window.__gaps.push(n - last); last = n; requestAnimationFrame(t) }; requestAnimationFrame(t) })
await page.keyboard.press('Space')
await page.waitForTimeout(secs * 1000)
await page.keyboard.press('Space')
const r = await page.evaluate((secs) => {
  const st = window.__r3fState(); const info = st.gl.info
  const p = window.__probe; const g = window.__gl
  const frames = Math.max(1, p.frames)
  const gaps = window.__gaps.slice().sort((a, b) => a - b)
  return {
    frames: p.frames, fps: (p.frames / secs).toFixed(1),
    frameMs_p50: gaps[Math.floor(gaps.length * 0.5)]?.toFixed(1), frameMs_p95: gaps[Math.floor(gaps.length * 0.95)]?.toFixed(1),
    drawCallsPerFrame: (g.drawCalls / frames).toFixed(0),
    kTrisPerFrame: (g.tris / frames / 1000).toFixed(0),
    glRenderPassesPerFrame: (p.renders / frames).toFixed(1),
    fbBindsPerFrame: (g.fbBinds / frames).toFixed(0),
    texUploadsPerFrame: (g.texUploads / frames).toFixed(2),
    texMBPerFrame: (g.texBytes / frames / 1e6).toFixed(2),
    programs: info.programs?.length, geometries: info.memory.geometries, textures: info.memory.textures,
  }
}, secs)
console.log(r)
await browser.close()

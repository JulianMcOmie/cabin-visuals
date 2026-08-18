// Library scroll perf probe. node lib-perf.mjs [folderTitle]
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:3050'
const folderTitle = process.argv[2] ?? null
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
await page.route(/supabase\.co\/(rest|auth)/, (r) => r.abort())
const netVideos = []
const vidReq = []
page.on('request', (req) => { if (/\.mp4/.test(req.url())) vidReq.push(req.url().split('/').pop().split('?')[0]) })
page.on('response', (res) => { if (/\.mp4/.test(res.url())) netVideos.push({ url: res.url().split('/').pop().split('?')[0], status: res.status() }) })
await page.goto(`${BASE}/editor`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__three, null, { timeout: 60000 })
await page.getByRole('button', { name: 'Instruments' }).click()
await page.waitForTimeout(500)

// Install long-task + frame observers
await page.evaluate(() => {
  window.__lt = []; window.__frames = []
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ start: e.startTime, dur: e.duration }) }).observe({ type: 'longtask', buffered: true })
  let last = performance.now()
  const tick = () => { const now = performance.now(); window.__frames.push(now - last); last = now; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
})

const folders = await page.locator('div.mx-2.h-\\[30px\\]').allTextContents()
console.log('folders at root:', folders)
if (folderTitle) {
  await page.locator('div.mx-2.h-\\[30px\\]', { hasText: folderTitle }).first().click()
  await page.waitForTimeout(300)
  const sub = await page.locator('div.mx-2.h-\\[30px\\]').allTextContents()
  console.log('subfolders:', sub)
}
const t0 = Date.now()
// wait for videos to load
await page.waitForTimeout(3000)
const state1 = await page.evaluate(() => ({
  videos: document.querySelectorAll('video').length,
  playing: Array.from(document.querySelectorAll('video')).filter((v) => !v.paused && v.readyState >= 2).length,
  canvases: document.querySelectorAll('canvas').length,
  cards: document.querySelectorAll('[class*="aspect-"]').length,
}))
console.log('after 3s:', state1, 'mp4 responses:', netVideos.length)

// find the scroll container: the sidebar's overflow-y-auto ancestor of a video or folder row
const scrollInfo = await page.evaluate(() => {
  const el = document.querySelector('video') ?? document.querySelector('div.mx-2.h-\\[30px\\]')
  let n = el
  while (n && n !== document.body) { const s = getComputedStyle(n); if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 10) break; n = n.parentElement }
  if (!n || n === document.body) return null
  n.setAttribute('data-perf-scroll', '1')
  return { scrollHeight: n.scrollHeight, clientHeight: n.clientHeight }
})
console.log('scroll container:', scrollInfo)

await page.evaluate(() => { window.__lt.length = 0; window.__frames.length = 0 })
// scroll down and up in steps
const scrollRes = await page.evaluate(async () => {
  const n = document.querySelector('[data-perf-scroll]')
  if (!n) return null
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const max = n.scrollHeight - n.clientHeight
  for (let i = 0; i <= 40; i++) { n.scrollTop = (max * i) / 40; await wait(50) }
  for (let i = 40; i >= 0; i--) { n.scrollTop = (max * i) / 40; await wait(50) }
  const frames = window.__frames.slice()
  const lt = window.__lt.slice()
  const sorted = frames.slice().sort((a, b) => a - b)
  return {
    frames: frames.length,
    p50: sorted[Math.floor(sorted.length * 0.5)]?.toFixed(1),
    p95: sorted[Math.floor(sorted.length * 0.95)]?.toFixed(1),
    max: sorted[sorted.length - 1]?.toFixed(1),
    over50ms: frames.filter((f) => f > 50).length,
    longTasks: lt.length,
    longTaskTotalMs: lt.reduce((a, b) => a + b.dur, 0).toFixed(0),
    videosNow: document.querySelectorAll('video').length,
  }
})
console.log('scroll:', scrollRes, 'mp4 requests total:', vidReq.length, 'unique:', new Set(vidReq).size)
await browser.close()

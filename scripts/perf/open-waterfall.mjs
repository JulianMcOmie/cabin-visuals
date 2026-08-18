// Open a real project URL and report when the project row fetch starts relative to the editor chunks.
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://localhost:3050'
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()
await page.goto(`${BASE}/start`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Create an empty project' }).click()
await page.waitForURL(/\/editor\?project=/, { timeout: 60000 })
const url = page.url()
await page.waitForFunction(() => !!window.__three, null, { timeout: 60000 })
// fresh page (cold JS cache is not possible in-process; but chunk fetch order still shows)
const p2 = await ctx.newPage()
const t0 = Date.now(); const events = []
p2.on('request', (r) => { const u = r.url(); if (/rest\/v1\/projects/.test(u)) events.push(['project-row-request', Date.now() - t0]); if (/_next\/static\/chunks\/.*\.js/.test(u) && !/webpack|main-app|app\/layout|polyfills/.test(u)) events.push(['chunk-request', Date.now() - t0]) })
p2.on('response', (r) => { const u = r.url(); if (/rest\/v1\/projects/.test(u)) events.push(['project-row-response', Date.now() - t0]) })
await p2.goto(url, { waitUntil: 'domcontentloaded' })
await p2.waitForFunction(() => !!window.__three && window.__cabinStores?.ui?.getState?.().projectName, null, { timeout: 60000 })
const ready = Date.now() - t0
const first = events.find((e) => e[0] === 'project-row-request'), resp = events.find((e) => e[0] === 'project-row-response')
const chunks = events.filter((e) => e[0] === 'chunk-request')
console.log(`project-row request at ${first?.[1]}ms, response at ${resp?.[1]}ms; editor chunks requested ${chunks[0]?.[1]}..${chunks[chunks.length - 1]?.[1]}ms (${chunks.length}); editor ready ${ready}ms`)
await browser.close()

// Sum JS bytes a route loads (encoded/transfer size where available). node js-payload.mjs http://localhost:3055/editor
import { chromium } from 'playwright'
const url = process.argv[2]
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage()
await page.route(/supabase\.co\/(rest|auth|storage)/, (r) => r.abort())
let js = 0, jsGz = 0, n = 0, fonts = 0, css = 0
page.on('response', async (res) => {
  const u = res.url(); if (!u.includes('/_next/')) return
  try {
    const body = await res.body()
    const enc = res.headers()['content-length']
    if (u.endsWith('.js')) { js += body.length; jsGz += enc ? Number(enc) : body.length; n++ }
    else if (u.endsWith('.woff2')) fonts += body.length
    else if (u.endsWith('.css')) css += body.length
  } catch {}
})
await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 })
await page.waitForTimeout(3000)
console.log(`${url}: ${n} js files, ${(js / 1e6).toFixed(2)} MB raw js, ${(jsGz / 1e6).toFixed(2)} MB transferred, fonts ${(fonts / 1e3).toFixed(0)} KB, css ${(css / 1e3).toFixed(0)} KB`)
await browser.close()

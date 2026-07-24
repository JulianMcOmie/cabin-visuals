// Regenerate the instrument library's preview clips:
//
//   npm run previews:instruments             only missing/stale clips
//   npm run previews:instruments -- --all    force every instrument
//   npm run previews:instruments -- cube     force just these id(s)
//
// It drives a REAL browser (headed) against your running dev server's
// /dev/instrument-previews capture page, which renders each library item's
// actual R3F preview (the same component the sidebar cards mount) with a
// deterministically stepped clock and encodes one seamless 8s loop per item.
// Clips upload to the public `instrument-previews` Supabase bucket; the editor
// cards play them instead of mounting live WebGL contexts.
//
// Incremental by default via a `manifest.json` of id -> capture version.
// Instrument code has no content hash (unlike template documents), so "stale"
// means the INSTRUMENT_PREVIEW_CAPTURE_VERSION in InstrumentPreviewCapture.tsx
// was bumped. After changing how an instrument LOOKS, force its id explicitly
// (or bump the version to redo everything).
//
// Prereqs (one-time):
//   - dev server running (npm run dev) on http://localhost:3000
//   - npx playwright install chromium
//   - .env.local has NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
//
// Headed on purpose: a real GPU renders WebGL and encodes WebCodecs reliably,
// unlike headless. Override the target with PREVIEW_BASE_URL if your dev
// server is elsewhere.

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

// Load .env.local ourselves (a standalone script doesn't get Next's env loading).
function loadEnv() {
  try {
    const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      const key = m[1]
      let val = m[2].trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!(key in process.env)) process.env[key] = val
    }
  } catch {
    // No .env.local - fall back to whatever is already in the environment.
  }
}
loadEnv()

const BASE = process.env.PREVIEW_BASE_URL || 'http://localhost:3000'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = 'instrument-previews'

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (put them in .env.local).')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const MANIFEST = 'manifest.json'

// CLI: bare = incremental; --all = force everything; positional id(s) = force
// exactly those.
const argv = process.argv.slice(2)
const forceAll = argv.includes('--all')
const onlyIds = argv.filter((a) => !a.startsWith('--'))

// Create the public bucket if it doesn't exist yet (service-role can; idempotent).
async function ensureBucket() {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true })
  if (error && !/exist/i.test(error.message)) {
    console.error(`Could not ensure bucket "${BUCKET}": ${error.message}`)
    process.exit(1)
  }
}

async function loadManifest() {
  const { data, error } = await supabase.storage.from(BUCKET).download(MANIFEST)
  if (error || !data) return {}
  try {
    return JSON.parse(await data.text())
  } catch {
    return {}
  }
}

await ensureBucket()

const browser = await chromium.launch({
  headless: false,
  args: ['--autoplay-policy=no-user-gesture-required'],
})

try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  [page error]', msg.text())
  })

  await page.goto(`${BASE}/dev/instrument-previews`, { waitUntil: 'load', timeout: 60_000 })
  await page.waitForFunction(
    () => Array.isArray(window.__instrumentPreviewIds) && !!window.__captureInstrumentPreview,
    { timeout: 60_000 },
  )
  const ids = await page.evaluate(() => window.__instrumentPreviewIds)
  const version = await page.evaluate(() => window.__instrumentPreviewVersion)
  const manifest = await loadManifest()

  // Decide what to (re)capture.
  const targets = ids.filter((id) => {
    if (onlyIds.length) return onlyIds.includes(id)
    if (forceAll) return true
    return manifest[id] !== version // never captured, or capture version bumped
  })
  const skipped = ids.length - targets.length
  console.log(
    `${targets.length} to capture, ${skipped} current (skipped) → bucket "${BUCKET}"` +
      (onlyIds.length ? ` [targeting: ${onlyIds.join(', ')}]` : forceAll ? ' [--all]' : '') +
      '\n',
  )
  if (onlyIds.length) {
    for (const id of onlyIds) if (!ids.includes(id)) console.log(`(warning: "${id}" is not a clippable instrument id)`)
  }

  let ok = 0
  for (const id of targets) {
    process.stdout.write(`• ${id} … `)
    try {
      const b64 = await page.evaluate((target) => window.__captureInstrumentPreview(target), id)
      if (!b64) {
        console.log('failed (capture returned nothing)')
        continue
      }
      const bytes = Buffer.from(b64, 'base64')
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(`${id}.mp4`, bytes, {
          upsert: true,
          contentType: 'video/mp4',
          // Clip URLs are versioned via the manifest (?v=), so the bytes at a
          // given URL never change - cache for a year and repeat sessions play
          // from disk instead of re-downloading the whole library.
          cacheControl: '31536000',
        })
      if (error) {
        console.log(`upload failed: ${error.message}`)
        continue
      }
      manifest[id] = version
      console.log(`ok (${(bytes.length / 1024).toFixed(0)} KB)`)
      ok++
    } catch (err) {
      console.log(`error: ${err.message}`)
    }
  }

  // Persist the manifest so the next run knows what's current. The editor also
  // reads it to know which ids HAVE clips (absent id = keep the live preview).
  if (ok > 0) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2)), {
        upsert: true,
        contentType: 'application/json',
        // The editor reads this to version each clip's URL - a cached manifest
        // would keep serving the PREVIOUS clip, the staleness this prevents.
        cacheControl: '0',
      })
    if (error) console.log(`(manifest upload failed: ${error.message} - next run may recapture)`)
  }
  console.log(`\nDone: ${ok}/${targets.length} captured, ${skipped} skipped.`)
} finally {
  await browser.close()
}

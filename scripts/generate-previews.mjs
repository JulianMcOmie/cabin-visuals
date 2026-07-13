// Regenerate template gallery preview clips:
//
//   npm run previews                 only templates whose content changed
//   npm run previews -- --all        force every template
//   npm run previews -- slideshow    force just these id(s)
//
// It drives a REAL browser (headed) against your running dev server, captures a
// short looping clip of each template's actual render via the same export
// pipeline the editor uses, and uploads each to the public `template-previews`
// Supabase bucket with the service-role key. No manual export/download/upload.
//
// Incremental by default: a `manifest.json` in the bucket records each clip's
// content hash; a template is recaptured only when its hash differs (or it's
// targeted/forced). So editing one template regenerates one clip, not all.
//
// Prereqs (one-time):
//   - dev server running (npm run dev) on http://localhost:3000
//   - npx playwright install chromium
//   - .env.local has NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
//
// Headed (a browser window appears and closes) on purpose: a real GPU renders
// WebGL and encodes WebCodecs reliably, unlike headless. Override the target with
// PREVIEW_BASE_URL if your dev server is elsewhere.

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
const BUCKET = 'template-previews'

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (put them in .env.local).')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const MANIFEST = 'manifest.json'

// CLI: bare = incremental; --all = force every template; positional id(s) = force
// exactly those.
const argv = process.argv.slice(2)
const forceAll = argv.includes('--all')
const onlyIds = argv.filter((a) => !a.startsWith('--'))

async function loadManifest() {
  const { data, error } = await supabase.storage.from(BUCKET).download(MANIFEST)
  if (error || !data) return {}
  try {
    return JSON.parse(await data.text())
  } catch {
    return {}
  }
}

const browser = await chromium.launch({
  headless: false,
  args: ['--autoplay-policy=no-user-gesture-required'],
})

try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  [page error]', msg.text())
  })

  // Load the editor once to discover the template ids + their content hashes.
  await page.goto(`${BASE}/editor?template=slideshow`, { waitUntil: 'load', timeout: 60_000 })
  await page.waitForFunction(() => Array.isArray(window.__templateIds) && !!window.__capturePreview, {
    timeout: 60_000,
  })
  const ids = await page.evaluate(() => window.__templateIds)
  const hashes = await page.evaluate(() => window.__templateHashes)
  const manifest = await loadManifest()

  // Decide what to (re)capture.
  const targets = ids.filter((id) => {
    if (onlyIds.length) return onlyIds.includes(id)
    if (forceAll) return true
    return manifest[id] !== hashes[id] // changed or never captured
  })
  const skipped = ids.length - targets.length
  console.log(
    `${targets.length} to capture, ${skipped} unchanged (skipped) → bucket "${BUCKET}"` +
      (onlyIds.length ? ` [targeting: ${onlyIds.join(', ')}]` : forceAll ? ' [--all]' : '') +
      '\n',
  )
  if (onlyIds.length) {
    for (const id of onlyIds) if (!ids.includes(id)) console.log(`(warning: "${id}" is not a template id)`)
  }

  let ok = 0
  for (const id of targets) {
    process.stdout.write(`• ${id} … `)
    try {
      await page.goto(`${BASE}/editor?template=${id}`, { waitUntil: 'load', timeout: 60_000 })
      await page.waitForFunction(() => !!window.__capturePreview, { timeout: 60_000 })
      const b64 = await page.evaluate(() => window.__capturePreview())
      if (!b64) {
        console.log('failed (scene never became renderable)')
        continue
      }
      const bytes = Buffer.from(b64, 'base64')
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(`${id}.mp4`, bytes, { upsert: true, contentType: 'video/mp4' })
      if (error) {
        console.log(`upload failed: ${error.message}`)
        continue
      }
      manifest[id] = hashes[id] // record the captured content hash
      console.log(`ok (${(bytes.length / 1024).toFixed(0)} KB)`)
      ok++
    } catch (err) {
      console.log(`error: ${err.message}`)
    }
  }

  // Persist the manifest so the next run knows what's current.
  if (ok > 0) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2)), {
        upsert: true,
        contentType: 'application/json',
      })
    if (error) console.log(`(manifest upload failed: ${error.message} - next run may recapture)`)
  }
  console.log(`\nDone: ${ok}/${targets.length} captured, ${skipped} skipped.`)
} finally {
  await browser.close()
}

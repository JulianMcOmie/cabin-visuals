// One-off (re-runnable) optimizer for the preview-clip buckets.
//
//   node scripts/optimize-previews.mjs [--dry] [--instruments] [--templates]
//
// - instrument-previews: remux every clip with `moov` at the FRONT (faststart).
//   The capture pipeline writes moov last, so a fresh <video> needed 2-3
//   sequential range round-trips before it could show frame 1 - that is the
//   "loads for a moment" on every library card. Bytes are copied, not
//   re-encoded; the manifest stamp is refreshed so cached old copies bust.
// - template-previews: re-encode to a card-appropriate bitrate (they were
//   captured at the EXPORT bitrate, 9 Mbps - 5-10 MB per card, 44 MB for the
//   tab) with faststart, and upload with a year-long cache header (they had
//   the bucket default of an hour). The manifest hash is recomputed.
//
// Needs ffmpeg on PATH and SUPABASE_SERVICE_ROLE_KEY in .env.local.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

function loadEnv() {
  try {
    const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      let val = m[2].trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
      if (!(m[1] in process.env)) process.env[m[1]] = val
    }
  } catch { /* env already set */ }
}
loadEnv()

const args = new Set(process.argv.slice(2))
const dry = args.has('--dry')
const doInstruments = args.has('--instruments') || !args.has('--templates')
const doTemplates = args.has('--templates') || !args.has('--instruments')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const supabase = createClient(url, key)
const tmp = mkdtempSync(join(tmpdir(), 'cabin-previews-'))
const YEAR = '31536000'

async function download(bucket, name) {
  const res = await fetch(`${url}/storage/v1/object/public/${bucket}/${name}?t=${Date.now()}`)
  if (!res.ok) throw new Error(`${bucket}/${name}: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}
function moovOffset(buf) {
  // Walk top-level boxes; return the byte offset of 'moov'.
  let off = 0
  while (off + 8 <= buf.length) {
    let size = buf.readUInt32BE(off)
    const type = buf.toString('latin1', off + 4, off + 8)
    if (size === 1) size = Number(buf.readBigUInt64BE(off + 8))
    if (size === 0) size = buf.length - off
    if (type === 'moov') return off
    if (size < 8) break
    off += size
  }
  return -1
}
function mdatOffset(buf) {
  let off = 0
  while (off + 8 <= buf.length) {
    let size = buf.readUInt32BE(off)
    const type = buf.toString('latin1', off + 4, off + 8)
    if (size === 1) size = Number(buf.readBigUInt64BE(off + 8))
    if (size === 0) size = buf.length - off
    if (type === 'mdat') return off
    if (size < 8) break
    off += size
  }
  return -1
}
function ffmpeg(input, output, extra) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', input, ...extra, '-movflags', '+faststart', output], { stdio: 'inherit' })
}
async function upload(bucket, name, bytes, contentType, cacheControl) {
  if (dry) return
  const { error } = await supabase.storage.from(bucket).upload(name, bytes, { upsert: true, contentType, cacheControl })
  if (error) throw error
}

if (doInstruments) {
  const BUCKET = 'instrument-previews'
  const manifest = JSON.parse((await download(BUCKET, 'manifest.json')).toString())
  let n = 0, already = 0, saved = 0
  for (const id of Object.keys(manifest)) {
    const inb = await download(BUCKET, `${id}.mp4`)
    const mo = moovOffset(inb), md = mdatOffset(inb)
    if (mo !== -1 && md !== -1 && mo < md) { already++; continue }
    const inPath = join(tmp, `${id}.in.mp4`), outPath = join(tmp, `${id}.out.mp4`)
    writeFileSync(inPath, inb)
    ffmpeg(inPath, outPath, ['-c', 'copy'])
    const outb = readFileSync(outPath)
    saved += inb.length - outb.length
    await upload(BUCKET, `${id}.mp4`, outb, 'video/mp4', YEAR)
    const version = String(manifest[id]).split('-')[0]
    manifest[id] = `${version}-${Date.now()}`
    n++
    process.stdout.write(`• ${id} faststart (${(outb.length / 1024).toFixed(0)} KB)\n`)
  }
  if (n > 0) await upload(BUCKET, 'manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)), 'application/json', '0')
  console.log(`instrument-previews: ${n} remuxed, ${already} already fast-start${dry ? ' (dry run)' : ''}\n`)
}

if (doTemplates) {
  const BUCKET = 'template-previews'
  const manifest = JSON.parse((await download(BUCKET, 'manifest.json')).toString())
  let before = 0, after = 0
  for (const id of Object.keys(manifest)) {
    const inb = await download(BUCKET, `${id}.mp4`)
    const inPath = join(tmp, `t-${id}.in.mp4`), outPath = join(tmp, `t-${id}.out.mp4`)
    writeFileSync(inPath, inb)
    // 640 wide (the capture size), CRF-driven quality at a card-appropriate
    // budget: these play at ~200-300 CSS px wide.
    ffmpeg(inPath, outPath, ['-an', '-vf', 'scale=640:-2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-maxrate', '1600k', '-bufsize', '3200k', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.0'])
    const outb = readFileSync(outPath)
    before += inb.length; after += outb.length
    await upload(BUCKET, `${id}.mp4`, outb, 'video/mp4', YEAR)
    manifest[id] = createHash('sha1').update(outb).digest('hex').slice(0, 8)
    process.stdout.write(`• ${id} ${(inb.length / 1e6).toFixed(1)} MB → ${(outb.length / 1e6).toFixed(2)} MB\n`)
  }
  await upload(BUCKET, 'manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)), 'application/json', '0')
  console.log(`template-previews: ${(before / 1e6).toFixed(1)} MB → ${(after / 1e6).toFixed(1)} MB${dry ? ' (dry run)' : ''}`)
}
rmSync(tmp, { recursive: true, force: true })

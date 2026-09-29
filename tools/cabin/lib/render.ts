import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import type { Cabin } from './api'
import { call, ensureDaemon, withProgress } from './client'
import { parsePositions, parseRange, type TimeCtx } from './time'
import { DAEMON_STATE, REPO } from './paths'

// The render commands: stills (shot), short clips and full renders. All of them
// go through the daemon's warm page and the editor's own export path.

interface Args {
  opt: (name: string, fallback?: string) => string | undefined
  flag: (name: string) => boolean
}

interface CodeError { id: string; phase: string; message: string; beat: number; count: number }

function timeCtx(p: Cabin): TimeCtx {
  return { bpm: p.bpm, beatsPerBar: p.beatsPerBar, sections: p.sections }
}

function reportProblems(errors: CodeError[] | undefined, consoleLines: string[] | undefined) {
  if (errors?.length) {
    console.log('code errors:')
    for (const e of errors) console.log(`  ${e.id} ${e.phase} @b${e.beat.toFixed(2)} ×${e.count}: ${e.message}`)
  }
  const interesting = (consoleLines ?? []).filter((l) => !/Download the React DevTools|webpack-hmr|Fast Refresh|\[HMR\]/.test(l))
  if (interesting.length) {
    console.log('page console:')
    for (const l of interesting.slice(-15)) console.log(`  ${l.slice(0, 300)}`)
  }
}

/** A contact sheet with each tile labelled by its position (bar · beat), via sharp
 *  (Next's own image dependency; this ffmpeg build has no drawtext). */
export async function labelledSheet(files: string[], labels: string[], cols: number, tileW: number, out: string): Promise<boolean> {
  let sharp: typeof import('sharp')
  try { sharp = (await import('sharp')).default } catch { return false }
  const meta = await sharp(files[0]).metadata()
  const tileH = Math.round((tileW * (meta.height ?? 9)) / (meta.width ?? 16))
  const pad = 4
  const rows = Math.ceil(files.length / cols)
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const tiles = await Promise.all(files.map(async (f, i) => {
    const label = esc(labels[i])
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tileW}" height="${tileH}">` +
      `<rect x="6" y="6" rx="3" width="${12 + labels[i].length * 8}" height="21" fill="black" fill-opacity="0.6"/>` +
      `<text x="12" y="21.5" font-family="Menlo, monospace" font-size="13" fill="white">${label}</text></svg>`
    const input = await sharp(f).resize(tileW, tileH).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer()
    return { input, left: pad + (i % cols) * (tileW + pad), top: pad + Math.floor(i / cols) * (tileH + pad) }
  }))
  await sharp({ create: { width: cols * tileW + (cols + 1) * pad, height: rows * tileH + (rows + 1) * pad, channels: 3, background: '#808080' } })
    .composite(tiles).png().toFile(out)
  return true
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'

export async function shot(p: Cabin, a: Args) {
  const at = a.opt('at')
  if (!at) throw new Error('shot needs --at (e.g. --at 28,32.5,b120,45s)')
  const beats = parsePositions(at, timeCtx(p))
  const view = a.opt('view', 'main')!
  const width = Number(a.opt('w', '960'))
  const height = Number(a.opt('h', '540'))
  const outDir = path.resolve(a.opt('out') ?? path.join(p.dir, 'renders', 'shots'))
  const sheet = a.flag('sheet')
  fs.mkdirSync(outDir, { recursive: true })
  await ensureDaemon()
  const res = await call<{ images: string[]; errors: CodeError[]; console: string[] }>('/shot', { project: p.name, beats, view, width, height })
  const files: string[] = []
  res.images.forEach((img, i) => {
    const file = path.join(outDir, `${slug(view)}-b${beats[i].toFixed(2)}.png`)
    fs.writeFileSync(file, Buffer.from(img.split(',')[1], 'base64'))
    files.push(file)
  })
  for (const f of files) console.log(f)
  if (sheet && files.length > 1) {
    const cols = Math.min(4, files.length)
    const rows = Math.ceil(files.length / cols)
    const out = path.join(outDir, `sheet-${slug(view)}.png`)
    const bpb = p.beatsPerBar
    const labels = beats.map((b) => `${+(b / bpb).toFixed(2)} · b${+b.toFixed(2)}`)
    if (!(await labelledSheet(files, labels, cols, Math.min(width, 640), out))) {
      // no sharp: an unlabelled ffmpeg tile
      const list = path.join(outDir, `.sheet-${process.pid}`)
      fs.mkdirSync(list, { recursive: true })
      files.forEach((f, i) => fs.copyFileSync(f, path.join(list, `${String(i).padStart(3, '0')}.png`)))
      execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', path.join(list, '%03d.png'),
        '-vf', `scale=${Math.min(width, 640)}:-1,tile=${cols}x${rows}:padding=4:color=gray`, '-frames:v', '1', out])
      fs.rmSync(list, { recursive: true, force: true })
    }
    console.log(`sheet: ${out}`)
  }
  reportProblems(res.errors, res.console)
}

export async function clip(p: Cabin, a: Args, full: boolean) {
  const ctx = timeCtx(p)
  const range = a.opt('range')
  const totalBeats = p.totalBars * p.beatsPerBar
  const [from, to] = range ? parseRange(range, ctx) : full ? [0, totalBeats] : (() => { throw new Error('clip needs --range (e.g. 28-32)') })()
  const fps = Number(a.opt('fps', full ? '60' : '30'))
  const width = Number(a.opt('w', full ? '1920' : '960'))
  const height = Number(a.opt('h', full ? '1080' : '540'))
  const subframes = Number(a.opt('mb', full ? '3' : '1'))
  const view = a.opt('view', 'main')!
  const secs = ((to - from) * 60) / p.bpm
  const frames = Math.max(1, Math.round(secs * fps))
  const def = path.join(p.dir, 'renders', `${full ? 'render' : 'clip'}-${slug(view)}-${Math.round(from)}-${Math.round(to)}-${width}x${height}.mp4`)
  const out = path.resolve(a.opt('out') ?? def)
  const vt = a.flag('vt')
  await ensureDaemon()
  console.log(`${full ? 'render' : 'clip'}: beats ${from.toFixed(2)}-${to.toFixed(2)} (${secs.toFixed(2)}s) · ${frames} frames @${fps} · ${width}x${height} · motion blur ${subframes}x → ${out}`)
  const res = await withProgress(full ? 'render' : 'clip', call<{ out: string; frames: number; ms: number; errors: CodeError[] }>('/stream', {
    project: p.name, startBeat: from, frames, fps, width, height, subframes, shutter: Number(a.opt('shutter', '0.5')), view, out,
    audio: !a.flag('no-audio'), vt, q: Number(a.opt('q', '65')), crf: Number(a.opt('crf', '18')), preset: a.opt('preset', 'medium'),
  }))
  console.log(`done in ${(res.ms / 1000).toFixed(1)}s → ${res.out}`)
  reportProblems(res.errors, [])
}

export async function errors(project: string) {
  await ensureDaemon()
  const res = await call<{ errors: CodeError[]; console: string[] }>('/errors', { project })
  if (!res.errors.length && !res.console.length) console.log('(no errors)')
  reportProblems(res.errors, res.console)
}

export async function daemon(sub: string) {
  if (sub === 'status') {
    if (!fs.existsSync(DAEMON_STATE)) { console.log('not running'); return }
    try {
      console.log(JSON.stringify(await call('/status', {}), null, 1))
    } catch {
      console.log('not running (stale state file)')
    }
    return
  }
  if (sub === 'stop') {
    try { await call('/stop', {}) } catch { /* not running */ }
    console.log('stopped')
    return
  }
  if (sub === 'restart') {
    try { await call('/stop', {}) } catch { /* not running */ }
    await new Promise((r) => setTimeout(r, 500))
    const s = await ensureDaemon()
    console.log(`running on ${s.port} (dev ${s.devUrl}); log: ${path.join(REPO, 'tools/cabin/.daemon.log')}`)
    return
  }
  throw new Error('cabin daemon status|stop|restart')
}

/** A screenshot of the editor UI itself (not the canvas render): timeline, panels, badges. */
export async function uiShot(p: Cabin, a: Args & { next?: () => string | undefined }) {
  const at = a.opt('at'), select = a.opt('select'), view = a.opt('view'), js = a.opt('eval'), steps = a.opt('do')
  const width = Number(a.opt('w', '1600')), height = Number(a.opt('h', '1000'))
  const comments = a.flag('comments')
  const out = path.resolve(a.opt('out') ?? path.join(p.dir, 'renders', 'ui', `ui-${Date.now()}.png`))
  let trackId: string | undefined, sceneId: string | undefined
  if (select) {
    const slash = select.indexOf('/')
    const scene = slash > 0 ? p.scene(select.slice(0, slash), { create: false }) : undefined
    const t = scene ? scene.get(select.slice(slash + 1)) : [...p.scenes(), p.main()].map((s) => s.find(select)).find(Boolean)
    if (!t) throw new Error(`no track "${select}"`)
    trackId = t.id
    sceneId = t.scene.id
  }
  const beat = at ? parsePositions(at, timeCtx(p))[0] : undefined
  await ensureDaemon()
  const evalJs = [js, comments ? `window.__cabinCommands?.run('comments.open')` : ''].filter(Boolean).join(';')
  const res = await call<{ out: string }>('/ui', { project: p.name, width, height, beat, trackId, sceneId, view, out, eval: evalJs || undefined, do: steps })
  console.log(res.out)
}

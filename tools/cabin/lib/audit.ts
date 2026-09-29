import fs from 'fs'
import path from 'path'
import type { Cabin } from './api'
import { call, ensureDaemon, withProgress } from './client'
import { parseRange, type TimeCtx } from './time'
import type { AuditFrame } from '../../../src/editor/dev/renderHooks'

// `cabin audit`: render the song at a low resolution through the export path
// and measure every sampled frame, then report the stretches a viewer would
// notice before you do - black holes, blown-out washes, full-frame static,
// frozen images - plus a per-section look summary. It's the whole-song pass
// that finds what spot-checking stills misses.

interface Args { opt(name: string, fallback?: string): string | undefined; flag(name: string): boolean }

export interface Span { kind: 'black' | 'blown' | 'static' | 'frozen'; from: number; to: number; worst: number; scene: string }

// Thresholds (calibrated on INNUENDO's renders: a settled Chladni figure or a
// pen drawing is ~0.05-0.15 coverage with grain 1-3; the old full-frame "red
// static" blasts were coverage > 0.6 with grain > 3).
const IS = {
  black: (f: AuditFrame) => f.mean < 0.012 && f.coverage < 0.004,
  blown: (f: AuditFrame) => f.white > 0.45 || f.mean > 0.72,
  static: (f: AuditFrame) => f.coverage > 0.55 && f.grain > 2.6,
  frozen: (f: AuditFrame) => f.motion < 0.0008 && f.coverage > 0.004,
}
const MIN_SEC = { black: 0.5, blown: 0.3, static: 0.3, frozen: 6 }

export function findSpans(frames: AuditFrame[], secPerBeat: number): Span[] {
  const spans: Span[] = []
  for (const kind of Object.keys(IS) as Array<keyof typeof IS>) {
    let start = -1, worst = 0
    const close = (i: number) => {
      const from = frames[start].beat, to = frames[i - 1].beat
      if ((to - from) * secPerBeat >= MIN_SEC[kind] - 1e-6 || (kind !== 'frozen' && i - start >= 2 && (to - from) * secPerBeat >= MIN_SEC[kind] / 2)) {
        spans.push({ kind, from, to, worst, scene: frames[start].scenes[0]?.[0] ?? '-' })
      }
      start = -1
      worst = 0
    }
    frames.forEach((f, i) => {
      const hit = IS[kind](f)
      if (hit) {
        if (start < 0) start = i
        worst = Math.max(worst, kind === 'black' ? 1 - f.mean : kind === 'blown' ? f.white : kind === 'static' ? f.grain : 1 - f.motion)
      } else if (start >= 0) close(i)
    })
    if (start >= 0) close(frames.length)
  }
  return spans.sort((a, b) => a.from - b.from)
}

export async function audit(p: Cabin, a: Args) {
  const ctx: TimeCtx = { bpm: p.bpm, beatsPerBar: p.beatsPerBar, sections: p.sections }
  const range = a.opt('range')
  const fps = Number(a.opt('fps', '4'))
  const json = a.flag('json'), strips = a.flag('strips')
  const [from, to] = range ? parseRange(range, ctx) : [0, p.totalBars * p.beatsPerBar]
  const spb = 60 / p.bpm
  const step = 1 / (fps * spb)
  await ensureDaemon()
  const t0 = Date.now()
  const res = await withProgress('audit', call<{ frames: AuditFrame[] }>('/audit', { project: p.name, startBeat: from, endBeat: to, step, width: 192, height: 108 }))
  const frames = res.frames
  if (json) { console.log(JSON.stringify(frames)); return }
  const bpb = p.beatsPerBar
  const at = (beat: number) => `${(beat / bpb).toFixed(2).padStart(6)} (${(beat * spb).toFixed(1)}s)`
  console.log(`audit: ${frames.length} frames over bars ${(from / bpb).toFixed(1)}–${(to / bpb).toFixed(1)} at ${fps}/s in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  const spans = findSpans(frames, spb)
  if (!spans.length) console.log('no problems found (black / blown / static / frozen)')
  else {
    console.log(`\n${spans.length} stretch(es) to look at:`)
    for (const s of spans) console.log(`  ${s.kind.padEnd(7)} bars ${at(s.from)} → ${at(s.to)}  ${((s.to - s.from) * spb + 1 / fps).toFixed(1)}s  scene ${s.scene}`)
  }

  // per section (or per 8 bars without sections)
  const secs = p.sections.length ? p.sections : Array.from({ length: Math.ceil(to / bpb / 8) }, (_, i) => ({ name: `bars ${i * 8}-${i * 8 + 8}`, from: i * 8, to: i * 8 + 8 }))
  console.log(`\n${'section'.padEnd(14)} ${'bars'.padEnd(9)} bright  cover  motion  grain  chroma  scene`)
  for (const s of secs) {
    const fs2 = frames.filter((f) => f.beat >= s.from * bpb && f.beat < s.to * bpb)
    if (!fs2.length) continue
    const m = (k: keyof AuditFrame) => fs2.reduce((acc, f) => acc + (f[k] as number), 0) / fs2.length
    const scenes = new Map<string, number>()
    for (const f of fs2) { const sc = f.scenes[0]?.[0] ?? '-'; scenes.set(sc, (scenes.get(sc) ?? 0) + 1) }
    const top = [...scenes.entries()].sort((x, y) => y[1] - x[1])[0][0]
    const bar = (v: number, max: number) => '▁▂▃▄▅▆▇█'[Math.max(0, Math.min(7, Math.round((v / max) * 7)))]
    console.log(`${s.name.padEnd(14)} ${`${s.from}-${s.to}`.padEnd(9)} ${bar(m('mean'), 0.35)} ${m('mean').toFixed(3)}  ${m('coverage').toFixed(2)}  ${bar(m('motion'), 0.05)} ${m('motion').toFixed(3)}  ${m('grain').toFixed(2)}  ${m('chroma').toFixed(2)}  ${top}`)
  }

  if (strips && spans.length) {
    const { shot } = await import('./render')
    const { Args: A } = await import('./args')
    for (const s of spans.slice(0, 8)) {
      const c = (s.from + s.to) / 2, half = Math.max(1, (s.to - s.from) / 2 + 1)
      const beats = Array.from({ length: 8 }, (_, i) => c - half + (2 * half * i) / 7)
      const out = path.join(p.dir, 'renders', 'audit', `${s.kind}-${Math.round(s.from)}`)
      fs.mkdirSync(out, { recursive: true })
      console.log(`\n${s.kind} @ bar ${(s.from / bpb).toFixed(2)}:`)
      await shot(p, new A(['--at', beats.map((b) => `b${b.toFixed(3)}`).join(','), '--sheet', '--w', '480', '--h', '270', '--out', out]))
    }
  }
}

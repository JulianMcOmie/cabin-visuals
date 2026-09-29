import fs from 'fs'
import { Midi } from '@tonejs/midi'
import type { ProjectDocument } from '../../../src/persistence/types'

// A song's analysis (tools/analysis/analyze.py → analysis.json, all in SECONDS
// of the song file) seen from a project: every event in PROJECT BEATS, through
// the same placement the editor plays the song with (its audio block's start
// bar and trim). Move the audio in the editor and the analysis follows.
//
//   const a = p.analysis()
//   a.kick.filter((h) => h.v > 0.4)                → [{ beat, v, sec }]
//   a.vocal                                        → [{ beat, dur, v, pitch, sec }]
//   a.env('vocals', beat)                          → 0..1 (any env; pitch tracks → MIDI)
//   a.chordAt(beat)                                → { root, tones }  (pitch classes)
//   a.bars(28, 40)                                 → per-bar energy rows (what `cabin analysis` prints)
//   a.sections()                                   → suggested sections from the bar features

export interface RawAnalysis {
  duration: number
  fps: number
  tempo: { bpm: number; period: number; phase: number; downbeat?: number; beatsPerBar?: number }
  harmony: Array<{ b: number; c: number[] }>
  events: {
    kick: Array<{ t: number; v: number }>
    snare: Array<{ t: number; v: number }>
    hat: Array<{ t: number; v: number }>
    bass: Array<{ t: number; d: number; v: number; p: number | null }>
    vocal: Array<{ t: number; d: number; v: number; p: number | null }>
    other: Array<{ t: number; d: number; v: number; pc: number; c: number }>
  }
  env: Record<string, number[] | number[][]>
  source?: { song?: string; stems?: string }
}

export interface Placement {
  /** Timeline bar the song file starts at (fractional ok). */
  startBar: number
  /** Seconds of the file skipped at its start. */
  trimStart: number
}

export interface Hit { beat: number; sec: number; v: number }
export interface Tone extends Hit { dur: number; pitch: number | null }
export interface Colour extends Hit { dur: number; pc: number; bright: number }
export interface Chord { beat: number; root: number; chroma: number[] }

export interface BarRow {
  bar: number
  sec: number
  /** 0..1 means over the bar. */
  drums: number; bass: number; vocals: number; other: number; mix: number
  kick: number; snare: number; hat: number; bassNotes: number; vocalNotes: number; otherNotes: number
  /** Most common bass root pitch class over the bar (-1 = none). */
  root: number
  chroma: number[]
}

export interface SuggestedSection { name: string; from: number; to: number; energy: number }

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Where the song's first downbeat should sit: a short lead-in is trimmed so bar 0
 *  is ONE; a long one (a pickup) starts the file partway into bar 0 so the
 *  downbeat lands on bar 1. */
export function alignPlacement(raw: RawAnalysis, beatsPerBar: number): Placement {
  const down = raw.tempo.downbeat ?? raw.tempo.phase
  if (down <= 0.35) return { startBar: 0, trimStart: down }
  const barSec = raw.tempo.period * beatsPerBar
  const k = Math.ceil(down / barSec)
  return { startBar: k - down / barSec, trimStart: 0 }
}

/** The placement of the analysed file on the timeline (its audio block), or the aligned default. */
export function placementIn(doc: ProjectDocument, clipRef: string | undefined, raw: RawAnalysis): Placement {
  for (const t of Object.values(doc.audioTracks ?? {})) {
    for (const b of t.audioBlocks ?? []) {
      if (!clipRef || b.clipRef === clipRef) return { startBar: b.startBar, trimStart: b.trimStart }
    }
  }
  return alignPlacement(raw, doc.beatsPerBar)
}

export class Analysis {
  readonly kick: Hit[]
  readonly snare: Hit[]
  readonly hat: Hit[]
  readonly bass: Tone[]
  readonly vocal: Tone[]
  readonly other: Colour[]
  readonly harmony: Chord[]
  readonly bpm: number
  private readonly spb: number

  constructor(readonly raw: RawAnalysis, readonly place: Placement, readonly beatsPerBar: number, projectBpm?: number) {
    this.bpm = projectBpm ?? raw.tempo.bpm
    this.spb = 60 / this.bpm
    const hit = (e: { t: number; v: number }): Hit => ({ beat: this.beatOf(e.t), sec: e.t, v: e.v })
    this.kick = raw.events.kick.map(hit)
    this.snare = raw.events.snare.map(hit)
    this.hat = raw.events.hat.map(hit)
    const tone = (e: { t: number; d: number; v: number; p: number | null }): Tone => ({ ...hit(e), dur: e.d / this.spb, pitch: e.p })
    this.bass = raw.events.bass.map(tone)
    this.vocal = raw.events.vocal.map(tone)
    this.other = raw.events.other.map((e) => ({ ...hit(e), dur: e.d / this.spb, pc: e.pc, bright: e.c }))
    this.harmony = raw.harmony.map((h, i) => ({ beat: this.beatOf(raw.tempo.phase + i * raw.tempo.period), root: h.b, chroma: h.c.map((x) => x / 9) }))
  }

  /** Project beat at a time in the song file. The analysis snaps drum onsets to
   *  16ths in seconds, rounded to 0.1 ms - so a beat within ~2 ms of a 16th IS
   *  that 16th (431.9999 must not land in the previous bar). */
  beatOf(sec: number): number {
    const b = this.place.startBar * this.beatsPerBar + (sec - this.place.trimStart) / this.spb
    const q = Math.round(b * 4) / 4
    return Math.abs(b - q) < 0.005 ? q : Math.round(b * 1e4) / 1e4
  }

  /** Time in the song file at a project beat. */
  secOf(beat: number): number {
    return this.place.trimStart + (beat - this.place.startBar * this.beatsPerBar) * this.spb
  }

  /** The song's length in project beats (from beat 0). */
  get endBeat(): number { return this.beatOf(this.raw.duration) }

  /** An envelope at a beat: 0..1 (kick snare hat drums bass vocals other mix sub low mid high air),
   *  MIDI for vocalPitch/bassPitch (0 = unvoiced). */
  env(name: string, beat: number): number {
    const e = this.raw.env[name] as number[] | undefined
    if (!e) throw new Error(`no envelope "${name}" (have: ${Object.keys(this.raw.env).join(', ')})`)
    const i = Math.round(this.secOf(beat) * this.raw.fps)
    if (i < 0 || i >= e.length) return 0
    return name.endsWith('Pitch') ? e[i] : e[i] / 1000
  }

  /** Mean of an envelope over [from, to) beats. */
  envMean(name: string, from: number, to: number): number {
    const e = this.raw.env[name] as number[]
    const i0 = Math.max(0, Math.floor(this.secOf(from) * this.raw.fps))
    const i1 = Math.min(e.length, Math.ceil(this.secOf(to) * this.raw.fps))
    if (i1 <= i0) return 0
    let s = 0
    for (let i = i0; i < i1; i++) s += e[i]
    return s / (i1 - i0) / 1000
  }

  /** The harmony at a beat: bass root pitch class (-1 = none) and the strongest chroma tones. */
  chordAt(beat: number, tones = 3): { root: number; tones: number[]; chroma: number[] } {
    let h = this.harmony[0]
    for (const x of this.harmony) { if (x.beat <= beat + 1e-6) h = x; else break }
    if (!h) return { root: -1, tones: [], chroma: new Array(12).fill(0) }
    const order = h.chroma.map((v, pc) => [v, pc] as const).sort((a, b) => b[0] - a[0]).slice(0, tones).filter(([v]) => v > 0.5)
    return { root: h.root, tones: order.map(([, pc]) => pc), chroma: h.chroma }
  }

  /** Hits of one drum list that are strong FOR THEIR BAR (loudness varies by
   *  section, so a global threshold starves the quiet parts): v ≥ max(floor,
   *  rel × the bar's loudest), on a 1/div beat grid. */
  strongest(kind: 'kick' | 'snare' | 'hat', rel = 0.6, floor = 0.25, div = 2): Hit[] {
    const list = this[kind]
    const peak = new Map<number, number>()
    for (const h of list) {
      const b = Math.floor(h.beat / this.beatsPerBar)
      peak.set(b, Math.max(peak.get(b) ?? 0, h.v))
    }
    const onGrid = (beat: number) => Math.abs(beat * div - Math.round(beat * div)) < 0.02
    return list.filter((h) => h.v >= Math.max(floor, (peak.get(Math.floor(h.beat / this.beatsPerBar)) ?? 0) * rel) && onGrid(h.beat))
  }

  /** Sung onsets (v ≥ minV) with a pitch for every one: pYIN's, else the pitch
   *  track's, else the current chord's strongest tone (octave 5). */
  sung(minV = 0.2, fallbackRoot = 6): Array<Tone & { pitch: number }> {
    return this.vocal.filter((h) => h.v >= minV).map((h) => {
      if (h.pitch !== null) return { ...h, pitch: Math.round(h.pitch) }
      const tracked = this.env('vocalPitch', h.beat + 0.1)
      if (tracked > 0) return { ...h, pitch: Math.round(tracked) }
      const c = this.chordAt(h.beat)
      return { ...h, pitch: 60 + (c.tones[0] ?? (c.root >= 0 ? c.root : fallbackRoot)) }
    })
  }

  /** Where the harmony changes: bass-root runs, each held until the next change or silence. */
  chordChanges(): Array<{ beat: number; end: number; root: number; tones: number[] }> {
    if (this.chordCache) return this.chordCache
    const out: Array<{ beat: number; end: number; root: number; tones: number[] }> = []
    const beatLen = 60 / this.raw.tempo.period / this.bpm
    for (const h of this.harmony) {
      const c = this.chordAt(h.beat)
      const last = out[out.length - 1]
      if (c.root < 0) { if (last && last.end > h.beat) last.end = h.beat; continue }
      if (last && last.root === c.root && last.end >= h.beat - 1e-6) { last.end = h.beat + beatLen; continue }
      out.push({ beat: h.beat, end: h.beat + beatLen, root: c.root, tones: c.tones })
    }
    return (this.chordCache = out)
  }
  private chordCache?: Array<{ beat: number; end: number; root: number; tones: number[] }>

  /** Per-bar features for bars [from, to). */
  bars(from = 0, to = Math.ceil(this.endBeat / this.beatsPerBar)): BarRow[] {
    const rows: BarRow[] = []
    const count = (list: Hit[], b0: number, b1: number) => list.reduce((n, h) => n + (h.beat >= b0 && h.beat < b1 ? 1 : 0), 0)
    for (let bar = Math.max(0, Math.floor(from)); bar < to; bar++) {
      const b0 = bar * this.beatsPerBar, b1 = b0 + this.beatsPerBar
      const roots = new Array(12).fill(0)
      const chroma = new Array(12).fill(0)
      let nh = 0
      for (const h of this.harmony) {
        if (h.beat < b0 - 1e-6 || h.beat >= b1 - 1e-6) continue
        if (h.root >= 0) roots[h.root]++
        for (let k = 0; k < 12; k++) chroma[k] += h.chroma[k]
        nh++
      }
      const best = roots.indexOf(Math.max(...roots))
      rows.push({
        bar, sec: this.secOf(b0),
        drums: this.envMean('drums', b0, b1), bass: this.envMean('bass', b0, b1), vocals: this.envMean('vocals', b0, b1),
        other: this.envMean('other', b0, b1), mix: this.envMean('mix', b0, b1),
        kick: count(this.kick, b0, b1), snare: count(this.snare, b0, b1), hat: count(this.hat, b0, b1),
        bassNotes: count(this.bass, b0, b1), vocalNotes: count(this.vocal, b0, b1), otherNotes: count(this.other, b0, b1),
        root: roots[best] > 0 ? best : -1,
        chroma: chroma.map((v) => (nh ? v / nh : 0)),
      })
    }
    return rows
  }

  /** Sections suggested by novelty in the bar features (boundaries on even bars; similar
   *  sections share a letter: A, B, A2 ...). A starting point - rename and adjust. */
  sections(opts: { window?: number; minBars?: number } = {}): SuggestedSection[] {
    const rows = this.bars()
    const n = rows.length
    if (n < 4) return [{ name: 'A', from: 0, to: n, energy: 0 }]
    const win = opts.window ?? 4
    const minBars = opts.minBars ?? 4
    const maxHits = (k: keyof BarRow) => Math.max(1, ...rows.map((r) => r[k] as number))
    const mk = maxHits('kick'), ms = maxHits('snare'), mh = maxHits('hat'), mv = maxHits('vocalNotes')
    const feat = rows.map((r) => {
      const cn = Math.hypot(...r.chroma) || 1
      return [r.drums, r.bass, r.vocals * 1.5, r.other, r.mix, r.kick / mk, r.snare / ms, r.hat / mh, r.vocalNotes / mv, ...r.chroma.map((c) => (0.35 * c) / cn)]
    })
    const mean = (a: number, b: number) => {
      const out = new Array(feat[0].length).fill(0)
      const lo = Math.max(0, a), hi = Math.min(n, b)
      for (let i = lo; i < hi; i++) for (let k = 0; k < out.length; k++) out[k] += feat[i][k] / Math.max(1, hi - lo)
      return out
    }
    const dist = (a: number[], b: number[]) => Math.hypot(...a.map((x, k) => x - b[k]))
    const nov = new Array(n).fill(0)
    for (let i = 2; i < n - 1; i += 2) nov[i] = dist(mean(i - win, i), mean(i, i + win))
    const vals = nov.filter((v) => v > 0)
    const mu = vals.reduce((s, v) => s + v, 0) / Math.max(1, vals.length)
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mu) ** 2, 0) / Math.max(1, vals.length))
    const bounds = [0]
    for (let i = 2; i < n - 1; i += 2) {
      const peak = nov[i] >= (nov[i - 2] ?? 0) && nov[i] >= (nov[i + 2] ?? 0)
      if (peak && nov[i] > mu + 0.35 * sd && i - bounds[bounds.length - 1] >= minBars && n - i >= 2) bounds.push(i)
    }
    bounds.push(n)
    const secs = bounds.slice(0, -1).map((from, i) => ({ from, to: bounds[i + 1], f: mean(from, bounds[i + 1]) }))
    // Letters by similarity: a section joins the NEAREST earlier letter's first
    // occurrence (no chaining - chains merge a whole song into one letter) when
    // it's well under this song's typical distance between sections.
    const pair: number[] = []
    for (let i = 0; i < secs.length; i++) for (let j = i + 1; j < secs.length; j++) pair.push(dist(secs[i].f, secs[j].f))
    pair.sort((x, y) => x - y)
    const same = 0.56 * (pair[Math.floor(pair.length / 2)] ?? 0)
    const letters: Array<{ f: number[]; letter: string; uses: number }> = []
    return secs.map((s) => {
      let match: (typeof letters)[number] | undefined
      for (const l of letters) if (dist(l.f, s.f) < same && (!match || dist(l.f, s.f) < dist(match.f, s.f))) match = l
      if (!match) {
        match = { f: s.f, letter: String.fromCharCode(65 + letters.length), uses: 0 }
        letters.push(match)
      }
      match.uses++
      const energy = (s.f[0] + s.f[1] + s.f[2] + s.f[3] + s.f[4]) / 5
      return { name: match.uses > 1 ? `${match.letter}${match.uses}` : match.letter, from: s.from, to: s.to, energy }
    })
  }

  /** Every event as a Standard MIDI File in project beats: Kick 36 · Snare 38 · Hat 42 ·
   *  Bass (its pitch) · Vocal (its pitch) · Other (60 + pitch class) · Root (36 + root, held) ·
   *  Chord (60 + the strongest tones, held while unchanged). */
  toMidi(file: string) {
    const midi = new Midi()
    midi.header.setTempo(this.bpm)
    const ppq = midi.header.ppq
    const put = (name: string, notes: Array<{ beat: number; dur: number; pitch: number; v: number }>) => {
      const t = midi.addTrack()
      t.name = name
      for (const n of notes) {
        if (n.beat < 0) continue
        t.addNote({ midi: Math.max(0, Math.min(127, Math.round(n.pitch))), ticks: Math.round(n.beat * ppq), durationTicks: Math.max(1, Math.round(n.dur * ppq)), velocity: Math.max(0.05, Math.min(1, n.v)) })
      }
    }
    put('Kick', this.kick.map((h) => ({ beat: h.beat, dur: 0.25, pitch: 36, v: h.v })))
    put('Snare', this.snare.map((h) => ({ beat: h.beat, dur: 0.25, pitch: 38, v: h.v })))
    put('Hat', this.hat.map((h) => ({ beat: h.beat, dur: 0.125, pitch: 42, v: h.v })))
    put('Bass', this.bass.map((h) => ({ beat: h.beat, dur: h.dur, pitch: h.pitch ?? 36, v: h.v })))
    put('Vocal', this.vocal.map((h) => ({ beat: h.beat, dur: h.dur, pitch: h.pitch ?? 60, v: h.v })))
    put('Other', this.other.map((h) => ({ beat: h.beat, dur: h.dur, pitch: 60 + h.pc, v: h.v })))
    const held = (key: (h: Chord) => number[]) => {
      const out: Array<{ beat: number; dur: number; pitch: number; v: number }> = []
      let cur: number[] = [], start = 0
      const flush = (end: number) => { for (const p of cur) out.push({ beat: start, dur: end - start, pitch: p, v: 0.8 }) }
      for (const h of this.harmony) {
        const k = key(h)
        if (k.join() !== cur.join()) { flush(h.beat); cur = k; start = h.beat }
      }
      if (this.harmony.length) flush(this.harmony[this.harmony.length - 1].beat + 60 / this.raw.tempo.period / this.bpm)
      return out
    }
    put('Root', held((h) => (h.root >= 0 ? [36 + h.root] : [])))
    put('Chord', held((h) => {
      const top = h.chroma.map((v, pc) => [v, pc] as const).sort((a, b) => b[0] - a[0]).slice(0, 3).filter(([v]) => v > 0.6)
      return top.map(([, pc]) => 60 + pc).sort((a, b) => a - b)
    }))
    fs.writeFileSync(file, Buffer.from(midi.toArray()))
  }
}

export function loadAnalysis(file: string): RawAnalysis {
  if (!fs.existsSync(file)) throw new Error(`no analysis at ${file} - run: cabin analyze <project>`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as RawAnalysis
}

/** The bar table `cabin analysis` prints: energies as 0-9 digits, event counts, root. */
export function formatBars(rows: BarRow[], sections: Array<{ name: string; from: number }> = []): string {
  const d = (x: number) => String(Math.max(0, Math.min(9, Math.round(x * 9))))
  const c = (n: number) => (n === 0 ? '·' : n > 9 ? '+' : String(n))
  const head = ' bar    time  │ drm bas vox oth mix │ K  S  H  b  v  o │ root'
  const lines = [head, '─'.repeat(head.length)]
  for (const r of rows) {
    const sec = sections.find((s) => s.from === r.bar)
    const m = Math.floor(r.sec / 60), s = r.sec - m * 60
    lines.push(
      `${String(r.bar).padStart(4)}  ${m}:${s.toFixed(1).padStart(4, '0')}  │  ${d(r.drums)}   ${d(r.bass)}   ${d(r.vocals)}   ${d(r.other)}   ${d(r.mix)}  │ ` +
      `${[r.kick, r.snare, r.hat, r.bassNotes, r.vocalNotes, r.otherNotes].map(c).join('  ')} │ ${r.root >= 0 ? NOTE_NAMES[r.root] : '-'}` +
      (sec ? `   ◀ ${sec.name}` : ''),
    )
  }
  return lines.join('\n')
}

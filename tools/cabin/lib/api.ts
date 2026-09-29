import { randomUUID } from 'crypto'
import path from 'path'
import type { ProjectDocument } from '../../../src/persistence/types'
import type {
  Block, InterpolationMode, Note, Scene, SceneGradientKind, Track, TrackType,
} from '../../../src/editor/types'
import { loopLengthBeats, tileLoopNotes } from '../../../src/editor/core/visual/noteFlatten'
import { valueToPitch } from '../../../src/editor/core/trackTypes'
import { nextTrackColor } from '../../../src/editor/utils/trackColors'
import type { CabinMeta, Section } from './project'
import { Analysis, loadAnalysis, placementIn, type RawAnalysis } from './analysis'
import { mediaRef } from './paths'
import { noteHash } from '../../../src/editor/core/provenance'
import { listHistory, readEntry } from './history'

// The project scripting API - how the CLI (and edit scripts) write a project:
// scenes, tracks, devices and, above all, MIDI. Everything is in ABSOLUTE BEATS
// (beat 0 = bar 0's downbeat; bars are 0-based). Blocks are bookkeeping the API
// does for you: a note lands in the block that covers it, a block grows to fit,
// a new region gets a new block, overlapping blocks merge. Looped blocks are
// expanded to explicit notes the moment you edit inside them.
//
// Provenance: every note the API adds carries `src` {by: p.author, h: hash};
// `clear()` removes only notes still exactly as a script wrote them, and
// `add()` skips notes you deleted or moved in the editor (tombstones and
// pins, derived from .history) - so re-running a build script keeps your hand
// edits. `clear(from, to, pitch, { all: true })` removes everything.
//
//   export default function edit(p: Cabin) {
//     const s = p.scene('Plate', { background: '#05060a' })
//     const sand = s.track('Sand', { instrument: 'innuendo.chladni', params: { grains: 140000 } })
//     sand.clear(p.bar(28), p.bar(40))
//     for (let b = 28; b < 40; b++) sand.add({ beat: p.bar(b), pitch: 60, dur: 0.25 })
//     p.main().track('Cuts', { instrument: 'sceneSwitcher' }).cue(p.bar(28), 'Plate', p.bar(12))
//   }

export interface NoteIn {
  beat: number
  pitch: number
  /** Beats (default 0.25). */
  dur?: number
  /** 0-127 (default 100). */
  vel?: number
  /** Automation lanes: the exact value (the pitch is its nearest row). */
  value?: number
  /** Automation lanes: easing into the next key ('expo.out', 'back.inOut', 'step' …). */
  ease?: string
}

export interface NoteOut {
  beat: number
  pitch: number
  dur: number
  vel: number
  id: string
}

export interface TrackSpec {
  /** instrumentId (object instrument, code instrument '<pack>.<name>', or composition def). */
  instrument?: string
  /** Default 'base' (or inferred from mover/splitter/param). */
  type?: TrackType
  /** Numeric params (booleans → 0/1). Strings/colours go in `strings`. */
  params?: Record<string, number | boolean>
  strings?: Record<string, string>
  color?: string
  /** A mover device id (type 'mover'). */
  mover?: string
  /** A splitter device id (type 'splitter'). */
  splitter?: string
  /** Device settings (movers/splitters). */
  inputs?: Record<string, number>
  /** Automation lane target param (type 'automation'). */
  param?: string
  interpolation?: InterpolationMode
  /** Automation value range the lane's 49 pitch rows span. */
  range?: { min: number; max: number }
  /** Ability lane key (type 'ability'). */
  ability?: string
  onTop?: boolean
  muted?: boolean
}

const uid = () => randomUUID()

function absNotes(track: Track, bpb: number): Array<NoteOut & { block: Block; note: Note }> {
  const out: Array<NoteOut & { block: Block; note: Note }> = []
  for (const block of track.blocks) {
    const start = block.startBar * bpb
    for (const note of block.notes) {
      out.push({ beat: start + note.startBeat, pitch: note.pitch, dur: note.durationBeats, vel: note.velocity, id: note.id, block, note })
    }
  }
  return out.sort((a, b) => a.beat - b.beat || a.pitch - b.pitch)
}

const matches = (pitch: number, q?: number | number[] | ((p: number) => boolean)) =>
  q === undefined ? true : typeof q === 'number' ? pitch === q : typeof q === 'function' ? q(pitch) : q.includes(pitch)

export class Cabin {
  /** Written into every note's and new track's provenance (commands set it: 'script:foo.ts', 'eval' …). */
  author = 'cabin'

  constructor(
    readonly name: string,
    public doc: ProjectDocument,
    public meta: CabinMeta,
    readonly dir: string,
  ) {
    adoptLegacyNotes(this)
  }

  // ---------------------------------------------------------------- provenance

  private guards?: Map<string, { pinned: Set<string>; tombstones: Set<string> }>

  /** Per track: hashes a script must not re-add - notes you moved (pinned) or deleted (tombstones). */
  guardsFor(trackId: string): { pinned: Set<string>; tombstones: Set<string> } {
    if (!this.guards) this.guards = computeGuards(this)
    let g = this.guards.get(trackId)
    if (!g) this.guards.set(trackId, g = { pinned: new Set(), tombstones: new Set() })
    return g
  }

  // ---------------------------------------------------------------- time

  get bpm() { return this.doc.bpm }
  set bpm(v: number) { this.doc.bpm = v }
  get beatsPerBar() { return this.doc.beatsPerBar }
  get totalBars() { return this.doc.totalBars }
  set totalBars(v: number) { this.doc.totalBars = Math.max(1, Math.ceil(v)) }
  /** Beat of bar n (0-based; fractional ok). */
  bar(n: number) { return n * this.doc.beatsPerBar }
  /** Beat at a time in seconds (constant tempo). */
  sec(s: number) { return (s * this.doc.bpm) / 60 }
  /** Seconds at a beat. */
  toSec(beat: number) { return (beat * 60) / this.doc.bpm }
  /** Grow the song to at least `bars` bars. */
  ensureBars(bars: number) { if (bars > this.doc.totalBars) this.doc.totalBars = Math.ceil(bars) }

  // ---------------------------------------------------------------- sections (the document's markers)

  /** Named bar ranges - the document's markers (the editor's song strip), or
   *  legacy cabin.json sections until the first write moves them over. */
  get sections(): Section[] {
    const m = this.doc.markers
    if (m?.length) return m.map(({ name, from, to }) => ({ name, from, to }))
    return this.meta.sections ?? []
  }
  set sections(list: Section[]) {
    const byName = new Map((this.doc.markers ?? []).map((m) => [m.name, m]))
    this.doc.markers = list.map((sec) => ({ ...byName.get(sec.name), id: byName.get(sec.name)?.id ?? uid(), name: sec.name, from: sec.from, to: sec.to }))
      .sort((a, b) => a.from - b.from)
    delete this.meta.sections
  }
  section(name: string): Section {
    const s = this.sections.find((x) => x.name.toLowerCase() === name.toLowerCase())
    if (!s) throw new Error(`no section "${name}" (have: ${this.sections.map((x) => x.name).join(', ') || 'none'})`)
    return s
  }

  // ---------------------------------------------------------------- analysis

  private rawAnalysis?: { file: string; raw: RawAnalysis }

  /** The song's analysis in project beats (see lib/analysis.ts): a.kick / a.snare / a.hat /
   *  a.bass / a.vocal / a.other / a.harmony, a.env(name, beat), a.chordAt(beat), a.bars(). */
  analysis(): Analysis {
    const file = path.join(this.dir, this.meta.analysis ?? 'analysis/analysis.json')
    if (this.rawAnalysis?.file !== file) this.rawAnalysis = { file, raw: loadAnalysis(file) }
    const raw = this.rawAnalysis.raw
    const ref = this.meta.audio ? mediaRef(this.name, this.meta.audio) : undefined
    return new Analysis(raw, placementIn(this.doc, ref, raw), this.beatsPerBar, this.bpm)
  }

  // ---------------------------------------------------------------- lanes

  /** The song's shared MIDI lanes: tracks in the (never-shown) "Lanes" scene that
   *  code instruments read with `ctx.lane(name)` - one Kick lane, many instruments. */
  lanes(): TrackApi[] {
    const id = this.doc.sceneOrder.find((sid) => this.doc.scenes[sid]?.name === LANES_SCENE)
    return id ? new SceneApi(this, id).tracks() : []
  }

  /** Get or create a shared lane by name. */
  lane(name: string): TrackApi {
    const scene = this.scene(LANES_SCENE, { background: '#000000' })
    return scene.find(name) ?? scene.create(name, { instrument: 'core.lane' })
  }

  /** Write the analysis as lanes: Kick, Snare, Hat, Bass, Vocal, Other, Root, Chord.
   *  Drums are filtered bar-relatively (the strong hits); the vocal gets a pitch
   *  for every onset (pYIN, else the pitch track, else the chord). Returns the count. */
  lanesFromAnalysis(opts: { replace?: boolean } = {}): number {
    const a = this.analysis()
    const bpb = this.beatsPerBar
    const vel = (v: number, lo = 40) => Math.round(lo + (127 - lo) * Math.max(0, Math.min(1, v)))
    const lanes: Array<[string, NoteIn[]]> = [
      ['Kick', a.strongest('kick', 0.6, 0.25, 2).map((h) => ({ beat: h.beat, pitch: 36, vel: vel(h.v, 60) }))],
      ['Snare', a.strongest('snare', 0.75, 0.3, 2).map((h) => ({ beat: h.beat, pitch: 38, vel: vel(h.v, 50) }))],
      ['Hat', a.hat.filter((h) => h.v >= 0.15).map((h) => ({ beat: h.beat, pitch: 42, dur: 0.125, vel: vel(h.v, 30) }))],
      ['Bass', a.bass.filter((h) => h.pitch !== null).map((h) => ({ beat: h.beat, pitch: Math.round(h.pitch!), dur: Math.max(0.25, h.dur), vel: vel(h.v, 50) }))],
      ['Vocal', a.sung(0.2).map((h) => ({ beat: h.beat, pitch: h.pitch, dur: Math.max(0.3, h.dur), vel: vel(h.v, 60) }))],
      ['Other', a.other.filter((h) => h.v > 0.25).map((h) => ({ beat: h.beat, pitch: 60 + h.pc, dur: Math.max(0.25, h.dur), vel: vel(h.v, 40) }))],
      ['Root', a.chordChanges().map((c) => ({ beat: c.beat, pitch: 36 + c.root, dur: Math.max(0.5, c.end - c.beat), vel: 100 }))],
      ['Chord', a.chordChanges().flatMap((c) => c.tones.map((pc) => ({ beat: c.beat, pitch: 60 + pc, dur: Math.max(0.5, c.end - c.beat), vel: 90 })))],
    ]
    for (const [name, notes] of lanes) {
      const t = this.lane(name)
      if (opts.replace) t.clear()
      t.add(notes)
    }
    void bpb
    return lanes.length
  }

  // ---------------------------------------------------------------- scenes

  /** Visual scenes in order (not the Composite). */
  scenes(): SceneApi[] {
    return this.doc.sceneOrder.filter((id) => !this.doc.scenes[id]?.isMain).map((id) => new SceneApi(this, id))
  }

  /** The Composite scene (composition tracks: switchers, code compositions). */
  main(): SceneApi {
    const id = this.doc.sceneOrder.find((sid) => this.doc.scenes[sid]?.isMain)
    if (!id) throw new Error('document has no Composite scene')
    return new SceneApi(this, id)
  }

  /** Get a visual scene by name, creating it (appended) when missing. */
  scene(name: string, opts: { background?: string; transparent?: boolean; create?: boolean } = {}): SceneApi {
    const existing = this.doc.sceneOrder.find((id) => !this.doc.scenes[id]?.isMain && this.doc.scenes[id]?.name.toLowerCase() === name.toLowerCase())
    let id = existing
    if (!id) {
      if (opts.create === false) throw new Error(`no scene "${name}" (have: ${this.scenes().map((s) => s.name).join(', ')})`)
      id = uid()
      this.doc.scenes[id] = {
        id, name, isMain: false,
        backgroundColor: opts.background ?? '#000000',
        backgroundTransparent: false,
        tracks: {}, rootTrackIds: [],
      } as Scene
      this.doc.sceneOrder.push(id)
    }
    const api = new SceneApi(this, id)
    if (opts.background) api.background(opts.background, opts.transparent)
    return api
  }

  removeScene(name: string) {
    const s = this.scene(name, { create: false })
    delete this.doc.scenes[s.id]
    this.doc.sceneOrder = this.doc.sceneOrder.filter((id) => id !== s.id)
    if (this.doc.activeSceneId === s.id) this.doc.activeSceneId = this.scenes()[0]?.id
  }

  // ---------------------------------------------------------------- audio

  /** Put an audio file on the timeline (ref = a dev-served project media path). */
  addAudio(ref: string, opts: { name: string; fileName: string; duration: number; startBar?: number; gain?: number }) {
    for (const [id, t] of Object.entries(this.doc.audioTracks)) {
      if (t.audioBlocks?.some((b) => b.clipRef === ref)) {
        delete this.doc.audioTracks[id]
        this.doc.audioRootTrackIds = this.doc.audioRootTrackIds.filter((x) => x !== id)
      }
    }
    const id = uid()
    this.doc.audioTracks[id] = {
      id, name: opts.name, type: 'audio', instrumentId: '', color: '#ef4444', muted: false, solo: false,
      blocks: [], childIds: [],
      audioBlocks: [{ id: uid(), clipRef: ref, startBar: opts.startBar ?? 0, trimStart: 0, trimEnd: opts.duration, ...(opts.gain !== undefined ? { gain: opts.gain } : {}) }],
    }
    this.doc.audioRootTrackIds.push(id)
    this.doc.audioClips[ref] = { ref, fileName: opts.fileName, duration: opts.duration } as ProjectDocument['audioClips'][string]
    this.ensureBars(this.sec(opts.duration) / this.beatsPerBar + (opts.startBar ?? 0))
  }
}

export class SceneApi {
  constructor(readonly cabin: Cabin, readonly id: string) {}

  get raw(): Scene { return this.cabin.doc.scenes[this.id] }
  get name() { return this.raw.name }
  set name(v: string) { this.raw.name = v }
  get isMain() { return !!this.raw.isMain }

  background(color: string, transparent = false) {
    this.raw.backgroundColor = color
    this.raw.backgroundTransparent = transparent
    if (this.raw.backgroundGradient) this.raw.backgroundGradient.enabled = false
    return this
  }

  gradient(from: string, to: string, kind: SceneGradientKind = 'linear', angle = 90) {
    this.raw.backgroundGradient = { enabled: true, kind, from, to, angle }
    return this
  }

  /** Every track, depth-first in timeline order. */
  tracks(): TrackApi[] {
    const out: TrackApi[] = []
    const walk = (id: string) => {
      const t = this.raw.tracks[id]
      if (!t) return
      out.push(new TrackApi(this, id))
      for (const c of t.childIds) walk(c)
    }
    for (const r of this.raw.rootTrackIds) walk(r)
    return out
  }

  roots(): TrackApi[] { return this.raw.rootTrackIds.filter((id) => this.raw.tracks[id]).map((id) => new TrackApi(this, id)) }

  find(nameOrId: string): TrackApi | undefined {
    if (this.raw.tracks[nameOrId]) return new TrackApi(this, nameOrId)
    const lower = nameOrId.toLowerCase()
    return this.tracks().find((t) => t.name.toLowerCase() === lower)
  }

  get(nameOrId: string): TrackApi {
    const t = this.find(nameOrId)
    if (!t) throw new Error(`scene "${this.name}" has no track "${nameOrId}" (have: ${this.tracks().map((x) => x.name).join(', ') || 'none'})`)
    return t
  }

  /** Get a ROOT track by name, creating it from `spec` when missing (spec is re-applied when given). */
  track(name: string, spec?: TrackSpec): TrackApi {
    const existing = this.roots().find((t) => t.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      if (spec) existing.apply(spec)
      return existing
    }
    if (!spec) throw new Error(`scene "${this.name}" has no root track "${name}" - pass a spec to create it`)
    return this.create(name, spec)
  }

  /** Always create (names may repeat). */
  create(name: string, spec: TrackSpec, parentId?: string): TrackApi {
    const id = uid()
    const prev = Object.values(this.raw.tracks).at(-1)?.color
    const type: TrackType = spec.type
      ?? (spec.mover ? 'mover' : spec.splitter ? 'splitter' : spec.param ? 'automation' : spec.ability ? 'ability' : 'base')
    const t: Track = {
      id, name, type,
      instrumentId: spec.instrument ?? '',
      color: spec.color ?? nextTrackColor(prev),
      muted: !!spec.muted, solo: false,
      blocks: [], childIds: [],
      createdBy: this.cabin.author,
    }
    this.raw.tracks[id] = t
    if (parentId) {
      t.parentId = parentId
      this.raw.tracks[parentId].childIds.push(id)
    } else {
      this.raw.rootTrackIds.push(id)
    }
    const api = new TrackApi(this, id)
    api.apply(spec)
    return api
  }

  remove(nameOrId: string) {
    const t = this.get(nameOrId)
    t.remove()
  }
}

export class TrackApi {
  constructor(readonly scene: SceneApi, readonly id: string) {}

  get raw(): Track {
    const t = this.scene.raw.tracks[this.id]
    if (!t) throw new Error(`track ${this.id} no longer exists`)
    return t
  }
  get name() { return this.raw.name }
  set name(v: string) { this.raw.name = v }
  get instrument() { return this.raw.instrumentId }
  private get bpb() { return this.scene.cabin.beatsPerBar }

  /** Apply a spec's fields (used by create and by track(name, spec) on an existing track). */
  apply(spec: TrackSpec) {
    const t = this.raw
    if (spec.instrument !== undefined) t.instrumentId = spec.instrument
    if (spec.params) this.set(spec.params)
    if (spec.strings) t.stringParams = { ...t.stringParams, ...spec.strings }
    if (spec.color) t.color = spec.color
    if (spec.mover) t.moverId = spec.mover
    if (spec.splitter) t.splitterId = spec.splitter
    if (spec.inputs) t.inputValues = { ...t.inputValues, ...spec.inputs }
    if (spec.param) t.targetParam = spec.param
    if (spec.interpolation) t.interpolation = spec.interpolation
    if (spec.range) t.automationRange = { ...t.automationRange, min: spec.range.min, max: spec.range.max }
    if (spec.ability) t.abilityKey = spec.ability
    if (spec.onTop !== undefined) t.onTop = spec.onTop
    if (spec.muted !== undefined) t.muted = spec.muted
    return this
  }

  /** Set params: numbers/booleans → params, strings → stringParams. */
  set(values: Record<string, number | boolean | string>) {
    const t = this.raw
    for (const [k, v] of Object.entries(values)) {
      if (typeof v === 'string') t.stringParams = { ...t.stringParams, [k]: v }
      else t.params = { ...t.params, [k]: typeof v === 'boolean' ? (v ? 1 : 0) : v }
    }
    return this
  }

  /** Device settings for mover/splitter rows. */
  inputs(values: Record<string, number>) {
    this.raw.inputValues = { ...this.raw.inputValues, ...values }
    return this
  }

  children(): TrackApi[] { return this.raw.childIds.map((id) => new TrackApi(this.scene, id)) }

  /** Get a child by name, creating it from `spec` when missing. */
  child(name: string, spec?: TrackSpec): TrackApi {
    const existing = this.children().find((c) => c.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      if (spec) existing.apply(spec)
      return existing
    }
    if (!spec) throw new Error(`track "${this.name}" has no child "${name}" - pass a spec to create it`)
    return this.scene.create(name, spec, this.id)
  }

  /** Delete this track and its subtree. */
  remove() {
    const s = this.scene.raw
    const kill = (id: string) => {
      const t = s.tracks[id]
      if (!t) return
      for (const c of t.childIds) kill(c)
      delete s.tracks[id]
    }
    const t = this.raw
    if (t.parentId && s.tracks[t.parentId]) s.tracks[t.parentId].childIds = s.tracks[t.parentId].childIds.filter((c) => c !== this.id)
    s.rootTrackIds = s.rootTrackIds.filter((r) => r !== this.id)
    kill(this.id)
  }

  mute(on = true) { this.raw.muted = on; return this }
  solo(on = true) { this.raw.solo = on; return this }

  // ---------------------------------------------------------------- MIDI

  /** Notes in [from, to) (absolute beats), optionally one pitch/set/predicate. */
  notes(from = -Infinity, to = Infinity, pitch?: number | number[] | ((p: number) => boolean)): NoteOut[] {
    return absNotes(this.raw, this.bpb)
      .filter((n) => n.beat >= from && n.beat < to && matches(n.pitch, pitch))
      .map(({ beat, pitch: p, dur, vel, id }) => ({ beat, pitch: p, dur, vel, id }))
  }

  /** Remove notes starting in [from, to). Blocks left empty inside the range go too. Returns the count. */
  clear(from = -Infinity, to = Infinity, pitch?: number | number[] | ((p: number) => boolean), opts: { all?: boolean } = {}): number {
    const bpb = this.bpb
    let removed = 0
    for (const block of this.raw.blocks) {
      if (block.loop && this.blockOverlaps(block, from, to)) this.unloop(block)
      const start = block.startBar * bpb
      const before = block.notes.length
      block.notes = block.notes.filter((n) => {
        const b = start + n.startBeat
        if (!(b >= from && b < to && matches(n.pitch, pitch))) return true
        // keep the user's notes (drawn by hand, or a script note they edited)
        if (!opts.all && !(n.src && n.src.h === noteHash(b, n.pitch, n.durationBeats, n.velocity))) return true
        return false
      })
      removed += before - block.notes.length
    }
    this.raw.blocks = this.raw.blocks.filter((b) => {
      if (b.notes.length > 0) return true
      const s = b.startBar * bpb, e = (b.startBar + b.durationBars) * bpb
      return !(s >= from && e <= to)
    })
    return removed
  }

  /** Add notes (absolute beats). Each carries provenance; a note the user deleted
   *  or moved in the editor (same content as before) is not re-added. */
  add(notes: NoteIn | NoteIn[]) {
    const list = Array.isArray(notes) ? notes : [notes]
    const bpb = this.bpb
    const t = this.raw
    const guards = this.scene.cabin.guardsFor(this.id)
    const by = this.scene.cabin.author
    for (const n of list) {
      if (!Number.isFinite(n.beat) || !Number.isFinite(n.pitch)) throw new Error(`bad note ${JSON.stringify(n)}`)
      const dur = Math.max(1e-3, n.dur ?? 0.25)
      const pitch = Math.round(n.pitch)
      const velocity = Math.max(1, Math.min(127, Math.round(n.vel ?? 100)))
      const h = noteHash(n.beat, pitch, dur, velocity)
      if (guards.tombstones.has(h) || guards.pinned.has(h)) continue
      const end = n.beat + dur
      let block = t.blocks.find((b) => b.startBar * bpb <= n.beat && n.beat < (b.startBar + b.durationBars) * bpb)
      if (block?.loop) this.unloop(block)
      if (!block) {
        // extend a block that ends exactly where this note's bar starts, else start a new one
        const bar = Math.floor(n.beat / bpb)
        block = t.blocks.find((b) => !b.loop && b.startBar + b.durationBars === bar)
        if (!block) {
          block = { id: uid(), startBar: bar, durationBars: 1, loop: false, notes: [] }
          t.blocks.push(block)
        }
      }
      const startBeat = n.beat - block.startBar * bpb
      block.notes.push({
        id: uid(), startBeat, durationBeats: dur, pitch, velocity, src: { by, h },
        ...(n.value !== undefined ? { value: n.value } : {}), ...(n.ease ? { ease: n.ease } : {}),
      })
      const needBars = Math.ceil((end - block.startBar * bpb) / bpb - 1e-9)
      if (needBars > block.durationBars) block.durationBars = needBars
    }
    this.mergeBlocks()
    this.scene.cabin.ensureBars(Math.max(...t.blocks.map((b) => b.startBar + b.durationBars), 0))
    return this
  }

  /** Replace everything in [from, to) with these notes. */
  replace(from: number, to: number, notes: NoteIn[]) {
    this.clear(from, to)
    return this.add(notes)
  }

  /** The same pitch at each beat. */
  hits(beats: number[], pitch: number, dur = 0.25, vel = 100) {
    return this.add(beats.map((beat) => ({ beat, pitch, dur, vel })))
  }

  /** A block spanning [from, to) even with no notes in it - the track's on-screen region
   *  for instruments that gate on their blocks. Adds a zero-velocity marker note. */
  region(from: number, to: number, markerPitch = 0) {
    return this.add({ beat: from, pitch: markerPitch, dur: to - from, vel: 1 })
  }

  /** Automation lane keyframes: [beat, value] pairs, encoded onto the lane's pitch rows. */
  keys(points: Array<[number, number]>, opts: { min?: number; max?: number; dur?: number } = {}) {
    const t = this.raw
    if (t.type !== 'automation') throw new Error(`keys() is for automation lanes; "${t.name}" is ${t.type}`)
    const min = opts.min ?? t.automationRange?.min
    const max = opts.max ?? t.automationRange?.max
    if (min === undefined || max === undefined) throw new Error(`keys(): give the lane a range (spec.range or opts.min/max)`)
    t.automationRange = { ...t.automationRange, min, max }
    return this.add(points.map(([beat, value]) => ({ beat, pitch: valueToPitch(value, min, max), dur: opts.dur ?? 0.25 })))
  }

  /** Automation curve with EXACT values and per-key easing: [{ beat, value, ease? }].
   *  `ease` shapes the segment into the next key (see core/easing.ts names). */
  curve(points: Array<{ beat: number; value: number; ease?: string }>, opts: { min?: number; max?: number } = {}) {
    const t = this.raw
    if (t.type !== 'automation') throw new Error(`curve() is for automation lanes; "${t.name}" is ${t.type}`)
    const min = opts.min ?? t.automationRange?.min ?? Math.min(...points.map((p) => p.value))
    const max = opts.max ?? t.automationRange?.max ?? Math.max(...points.map((p) => p.value))
    t.automationRange = { ...t.automationRange, min, max: max > min ? max : min + 1 }
    return this.add(points.map((p) => ({ beat: p.beat, pitch: valueToPitch(p.value, min, max > min ? max : min + 1), dur: 0.25, value: p.value, ...(p.ease ? { ease: p.ease } : {}) })))
  }

  // ---------------------------------------------------------------- composition tracks (Composite scene)

  /** Ensure a scene is bound to a row of this composition track; returns its pitch. */
  bind(sceneName: string, pitch?: number): number {
    const cabin = this.scene.cabin
    const scene = cabin.scene(sceneName, { create: false })
    const t = this.raw
    const bindings = t.sceneBindings ?? []
    const found = bindings.find((b) => b.sceneId === scene.id)
    if (found) return found.pitch
    let p = pitch ?? 60
    const used = new Set(bindings.map((b) => b.pitch))
    while (used.has(p)) p++
    t.sceneBindings = [...bindings, { sceneId: scene.id, pitch: p }]
    return p
  }

  /** A note on a scene's row: "show this scene from `beat` for `dur` beats". */
  cue(beat: number, sceneName: string, dur = 4, vel = 100) {
    return this.add({ beat, pitch: this.bind(sceneName), dur, vel })
  }

  // ---------------------------------------------------------------- block bookkeeping

  private blockOverlaps(b: Block, from: number, to: number) {
    const s = b.startBar * this.bpb, e = (b.startBar + b.durationBars) * this.bpb
    return s < to && e > from
  }

  /** Expand a looped block into its explicit notes (what the resolver would tile). */
  unloop(block: Block) {
    if (!block.loop) return
    const bpb = this.bpb
    const tiled = tileLoopNotes(block.notes, loopLengthBeats(block, bpb), block.durationBars * bpb)
    block.notes = tiled.map((tn) => ({ ...tn.note, id: uid(), startBeat: tn.startBeat, durationBeats: tn.durationBeats }))
    block.loop = false
    delete block.loopLengthBars
  }

  /** Merge overlapping plain blocks (notes rebased), keeping looped blocks as they are. */
  private mergeBlocks() {
    const bpb = this.bpb
    const plain = this.raw.blocks.filter((b) => !b.loop).sort((a, b) => a.startBar - b.startBar)
    const loops = this.raw.blocks.filter((b) => b.loop)
    const out: Block[] = []
    for (const b of plain) {
      const cur = out[out.length - 1]
      if (cur && b.startBar < cur.startBar + cur.durationBars) {
        const shift = (b.startBar - cur.startBar) * bpb
        for (const n of b.notes) cur.notes.push({ ...n, startBeat: n.startBeat + shift })
        cur.durationBars = Math.max(cur.durationBars, b.startBar + b.durationBars - cur.startBar)
      } else {
        out.push(b)
      }
    }
    for (const b of out) b.notes.sort((x, y) => x.startBeat - y.startBeat || x.pitch - y.pitch)
    this.raw.blocks = [...out, ...loops].sort((a, b) => a.startBar - b.startBar)
  }
}

// ---------------------------------------------------------------- provenance helpers

const LANES_SCENE = 'Lanes'

/** Notes from before provenance existed have no `src`: the first time this CLI
 *  opens such a project, stamp them as a legacy script's (they were written by
 *  scripts), so re-running a build doesn't duplicate them. Once per project. */
function adoptLegacyNotes(p: Cabin) {
  if (p.meta.provenance) return
  const bpb = p.doc.beatsPerBar
  for (const scene of Object.values(p.doc.scenes)) {
    for (const t of Object.values(scene.tracks)) {
      for (const b of t.blocks) {
        for (const n of b.notes) {
          if (!n.src) n.src = { by: 'legacy', h: noteHash(b.startBar * bpb + n.startBeat, n.pitch, n.durationBeats, n.velocity) }
        }
      }
    }
  }
  p.meta.provenance = 1
}

/** Pins (script notes the user moved or restyled: their ORIGINAL hash, when no
 *  untouched copy remains) and tombstones (script notes the user deleted since
 *  the last CLI write, accumulated in cabin.json) per track. */
function computeGuards(p: Cabin): Map<string, { pinned: Set<string>; tombstones: Set<string> }> {
  const out = new Map<string, { pinned: Set<string>; tombstones: Set<string> }>()
  const bpb = p.doc.beatsPerBar
  const present = new Map<string, Set<string>>()
  for (const scene of Object.values(p.doc.scenes)) {
    for (const t of Object.values(scene.tracks)) {
      const edited = new Set<string>(), untouched = new Set<string>(), all = new Set<string>()
      for (const b of t.blocks) {
        for (const n of b.notes) {
          if (!n.src) continue
          all.add(n.src.h)
          if (n.src.h === noteHash(b.startBar * bpb + n.startBeat, n.pitch, n.durationBeats, n.velocity)) untouched.add(n.src.h)
          else edited.add(n.src.h)
        }
      }
      present.set(t.id, all)
      const pinned = new Set([...edited].filter((h) => !untouched.has(h)))
      out.set(t.id, { pinned, tombstones: new Set(p.meta.tombstones?.[t.id] ?? []) })
    }
  }
  // deletions since the last CLI write
  const hist = listHistory(p.name)
  const last = hist[hist.length - 1]
  if (last) {
    try {
      const before = readEntry(last)
      for (const scene of Object.values(before.scenes)) {
        for (const t of Object.values(scene.tracks)) {
          const now = present.get(t.id)
          if (!now) continue
          const g = out.get(t.id)!
          for (const b of t.blocks) for (const n of b.notes) if (n.src && !now.has(n.src.h)) g.tombstones.add(n.src.h)
        }
      }
    } catch { /* unreadable history - no tombstones this time */ }
  }
  // persist tombstones so they outlive the next write
  const keep: Record<string, string[]> = {}
  for (const [id, g] of out) if (g.tombstones.size) keep[id] = [...g.tombstones]
  p.meta.tombstones = Object.keys(keep).length ? keep : undefined
  return out
}

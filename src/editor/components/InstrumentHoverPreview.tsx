'use client'

import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { Group, Matrix4, Mesh, MeshStandardMaterial, Color } from 'three'
import { getInstrument } from '../instruments'
import { getMoverOrSplitterDefinition } from '../core/visualCopies/registry'
import { mergeDefinitionSettings } from '../core/visualCopies/definitions'
import { identityVisualCopy } from '../core/visualCopies/identityVisualCopy'
import { resolveVisualCopies } from '../core/visualCopies/resolveVisualCopies'
import type { VisualCopy } from '../core/visualCopies/types'
import { setPreviewObjectState } from '../core/visual/VisualEngine'
import { resolveProject, type ProjectSnapshot } from '../core/visual/resolve'
import { evaluatePulse } from '../core/visual/energy'
import { sampleAutomationLane } from '../core/visual/automation'
import { evaluateAdsrGain } from '../core/visual/adsr'
import { composeMatrix, localTransformToSV } from '../core/visual/stateVector'
import { composeScreenAnchor } from '../core/visual/screenAnchor'
import { applyMaterialOpacity } from '../core/visual/animatedOpacity'
import { applyMaterialHueShift } from '../core/visual/animatedColor'
import { flattenTrackNotes as flattenProjectTrackNotes } from '../core/visual/noteFlatten'
import { useProjectStore } from '../store/ProjectStore'
import { useTimeStore } from '../store/TimeStore'
import type { ObjectState, ResolvedNote, ResolvedObject } from '../core/visual/types'
import { get2DPreview, Preview2D } from './InstrumentPreview2D'
import { useInstrumentClipUrl } from '../../components/instrumentClipUrl'
import type { InstrumentItem } from './LeftSidebar'

/**
 * The hover popup for the instrument browser: a live mini-canvas. Objects
 * render through their real instrument component fed a synthetic ObjectState
 * playing one note per beat, so the preview shows the instrument DOING its
 * thing. Movers and splitters render a plain cube run through the definition's
 * resolved chain with the same looping pattern.
 *
 * The preview canvas is a separate R3F root; its driver advances a private
 * beat off the canvas clock. That clock never touches the transport or the
 * main scene - the pause invariant governs instruments reading state.beat,
 * and these instruments still do exactly that.
 */

const PREVIEW_BPM = 120
const BEATS_PER_SEC = PREVIEW_BPM / 60
const LASER_INSTRUMENT_IDS = new Set(['laserSphere', 'laserLine'])
// The pattern loops over this span; the driver starts a beat IN so the first
// rendered frame already has a note in the past - motion from frame one, no
// dead ramp-up while the popup appears. Exactly 1 so Text Display's word
// cycle ((count-1) % words) opens on its FIRST word at hover.
const LOOP_BEATS = 16
const START_OFFSET_BEATS = 1

/** A note every `strideBeats`, cycling the given pitches. */
function makeLoopNotes(pitches: number[], durationBeats: number, strideBeats = 1): ResolvedNote[] {
  return Array.from({ length: Math.floor(LOOP_BEATS / strideBeats) }, (_, i) => ({
    beat: i * strideBeats,
    blockStartBeat: 0,
    blockEndBeat: 1e9,
    pitch: pitches[i % pitches.length],
    velocity: 100,
    durationBeats,
  }))
}

function previewBeat(elapsedSec: number): number {
  return (elapsedSec * BEATS_PER_SEC + START_OFFSET_BEATS) % LOOP_BEATS
}

/** Laser emitters intentionally contain no geometry-based glow: their HDR
 *  pixels only become a laser after the scene bloom pass. Keep that same pass
 *  in the isolated preview canvases, but only mount it for laser objects so
 *  ordinary instrument cards retain their existing rendering and cost. */
export function LaserPreviewBloom({ instrumentId }: { instrumentId?: string }) {
  if (!instrumentId || !LASER_INSTRUMENT_IDS.has(instrumentId)) return null
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={0.9}
        luminanceThreshold={1.15}
        luminanceSmoothing={0.08}
        mipmapBlur
        radius={0.72}
        levels={7}
      />
    </EffectComposer>
  )
}

/** Track-row previews sync to the song: while the transport plays, the popup
 *  follows the project beat (the preview IS the music); paused or for plain
 *  library rows, the private 120bpm loop clock runs instead. */
function previewBeatNow(elapsedSec: number, sync?: boolean): number {
  if (previewTimeOverrideSec !== null) return previewBeat(previewTimeOverrideSec)
  if (sync) {
    const t = useTimeStore.getState()
    if (t.isPlaying) return t.currentBeat
  }
  return previewBeat(elapsedSec)
}

// The clip-capture page steps this instead of letting the canvas clock run:
// with frameloop 'never' + advance(), every driver reads the SAME stepped time,
// so a captured frame is a pure function of its index and the 8s clip loops
// exactly (previewBeat is periodic over LOOP_BEATS). Null = live clocks.
let previewTimeOverrideSec: number | null = null
export function setPreviewTimeOverride(sec: number | null): void {
  previewTimeOverrideSec = sec
}

// Instruments whose real render needs context a popup can't provide (uploads,
// live audio, the scene camera, scenes to composite) get a bespoke canvas-2D
// vignette instead (InstrumentPreview2D) - that covers the Main essentials and
// every Director, so the whole library previews.
export function canPreview(item: InstrumentItem): boolean {
  if (get2DPreview(item.id)) return true
  if (item.kind === 'object') return !!getInstrument(item.id)
  if (item.kind === 'mover' || item.kind === 'splitter' || item.kind === 'colorizer') return !!getMoverOrSplitterDefinition(item.id)
  return false
}

// ── Object preview: the real instrument component on synthetic state ────────

const PREVIEW_TRACK_ID = '__instrument-preview__'

// A gentle arc through the middle of most instruments' pitch ranges.
const OBJECT_NOTES = makeLoopNotes([60, 64, 67, 71, 67, 64], 0.5)

// Preview-only param overrides for instruments whose real defaults read poorly
// in a popup: Text Display defaults to the single word HELLO, which hides its
// whole point. The Stack layout shows the PHRASE: "text display" stays up the
// whole loop while the font flicker below carries all the motion.
const PREVIEW_STRING_PARAMS: Record<string, Record<string, string>> = {
  textDisplay: { text: 'text display' },
}
const PREVIEW_NUMBER_PARAMS: Record<string, Record<string, number>> = {
  // Stack layout, 2 words per card, held until replaced (no fade dips between
  // the tightly-spaced preview notes).
  textDisplay: { layoutMode: 2, stackMaxWords: 2, sustain: 1 },
  // Spin defaults to 0 (still) in real tracks; a static solid makes a dead
  // preview, so the popup shows the classic steady tumble.
  cube: { spinSpeed: 1 },
}

// Preview-only per-frame param motion, applied by ObjectPreviewDriver: Text
// Display rapid-fire flickers through font stacks - system faces only, since
// the template webfonts gate frames on their loads mid-flicker.
const TEXT_DISPLAY_FLICKER_FONTS = [0, 1, 2, 10, 13, 14, 11]
const PREVIEW_PARAM_ANIMATORS: Record<string, (params: Record<string, number>, beat: number) => void> = {
  textDisplay: (params, beat) => {
    params.font = TEXT_DISPLAY_FLICKER_FONTS[Math.floor(beat * 2) % TEXT_DISPLAY_FLICKER_FONTS.length]
  },
}

// Preview-only note overrides for instruments whose labeled vocabulary the
// generic arc misses entirely. Text Display renders NOTHING without pitch 48
// ("Next word") - the 60-71 arc only hits its height lanes, leaving the popup
// black. Both word notes land at beat 0, so the full phrase is up from the
// first frame and never rebuilds - the font flicker alone is the animation.
const PREVIEW_NOTES: Record<string, ResolvedNote[]> = {
  textDisplay: Array.from({ length: 2 }, () => ({
    beat: 0,
    blockStartBeat: 0,
    blockEndBeat: 1e9,
    pitch: 48,
    velocity: 100,
    durationBeats: 0.4,
  })),
}

function makePreviewState(instrumentId: string): ObjectState {
  const def = getInstrument(instrumentId)
  const params: Record<string, number> = {}
  const stringParams: Record<string, string> = {}
  for (const p of def?.params ?? []) {
    if (p.type === 'color' || p.type === 'string') stringParams[p.key] = p.default
    else if (typeof p.default === 'number') params[p.key] = p.default
  }
  Object.assign(stringParams, PREVIEW_STRING_PARAMS[instrumentId])
  Object.assign(params, PREVIEW_NUMBER_PARAMS[instrumentId])
  return {
    beat: 0,
    secPerBeat: 60 / PREVIEW_BPM,
    beatsPerBar: 4,
    params,
    // Hover previews have no automation lanes, so paramAtBeat just reads the base.
    automations: [],
    baseParams: params,
    energy: 0,
    blackedOut: false,
    // Solo previews never apply localTransform (identity world), so no size scale either.
    world: new Matrix4(),
    meshScale: 1,
    opacity: 1,
    stringParams,
    abilityEvents: new Map(),
    notes: PREVIEW_NOTES[instrumentId] ?? OBJECT_NOTES,
    activeNotes: [],
  }
}

/** Mounted BEFORE the instrument component (r3f runs useFrame in mount order),
 *  so the state is registered and ticked ahead of the instrument's read.
 *  Recomputes activeNotes and the decaying energy pulse each frame - the
 *  preview's stand-in for what computeAtBeat derives on the main canvas. */
function ObjectPreviewDriver({ instrumentId, trackId, notes, sync }: { instrumentId: string; trackId: string; notes?: ResolvedNote[]; sync?: boolean }) {
  const state = useMemo(() => {
    const s = makePreviewState(instrumentId)
    // Track rows preview their OWN notes rather than the canned arc.
    if (notes && notes.length > 0) s.notes = notes
    return s
  }, [instrumentId, notes])
  useFrame((root) => {
    const beat = previewBeatNow(root.clock.elapsedTime, sync)
    state.beat = beat
    PREVIEW_PARAM_ANIMATORS[instrumentId]?.(state.params, beat)
    state.activeNotes.length = 0
    let lastOnset = -Infinity
    let lastVel = 0
    for (const n of state.notes) {
      if (beat >= n.beat && beat < n.beat + n.durationBeats) state.activeNotes.push(n)
      if (n.beat <= beat && n.beat > lastOnset) { lastOnset = n.beat; lastVel = n.velocity }
    }
    state.energy = lastOnset === -Infinity ? 0 : (lastVel / 127) * Math.exp(-3 * (beat - lastOnset))
    setPreviewObjectState(trackId, state)
  })
  useEffect(() => {
    return () => setPreviewObjectState(trackId, null)
  }, [instrumentId, trackId])
  return null
}

const _fullFrameAnchor = new Matrix4()

/** Full-frame instruments are SCREENS on the main canvas: ObjectRenderer pins
 *  them dead-ahead of the camera every frame (screenAnchor.ts). Previews mount
 *  instrument components WITHOUT ObjectRenderer, so unanchored they sit at the
 *  origin while the preview camera looks down at them from y=0.9 - the
 *  keystoned Windows XP / film cards. Same anchor, same math, on a wrapper. */
function FullFramePreviewAnchor({ children }: { children: React.ReactNode }) {
  const groupRef = useRef<Group>(null)
  useFrame(({ camera }) => {
    const g = groupRef.current
    if (!g) return
    composeScreenAnchor(camera.position, camera.quaternion, undefined, _fullFrameAnchor)
    _fullFrameAnchor.decompose(g.position, g.quaternion, g.scale)
  })
  return <group ref={groupRef}>{children}</group>
}

export function ObjectPreview({ instrumentId, trackId = PREVIEW_TRACK_ID, notes, sync }: { instrumentId: string; trackId?: string; notes?: ResolvedNote[]; sync?: boolean }) {
  const def = getInstrument(instrumentId)
  if (!def) return null
  const Comp = def.component
  const content = (
    <Suspense fallback={null}>
      <Comp trackId={trackId} />
    </Suspense>
  )
  return (
    <>
      <ObjectPreviewDriver instrumentId={instrumentId} trackId={trackId} notes={notes} sync={sync} />
      {def.fullFrame ? <FullFramePreviewAnchor>{content}</FullFramePreviewAnchor> : content}
    </>
  )
}

// ── Mover/splitter preview: a cube through the resolved chain ───────────────

// Movers speak the signed-basis vocabulary (motionBasis.ts): 60/61 = ±X,
// 62/63 = ±Y, 64/65 = ±Z. Notes every 2 beats, HELD for the full 2 beats:
// burst movers react only to onsets (kick, ease out, rest until the next one),
// while constant movers and oscillators accumulate over held time - always
// held means genuinely constant motion, switching axis every 2 beats. 66
// (Return) is deliberately absent: it damps everything to the origin.
const MOVER_NOTES = makeLoopNotes([60, 62, 64, 61, 63, 65, 60, 63], 2, 2)

const MAX_COPIES = 24
const CUBE_BASE_COLOR = new Color('#35a7e6')

// Movers get an OFF-ORIGIN cube: at the origin with an identity seed, rotate
// (transform × R) and orbit (R × transform) produce the same matrix, so they
// previewed identically. Offset, self-rotation spins in place while an orbit
// visibly circles the origin marker. Splitters keep the identity seed - their
// several copies are the point, and the offset would just push the arrangement
// off-frame.
const MOVER_BASE_OFFSET = 1.3

/** One long held note - constant-rate blocks (spins, radii) read held time. */
const holdNote = (pitch: number, beat = 0, durationBeats = LOOP_BEATS): ResolvedNote => ({
  beat,
  blockStartBeat: 0,
  blockEndBeat: 1e9,
  pitch,
  velocity: 100,
  durationBeats,
})

/** N seed positions around a camera-facing circle. */
const ringSeeds = (n: number, r: number): Array<[number, number, number]> =>
  Array.from({ length: n }, (_, i) => [
    Math.cos((i / n) * Math.PI * 2) * r,
    Math.sin((i / n) * Math.PI * 2) * r,
    0,
  ])

/** cols x rows of camera-facing seed positions, centered on the origin. */
const gridSeeds = (cols: number, rows: number, spacing: number): Array<[number, number, number]> => {
  const out: Array<[number, number, number]> = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push([(c - (cols - 1) / 2) * spacing, (r - (rows - 1) / 2) * spacing, 0])
    }
  }
  return out
}

// The compound movers choreograph WHOLE ARRANGEMENTS, so their library cards
// preview a field of small cubes instead of the single offset cube. Radial
// Motion is structural (it mints its own copies), so one centered seed shows
// the full bloom; the pure movers run a ring of seeds through the chain in
// parallel. Notes speak each definition's own vocabulary.
interface CompoundMoverPreview {
  seeds: Array<[number, number, number]>
  /** Uniform scale baked into each seed - the "many smaller objects" look. */
  seedScale: number
  settings?: Record<string, number>
  notes: ResolvedNote[]
  /** Cycle setting overlays over time: every `beatsPer` beats the preview
   *  re-resolves the definition with the next cell merged over `settings` -
   *  how one card demos a whole (motion x mode) matrix in sequence. */
  sequence?: { beatsPer: number; cells: Record<string, number>[] }
  /** Radians per beat of presentation tumble applied to each SEED (outside the
   *  definition - the layout stays exactly what the def builds). Splitters
   *  build STILL arrangements, so without this their cards (and captured
   *  clips) are freeze-frames; a slow turntable keeps them honest AND alive.
   *  For a single origin seed the whole formation turns; for a seed field
   *  each seed tumbles in place. */
  turntable?: number
}
const COMPOUND_MOVER_PREVIEWS: Record<string, CompoundMoverPreview> = {
  // The unified Mover's default cell (translate x burst) stepping a ring of
  // seeds through the generic 60-65 arc - the same phrase every mover card
  // speaks, so the card reads as the family's fundamental.
  mover: {
    seeds: ringSeeds(8, 1.5),
    seedScale: 0.42,
    notes: MOVER_NOTES,
    // The card demos the whole family: the ring steps outward (translate x
    // burst), spins in place (rotate x constant), then revolves around the
    // center (orbit x constant) - eight beats each, on repeat.
    sequence: {
      beatsPer: 8,
      cells: [
        { motion: 0, mode: 0 },
        { motion: 1, mode: 1, angleX: 0, angleY: 0, angleZ: 45 },
        { motion: 2, mode: 1, angleX: 0, angleY: 0, angleZ: 45 },
      ],
    },
  },
  // Three nested rings of 6x3x2, shrunk to fit the card. All three depths turn
  // on their own - the mover needs no notes to move - so the only notes here
  // step the OUTER radius multiplier (36-39 = collapse/half/home/double) and
  // the arrangement BLOOMS out of the center and folds back in while it spins.
  radialMotion: {
    seeds: [[0, 0, 0]],
    seedScale: 0.34,
    settings: {
      copies0: 6, copies1: 3, copies2: 2,
      radius0: 1.9, radius1: 0.85, radius2: 0.38,
    },
    notes: [36, 37, 38, 39, 39, 38, 37, 36].map((pitch, i) => holdNote(pitch, i * 2, 2)),
  },
  // Motion's Step block is the 60-65 signed basis the generic arc already
  // speaks; a held Spin +Z (72+4) keeps the whole ring turning while it steps.
  motion: {
    seeds: ringSeeds(8, 1.5),
    seedScale: 0.42,
    notes: [...MOVER_NOTES, holdNote(76)],
  },
  // The consolidated rack's pitches are bank-relative: its Motion bank starts
  // at 0 with rows drift 0-5, return 6, step 7-12, spin 13-18 - so this is the
  // same step arc + held spin as `motion`, transposed into the rack's lane.
  allMovers: {
    seeds: ringSeeds(8, 1.5),
    seedScale: 0.42,
    notes: [...makeLoopNotes([7, 9, 11, 8, 10, 12, 7, 10], 2, 2), holdNote(17)],
  },
  // Meteor Impact strikes the center of a camera-facing field: the shockwave
  // front visibly travels outward through the neighbors, springs and settles
  // (60 = Impact, once per bar).
  meteorImpact: {
    seeds: gridSeeds(7, 5, 0.72),
    seedScale: 0.3,
    notes: makeLoopNotes([60], 0.5, 4),
  },
  // Wave Terrain displaces along scene Z at each copy's own (x, y): the same
  // grid rides the rolling surface while Amplitude-up (60) is held, settling
  // as the hold ends so the loop restarts from calm water.
  waveTerrain: {
    seeds: gridSeeds(7, 5, 0.72),
    seedScale: 0.3,
    notes: [holdNote(60, 0, 12)],
  },
  // Force Field Pulse pushes every copy radially from the center - the grid
  // breathes out, anticipates in-then-out, pulls in, and spiral-twists, one
  // gesture per bar (its four note vocabularies).
  forceFieldPush: {
    seeds: gridSeeds(7, 5, 0.72),
    seedScale: 0.3,
    notes: makeLoopNotes([60, 62, 61, 64], 0.5, 4),
  },
  // Impact Scatter integrates hits into the field's momentum, so the loop
  // tells that story: one clean blast, a rapid triple that visibly compounds
  // (each kick lands on pieces already flying), an implode, then a blast
  // yanked home mid-flight by the settle row. IMPACT is preview-tamed so the
  // throw stays inside the popup's frame.
  impactScatter: {
    seeds: gridSeeds(7, 5, 0.72),
    seedScale: 0.3,
    settings: { impact: 0.5, recoverBeats: 2, chaos: 0.6 },
    notes: [
      holdNote(60, 0, 0.25),
      holdNote(60, 4, 0.25),
      holdNote(60, 4.5, 0.25),
      holdNote(60, 5, 0.25),
      holdNote(61, 8, 0.25),
      holdNote(60, 12, 0.25),
      holdNote(62, 13.5, 0.25),
    ],
  },
  // Impact Pulse punches SIZE, so the whole field pops together like a drum
  // hit: swell and squash alternate, with enough STRETCH that grow reads
  // tall-and-narrow and shrink short-and-wide, and a decay long enough to
  // watch fall away at popup scale.
  impactPulse: {
    seeds: gridSeeds(7, 5, 0.72),
    seedScale: 0.3,
    settings: { hit: 0.55, decayBeats: 1, stretch: 0.6 },
    notes: makeLoopNotes([60, 61], 0.5, 2),
  },
  // Visibility gates existence itself: ONE full-size cube popping in and out
  // with its note (127 = the single copy's row).
  visibility: {
    seeds: [[0, 0, 0]],
    seedScale: 1,
    notes: makeLoopNotes([127], 0.5, 1),
  },
  // ── Structural splitters ──
  // These build STILL arrangements, so without an entry their cards captured
  // as freeze-frames (found in the 2026-08-07 clip audit). Each gets the
  // turntable plus, where the vocabulary has one, slot-disable notes blinking
  // cells off (top row = 127, descending) so MIDI's reach is visible too.
  // NOTE for all single-seed structural entries: the chain composes LOCALLY,
  // so the splitter's distances are measured in the SEED's scaled frame - a
  // 0.3x seed shrinks every spacing/radius by 0.3x too. Settings distances
  // here are therefore pre-divided by seedScale to land at the intended world
  // size (get this wrong and the formation collapses into one merged blob,
  // which is exactly how the first capture round came out).
  grid: {
    seeds: [[0, 0, 0]],
    seedScale: 0.34,
    settings: { rows: 3, columns: 3, depth: 1, spacing: 3 },
    turntable: 0.35,
    notes: [holdNote(127, 4, 1), holdNote(123, 8, 1), holdNote(119, 12, 1)],
  },
  radial: {
    seeds: [[0, 0, 0]],
    seedScale: 0.3,
    // Radius up from its 0 default: at 0 all copies rotate IN PLACE, which on
    // a cube renders as one static rosette - the old broken card.
    settings: { copies: 8, radius: 4.5, plane: 0 },
    turntable: 0.4,
    notes: [holdNote(127, 4, 1), holdNote(124, 8, 1), holdNote(121, 12, 1)],
  },
  polyhedron: {
    seeds: [[0, 0, 0]],
    seedScale: 0.24,
    settings: { radius: 6 },
    turntable: 0.4,
    notes: [],
  },
  // Symmetry mirrors the SEED about lines through the center - a tumbling
  // off-axis seed is the story, its reflections counter-tumbling in step.
  symmetry: {
    seeds: [[1.0, 0.35, 0]],
    seedScale: 0.4,
    settings: { mirrors: 3, spread: 1.5 },
    turntable: 0.8,
    notes: [],
  },
  // Parametric Pattern moves on its own; the entry exists for FRAMING - the
  // default 48 copies at full seed scale filled the card with illegible slabs
  // (and overflowed the 24-copy preview pool).
  parametricPattern: {
    seeds: [[0, 0, 0]],
    seedScale: 0.22,
    settings: { copies: 20, radius: 7, amount: 1 },
    turntable: 0.3,
    notes: [],
  },
  // ── Movers/colorizers whose default single-cube card sat still ──
  // Symmetric Motion moves copies about the center, so it needs a FORMATION
  // to move: a ring breathing out, turning, pulling in, counter-turning - one
  // gesture per bar in its radial vocabulary (60/61 = out/in, 62/63 = turn).
  symmetricMotion: {
    seeds: ringSeeds(8, 1.4),
    seedScale: 0.36,
    notes: makeLoopNotes([60, 62, 61, 63], 1, 4),
  },
  // Gradient is a passive ramp across copies BY WORLD POSITION - a turning
  // ring shows the two-stop ramp sweeping through the field. Span is pinned to
  // the ring's diameter so the full A-to-B travel is on screen.
  gradient: {
    seeds: ringSeeds(10, 1.5),
    seedScale: 0.36,
    settings: { span: 3.2 },
    turntable: 0.5,
    notes: [],
  },
  // Conveyor carries the formation as a belt - a field of seeds sliding
  // right for a bar-pair, then up (held notes = belt running, Burst pitches).
  conveyor: {
    seeds: gridSeeds(5, 3, 0.8),
    seedScale: 0.3,
    notes: [holdNote(60, 0, 8), holdNote(62, 8, 8)],
  },
}

export function MoverPreview({ moverId, notes, sync, inputValues }: { moverId: string; notes?: ResolvedNote[]; sync?: boolean; inputValues?: Record<string, number> }) {
  const def = getMoverOrSplitterDefinition(moverId)
  const compound = COMPOUND_MOVER_PREVIEWS[moverId]
  const meshesRef = useRef<Mesh[]>([])
  const chain = useMemo(() => {
    if (!def) return null
    return def.resolve({
      settings: mergeDefinitionSettings(def, inputValues ?? compound?.settings),
      notes: notes && notes.length > 0 ? notes : compound?.notes ?? MOVER_NOTES,
    })
  }, [def, notes, inputValues, compound])
  const offsetSeed = def?.kind === 'mover' && !compound
  // Sequenced previews re-resolve on each cell boundary (resolve is a cheap
  // closure build); the current cell's chain is cached between boundaries.
  const sequencedRef = useRef<{ cell: number; chain: NonNullable<typeof chain> } | null>(null)

  useFrame((root) => {
    if (!chain) return
    let beat = previewBeatNow(root.clock.elapsedTime, sync)
    let activeChain = chain
    const sequence = !inputValues && !notes?.length ? compound?.sequence : undefined
    if (def && sequence) {
      const cell = Math.floor(beat / sequence.beatsPer) % sequence.cells.length
      if (sequencedRef.current?.cell !== cell) {
        sequencedRef.current = {
          cell,
          chain: def.resolve({
            settings: mergeDefinitionSettings(def, { ...compound?.settings, ...sequence.cells[cell] }),
            notes: compound?.notes ?? MOVER_NOTES,
          }),
        }
      }
      activeChain = sequencedRef.current.chain
      // Each cell reads time from its own start, so constant cells don't jump
      // in mid-spin and burst notes land at the cell's opening beats.
      beat = beat % sequence.beatsPer
    }
    const meshes = meshesRef.current
    let used = 0
    for (const seedPosition of compound?.seeds ?? [null]) {
      if (used >= meshes.length) break
      const seed = identityVisualCopy()
      if (seedPosition) {
        seed.transform.makeTranslation(seedPosition[0], seedPosition[1], seedPosition[2])
        if (compound?.turntable) {
          seed.transform
            .multiply(_seedSpinMatrix.makeRotationY(beat * compound.turntable))
            .multiply(_seedTiltMatrix.makeRotationX(beat * compound.turntable * 0.53))
        }
        seed.transform.multiply(_seedScaleMatrix.makeScale(compound!.seedScale, compound!.seedScale, compound!.seedScale))
      } else if (offsetSeed) {
        seed.transform.makeTranslation(MOVER_BASE_OFFSET, 0, 0)
      }
      const copies: VisualCopy[] = activeChain.apply(seed, { beat, index: 0, count: 1 })
      for (const copy of copies) {
        if (used >= meshes.length) break
        const mesh = meshes[used++]
        if (!mesh) continue
        mesh.visible = true
        mesh.matrixAutoUpdate = false
        mesh.matrix.copy(copy.transform)
        const mat = mesh.material as MeshStandardMaterial
        mat.transparent = true
        mat.opacity = copy.opacity
        mat.color.copy(CUBE_BASE_COLOR)
        // The ABSOLUTE color channel (colorizers' tint) mixes first, then the
        // relative HSL offsets ride on top - same order as the real pipeline
        // (core/visual/instrumentColor.ts). Skipping tint left the Gradient
        // colorizer's card all base-blue.
        if (copy.colorShift.tint && copy.colorShift.tintAmount > 0) {
          mat.color.lerp(_tintColor.set(copy.colorShift.tint), Math.min(1, copy.colorShift.tintAmount))
        }
        mat.color.offsetHSL(copy.colorShift.hue, copy.colorShift.saturation, copy.colorShift.lightness)
      }
    }
    for (let i = used; i < meshes.length; i++) {
      if (meshes[i]) meshes[i].visible = false
    }
  })

  if (!chain) return null
  // Fields need one mesh per seed plus headroom for self-multiplying movers
  // (Radial Motion mints copies from its single seed).
  const poolSize = compound ? compound.seeds.length + MAX_COPIES : MAX_COPIES
  return (
    <>
      {/* Static origin marker: the fixed point orbits circle around. */}
      {offsetSeed && (
        <mesh>
          <boxGeometry args={[0.14, 0.14, 0.14]} />
          <meshBasicMaterial color="#3a3a42" toneMapped={false} />
        </mesh>
      )}
      {/* The "gone" ghost: the object exactly where it would sit WITHOUT this
          mover/splitter - the solid copies show what adding it does. A field
          of small seeds needs no ghost; the motion itself is the story. */}
      {!compound && (
        <mesh position={offsetSeed ? [MOVER_BASE_OFFSET, 0, 0] : [0, 0, 0]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={CUBE_BASE_COLOR} transparent opacity={0.12} wireframe />
        </mesh>
      )}
      {Array.from({ length: poolSize }, (_, i) => (
        <mesh key={i} ref={(m) => { if (m) meshesRef.current[i] = m }} visible={false}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={CUBE_BASE_COLOR} />
        </mesh>
      ))}
    </>
  )
}
const _seedScaleMatrix = new Matrix4()
const _seedSpinMatrix = new Matrix4()
const _seedTiltMatrix = new Matrix4()
const _tintColor = new Color()

// ── Project-accurate track-row previews ─────────────────────────────────────
//
// Timeline rows preview the REAL project, not the library demos: the row's
// object renders with its stored params, its own notes, and its full mover and
// splitter chain applied - "the final visual, but just this element". Hovering
// a mover/splitter row previews the object it actually moves, twice: a faint
// ghost of the chain WITHOUT this track next to the solid chain WITH it, so
// the row shows exactly what adding it does. Everything routes through the
// same resolveProject the engine uses, so settings, notes, automation and
// envelopes all match the canvas.

const PROJECT_PREVIEW_TRACK_ID = '__project-track-preview__'
// Copy cap: a 32-copy splitter would mount 32 full instrument components in a
// tiny popup; the first 8 tell the story.
const MAX_PROJECT_OCCURRENCES = 8
const GHOST_OPACITY = 0.16

interface ProjectPreviewData {
  /** The object to draw, with its full chain (for mover rows: chain WITH the mover). */
  object: ResolvedObject
  /** Mover rows only: the same object resolved with the hovered track muted. */
  ghostObject?: ResolvedObject
  copyCount: number
  ghostCount: number
  /** Paused-loop window start (beats): a bar boundary near the first relevant note. */
  loopStart: number
  bpm: number
  beatsPerBar: number
}

function firstNoteBeat(notes: readonly ResolvedNote[]): number | null {
  let min: number | null = null
  for (const n of notes) if (min === null || n.beat < min) min = n.beat
  return min
}

/** Resolve the hovered track row against the live project. Returns null when
 *  there is nothing project-accurate to show (unknown track, mover with no
 *  target object yet) - the caller falls back to the generic library preview. */
function buildProjectPreview(projectTrackId: string): ProjectPreviewData | null {
  const s = useProjectStore.getState()
  const track = s.tracks[projectTrackId]
  if (!track) return null
  const snapshot: ProjectSnapshot = {
    tracks: s.tracks,
    rootTrackIds: s.rootTrackIds,
    bpm: s.bpm,
    beatsPerBar: s.beatsPerBar,
    totalBars: s.totalBars,
  }
  const graph = resolveProject(snapshot)
  const alignToBar = (beat: number | null) =>
    beat === null ? 0 : Math.floor(beat / s.beatsPerBar) * s.beatsPerBar

  if (track.instrumentId) {
    const object = graph.objects.find((o) => o.trackId === projectTrackId)
    if (!object || get2DPreview(object.instrumentId)) return null
    return {
      object,
      copyCount: Math.min(MAX_PROJECT_OCCURRENCES, resolveVisualCopies(object.moverAndSplitterChain, 0).length),
      ghostCount: 0,
      loopStart: alignToBar(firstNoteBeat(object.notes)),
      bpm: s.bpm,
      beatsPerBar: s.beatsPerBar,
    }
  }

  if (track.type !== 'mover' && track.type !== 'splitter') return null

  // The object this mover/splitter acts on: its parent object for chain
  // children, else the first routed target that resolves to an object.
  let targetId: string | undefined
  if (track.parentId && s.tracks[track.parentId]?.instrumentId) {
    targetId = track.parentId
  } else {
    outer: for (const routing of track.targets ?? []) {
      const scope = routing.scope
      if (scope.kind === 'track') {
        if (graph.objects.some((o) => o.trackId === scope.id)) { targetId = scope.id; break }
      } else if (scope.kind === 'tag') {
        for (const o of graph.objects) {
          if (o.tags.includes(scope.tag)) { targetId = o.trackId; break outer }
        }
      } else {
        for (const o of graph.objects) {
          let current: (typeof s.tracks)[string] | undefined = s.tracks[o.trackId]
          while (current) {
            if (current.id === scope.id) { targetId = o.trackId; break outer }
            current = current.parentId ? s.tracks[current.parentId] : undefined
          }
        }
      }
    }
  }
  if (!targetId) return null
  const object = graph.objects.find((o) => o.trackId === targetId)
  if (!object || get2DPreview(object.instrumentId)) return null

  // "Gone": the exact same project with just this track muted - resolve drops
  // muted entries from the chain, so the ghost is the world without the mover.
  const withoutGraph = resolveProject({
    ...snapshot,
    tracks: { ...snapshot.tracks, [projectTrackId]: { ...track, muted: true } },
  })
  const ghostObject = withoutGraph.objects.find((o) => o.trackId === targetId)
  const trackFirstNote = firstNoteBeat(flattenProjectTrackNotes(track, s.beatsPerBar, s.totalBars))
  return {
    object,
    ghostObject,
    copyCount: Math.min(MAX_PROJECT_OCCURRENCES, resolveVisualCopies(object.moverAndSplitterChain, 0).length),
    ghostCount: ghostObject
      ? Math.min(MAX_PROJECT_OCCURRENCES, resolveVisualCopies(ghostObject.moverAndSplitterChain, 0).length)
      : 0,
    loopStart: alignToBar(trackFirstNote ?? firstNoteBeat(object.notes)),
    bpm: s.bpm,
    beatsPerBar: s.beatsPerBar,
  }
}

export interface AffectedObjectPreview {
  object: ResolvedObject
  bpm: number
  beatsPerBar: number
  /** Bar boundary near the object's first note - a paused preview loops from here. */
  loopStart: number
}

/** The object a mover/splitter track actually acts on - the same resolution as
 *  buildProjectPreview's mover branch (the parent object for chain children,
 *  else the first routing that resolves to an object), for surfaces that render
 *  the affected object outside the hover popup. */
export function resolveAffectedObject(projectTrackId: string, snapshot: ProjectSnapshot): AffectedObjectPreview | null {
  const track = snapshot.tracks[projectTrackId]
  if (!track || (track.type !== 'mover' && track.type !== 'splitter')) return null
  const graph = resolveProject(snapshot)
  let targetId: string | undefined
  if (track.parentId && snapshot.tracks[track.parentId]?.instrumentId) {
    targetId = track.parentId
  } else {
    outer: for (const routing of track.targets ?? []) {
      const scope = routing.scope
      if (scope.kind === 'track') {
        if (graph.objects.some((o) => o.trackId === scope.id)) { targetId = scope.id; break }
      } else if (scope.kind === 'tag') {
        for (const o of graph.objects) {
          if (o.tags.includes(scope.tag)) { targetId = o.trackId; break outer }
        }
      } else {
        for (const o of graph.objects) {
          let current: (typeof snapshot.tracks)[string] | undefined = snapshot.tracks[o.trackId]
          while (current) {
            if (current.id === scope.id) { targetId = o.trackId; break outer }
            current = current.parentId ? snapshot.tracks[current.parentId] : undefined
          }
        }
      }
    }
  }
  if (!targetId) return null
  const object = graph.objects.find((o) => o.trackId === targetId)
  if (!object || get2DPreview(object.instrumentId)) return null
  const firstNote = firstNoteBeat(object.notes)
  return {
    object,
    bpm: snapshot.bpm,
    beatsPerBar: snapshot.beatsPerBar,
    loopStart: firstNote === null ? 0 : Math.floor(firstNote / snapshot.beatsPerBar) * snapshot.beatsPerBar,
  }
}

/** Per-frame data every occurrence group reads; written once by the driver. */
interface ProjectFrame {
  world: Matrix4
  /** The object's size scale, kept out of `world` (applied after the copy). */
  meshScale: number
  opacity: number
  copies: VisualCopy[]
  ghostCopies: VisualCopy[]
}

/** One object's ObjectState at a beat - the popup's stand-in for computeAtBeat:
 *  energy, automation lanes, envelope lanes and the local transform all follow
 *  the engine's merge order; only the parent world (soloed preview centers the
 *  object) and fx overrides are omitted. */
export function computeProjectState(
  obj: ResolvedObject,
  beat: number,
  bpm: number,
  beatsPerBar: number,
  world: Matrix4,
): ObjectState {
  const energy = obj.notes.length > 0 ? evaluatePulse(obj.notes, beat) : 0
  let params = obj.params
  if (obj.automations.length) {
    params = { ...obj.params }
    for (const auto of obj.automations) {
      const v = sampleAutomationLane(auto, beat, params[auto.param] ?? auto.base ?? 0)
      if (!Number.isNaN(v)) params[auto.param] = v
    }
  }
  let opacityGate = 1
  for (const env of obj.envelopes) {
    if (env.notes.length === 0) continue
    const gain = evaluateAdsrGain(env.notes, beat, env.adsr)
    if (env.kind === 'opacity') {
      opacityGate *= 1 - env.depth + env.depth * gain
    } else if (env.kind === 'param' && env.param !== undefined) {
      if (params === obj.params) params = { ...obj.params }
      const base = params[env.param] ?? env.paramDefault ?? 0
      params[env.param] = base + (env.envTarget - base) * (gain * env.depth)
    }
  }
  const local = obj.localTransform ? obj.localTransform({ params, energy, beat }) : {}
  localTransformToSV(local, obj.scratchBase)
  // Same split as computeAtBeat: the size scale stays OUT of the placement world
  // (movers lay out in unscaled space) and rides the frame separately.
  const meshScale = Math.exp(obj.scratchBase.logScale)
  obj.scratchBase.logScale = 0
  composeMatrix(obj.scratchBase, world)
  const opacity = Math.max(0, Math.min(1, obj.scratchBase.opacity * opacityGate))
  const activeNotes = obj.notes.filter((n) => beat >= n.beat && beat < n.beat + (n.durationBeats || 0.05))
  return {
    beat,
    secPerBeat: 60 / bpm,
    beatsPerBar,
    params,
    automations: [],
    baseParams: params,
    energy,
    videoPads: obj.videoPads,
    photoPads: obj.photoPads,
    world,
    meshScale,
    opacity,
    blackedOut: false,
    stringParams: obj.stringParams,
    abilityEvents: obj.abilityEvents,
    notes: obj.notes,
    activeNotes,
  }
}

/** Runs before every occurrence (mount order): advances the beat, registers the
 *  shared ObjectState, and evaluates both chains for this frame. */
function ProjectPreviewDriver({ data, sync, frame }: { data: ProjectPreviewData; sync?: boolean; frame: ProjectFrame }) {
  useFrame((root) => {
    const t = useTimeStore.getState()
    const beat = sync && t.isPlaying
      ? t.currentBeat
      : data.loopStart + previewBeat(root.clock.elapsedTime)
    const state = computeProjectState(data.object, beat, data.bpm, data.beatsPerBar, frame.world)
    frame.meshScale = state.meshScale
    frame.opacity = state.opacity
    setPreviewObjectState(PROJECT_PREVIEW_TRACK_ID, state)
    frame.copies = resolveVisualCopies(data.object.moverAndSplitterChain, beat)
    frame.ghostCopies = data.ghostObject
      ? resolveVisualCopies(data.ghostObject.moverAndSplitterChain, beat)
      : []
  })
  useEffect(() => () => setPreviewObjectState(PROJECT_PREVIEW_TRACK_ID, null), [])
  return null
}

const _occurrenceMatrix = new Matrix4()

/** One rendered copy of the object - the popup's ObjectRenderer: placement =
 *  local world × this occurrence's copy transform, opacity/color from the copy
 *  (ghosts additionally faded to read as "without"). Full-frame objects pin to
 *  the camera-facing screen anchor with the copy applied inside it, exactly
 *  like ObjectRenderer's full-frame branch. */
function ProjectOccurrence({
  component: Component,
  index,
  ghost,
  frame,
  fullFrame,
}: {
  component: NonNullable<ReturnType<typeof getInstrument>>['component']
  index: number
  ghost: boolean
  frame: ProjectFrame
  fullFrame: boolean
}) {
  const groupRef = useRef<Group>(null)
  useFrame(({ camera }) => {
    const g = groupRef.current
    if (!g) return
    const copy = (ghost ? frame.ghostCopies : frame.copies)[index]
    g.visible = !!copy
    if (!copy) return
    if (fullFrame) composeScreenAnchor(camera.position, camera.quaternion, copy.transform, _occurrenceMatrix)
    else _occurrenceMatrix.multiplyMatrices(frame.world, copy.transform)
    _occurrenceMatrix.decompose(g.position, g.quaternion, g.scale)
    // Size scales the mesh inside the mover/copy layout (full-frame occurrences
    // never applied the placement scale, so they skip it here too).
    if (!fullFrame) g.scale.multiplyScalar(frame.meshScale)
    applyMaterialOpacity(g, frame.opacity * copy.opacity * (ghost ? GHOST_OPACITY : 1))
    applyMaterialHueShift(g, copy.colorShift.hue, copy.colorShift.saturation, copy.colorShift.lightness)
  })
  return (
    <group ref={groupRef}>
      <Suspense fallback={null}>
        <Component trackId={PROJECT_PREVIEW_TRACK_ID} />
      </Suspense>
    </group>
  )
}

function ProjectTrackPreview({ data, sync }: { data: ProjectPreviewData; sync?: boolean }) {
  // Keyed by the hover data on purpose: a fresh frame per hover so a stale
  // world matrix from the previous row can never bleed into the first paint.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const frame = useMemo<ProjectFrame>(
    () => ({ world: new Matrix4(), meshScale: 1, opacity: 1, copies: [], ghostCopies: [] }),
    [data],
  )
  const def = getInstrument(data.object.instrumentId)
  if (!def) return null
  return (
    <>
      <ProjectPreviewDriver data={data} sync={sync} frame={frame} />
      {Array.from({ length: data.ghostCount }, (_, i) => (
        <ProjectOccurrence key={`ghost-${i}`} component={def.component} index={i} ghost frame={frame} fullFrame={!!def.fullFrame} />
      ))}
      {Array.from({ length: data.copyCount }, (_, i) => (
        <ProjectOccurrence key={i} component={def.component} index={i} ghost={false} frame={frame} fullFrame={!!def.fullFrame} />
      ))}
    </>
  )
}

// ── The popup layer ──────────────────────────────────────────────────────────
//
// ONE persistent popup with ONE always-mounted <Canvas>, shared by every row of
// every section. Mounting a fresh Canvas per hover paid WebGL context creation
// + first shader compile on every popup (~seconds in dev) - the box appeared,
// then sat dark before anything moved. Keeping the context warm makes a hover
// paint moving content on its next frame. While no row is hovered the layer is
// hidden and the frameloop is 'never', so the idle cost is one dormant context.

type PreviewTarget = {
  item: InstrumentItem
  anchor: { left: number; top: number }
  /** Track-row previews: the row's real notes + follow-the-transport sync. */
  notes?: ResolvedNote[]
  sync?: boolean
  /** Mover/splitter rows: the track's stored settings. */
  inputValues?: Record<string, number>
  /** Timeline rows: preview the real project track (settings, notes, chain) -
   *  falls back to the generic preview when it can't resolve to an object. */
  projectTrackId?: string
}

let currentPreview: PreviewTarget | null = null
const previewListeners = new Set<() => void>()

export function setInstrumentPreview(target: PreviewTarget | null): void {
  currentPreview = target && canPreview(target.item) ? target : null
  previewListeners.forEach((l) => l())
}

function subscribePreview(l: () => void): () => void {
  previewListeners.add(l)
  return () => previewListeners.delete(l)
}

/** Mounted once in the sidebar. */
export function InstrumentPreviewLayer() {
  const preview = useSyncExternalStore(subscribePreview, () => currentPreview, () => null)
  const top = preview
    ? Math.max(8, Math.min(preview.anchor.top - 12, window.innerHeight - 148))
    : -9999
  // Bespoke 2D vignettes bypass the R3F canvas entirely: the warm GL context
  // stays mounted (frameloop 'never') under a cheap 2D canvas that mounts per
  // hover - no context creation, so it's moving on its first frame too.
  const draw2d = preview ? get2DPreview(preview.item.id) : undefined
  // Timeline rows resolve against the live project (memo per hover - resolve
  // is cheap at project scale, but not per-frame cheap).
  const projectData = useMemo(
    () => (preview?.projectTrackId ? buildProjectPreview(preview.projectTrackId) : null),
    [preview],
  )
  return (
    <div
      className="fixed z-[90] w-[228px] h-[128px] rounded border border-[var(--border)] bg-transparent shadow-xl shadow-black/60 pointer-events-none overflow-hidden"
      style={preview ? { left: preview.anchor.left + 8, top } : { left: -9999, top, visibility: 'hidden' }}
    >
      {/* dpr follows the device (clamped) - at dpr 1 a HiDPI screen renders the
          popup half-res, which text previews show as blur. The canvas is tiny,
          so the extra pixels cost nothing. */}
      <Canvas dpr={[1, 2]} frameloop={preview && !draw2d ? 'always' : 'never'} camera={{ position: [0, 0.9, 4.2], fov: 55 }} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 4, 5]} intensity={1.1} />
        {preview && !draw2d && (projectData
          ? <ProjectTrackPreview key={preview.projectTrackId} data={projectData} sync={preview.sync} />
          : preview.item.kind === 'object'
            ? <ObjectPreview key={preview.item.id} instrumentId={preview.item.id} notes={preview.notes} sync={preview.sync} />
            : <MoverPreview key={preview.item.id} moverId={preview.item.id} notes={preview.notes} sync={preview.sync} inputValues={preview.inputValues} />)}
        <LaserPreviewBloom instrumentId={projectData?.object.instrumentId ?? preview?.item.id} />
      </Canvas>
      {preview && draw2d && <Preview2D key={preview.item.id} draw={draw2d} />}
    </div>
  )
}

// Expanding a section mounts a whole column of clip cards at once; letting
// every <video> fetch + spin up a decoder simultaneously stalls the main
// thread. This tiny gate staggers the INITIAL loads: a card may mount its
// video only while a slot is free, and passes the slot on when its first
// frame is ready (loadeddata) or it errors. Already-loaded videos keep
// playing - slots only meter the expensive startup.
const MAX_CONCURRENT_CLIP_LOADS = 3
let activeClipLoads = 0
const clipLoadQueue: Array<() => void> = []

function releaseClipLoadSlot() {
  activeClipLoads--
  clipLoadQueue.shift()?.()
}

/** `ready` turns true once this card may mount its <video>; call `done()` when
 *  the video has loaded (or failed) to hand the slot to the next card. */
function useClipLoadSlot(wanted: boolean): { ready: boolean; done: () => void } {
  const [ready, setReady] = useState(false)
  const doneRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (!wanted) return
    let alive = true
    let granted = false
    let finished = false
    const grant = () => {
      // Slot arrived after unmount/scroll-out: pass it straight on.
      if (!alive) { releaseClipLoadSlot(); return }
      granted = true
      setReady(true)
    }
    if (activeClipLoads < MAX_CONCURRENT_CLIP_LOADS) {
      activeClipLoads++
      grant()
    } else {
      clipLoadQueue.push(() => { activeClipLoads++; grant() })
    }
    doneRef.current = () => {
      if (granted && !finished) { finished = true; releaseClipLoadSlot() }
    }
    return () => {
      alive = false
      if (granted && !finished) { finished = true; releaseClipLoadSlot() }
      setReady(false)
    }
  }, [wanted])
  return { ready, done: () => doneRef.current() }
}

/** The library card's preview. Clip-first: 3D previews play their captured 8s
 * loop from the instrument-previews bucket (one <video>, no per-frame GPU cost,
 * and the bloom pass baked in - see InstrumentPreviewCapture). Ids without a
 * clip (or a failed load) show a quiet NAMEPLATE - never a live render: a
 * column of WebGL Views is exactly the card lag the clip pipeline removed, so
 * a new instrument's card stays blank-with-name until
 * `npm run previews:instruments` captures it. 2D instrument vignettes keep
 * their lightweight ordinary canvases; the hover POPUP stays live. */
export function InstrumentCardPreview({ item }: { item: InstrumentItem }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [nearViewport, setNearViewport] = useState(false)
  const [clipFailed, setClipFailed] = useState(false)
  const draw2d = get2DPreview(item.id)
  // undefined = manifest still resolving; hold the card empty instead of
  // mounting a live View that the arriving clip would immediately replace.
  const clipUrl = useInstrumentClipUrl(item.id)
  const clip = draw2d ? null : clipUrl
  const wantClip = nearViewport && !draw2d && !!clip && !clipFailed
  const clipSlot = useClipLoadSlot(wantClip)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    if (typeof IntersectionObserver === 'undefined') {
      setNearViewport(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => setNearViewport(entry.isIntersecting),
      { rootMargin: '128px 0px' },
    )
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={hostRef} className="absolute inset-0">
      {nearViewport && draw2d && <Preview2D draw={draw2d} />}
      {wantClip && clipSlot.ready && (
        <video
          src={clip!}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onLoadedData={clipSlot.done}
          onError={() => { clipSlot.done(); setClipFailed(true) }}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {nearViewport && !draw2d && (clip === null || clipFailed) && (
        <span className="absolute inset-0 flex items-center justify-center px-2 text-center text-xs font-medium text-[var(--text-muted)] select-none">
          {item.name}
        </span>
      )}
    </div>
  )
}

'use client'

import { Suspense, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Matrix4, Mesh, MeshStandardMaterial, Color } from 'three'
import { getInstrument } from '../instruments'
import { getMoverOrSplitterDefinition } from '../core/visualCopies/registry'
import { mergeDefinitionSettings } from '../core/visualCopies/definitions'
import { identityVisualCopy } from '../core/visualCopies/identityVisualCopy'
import type { VisualCopy } from '../core/visualCopies/types'
import { setPreviewObjectState } from '../core/visual/VisualEngine'
import { useTimeStore } from '../store/TimeStore'
import type { ObjectState, ResolvedNote } from '../core/visual/types'
import { get2DPreview, Preview2D } from './InstrumentPreview2D'
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

/** Track-row previews sync to the song: while the transport plays, the popup
 *  follows the project beat (the preview IS the music); paused or for plain
 *  library rows, the private 120bpm loop clock runs instead. */
function previewBeatNow(elapsedSec: number, sync?: boolean): number {
  if (sync) {
    const t = useTimeStore.getState()
    if (t.isPlaying) return t.currentBeat
  }
  return previewBeat(elapsedSec)
}

// Instruments whose real render needs context a popup can't provide (uploads,
// live audio, the scene camera, scenes to composite) get a bespoke canvas-2D
// vignette instead (InstrumentPreview2D) - that covers the Main essentials and
// every Director, so the whole library previews.
export function canPreview(item: InstrumentItem): boolean {
  if (get2DPreview(item.id)) return true
  if (item.kind === 'object') return !!getInstrument(item.id)
  if (item.kind === 'mover' || item.kind === 'splitter') return !!getMoverOrSplitterDefinition(item.id)
  return false
}

// ── Object preview: the real instrument component on synthetic state ────────

const PREVIEW_TRACK_ID = '__instrument-preview__'

// A gentle arc through the middle of most instruments' pitch ranges.
const OBJECT_NOTES = makeLoopNotes([60, 64, 67, 71, 67, 64], 0.5)

// Preview-only param overrides for instruments whose real defaults read poorly
// in a popup: Text Display defaults to the single word HELLO, which hides its
// whole point - advancing a word per note.
const PREVIEW_STRING_PARAMS: Record<string, Record<string, string>> = {
  textDisplay: { text: 'hello awesome person' },
}

// Preview-only note overrides for instruments whose labeled vocabulary the
// generic arc misses entirely. Text Display renders NOTHING without pitch 48
// ("Next word") - the 60-71 arc only hits its height lanes, leaving the popup
// black. Near-held word notes keep a word on screen while stepping it; and
// the note COUNT must divide by the 3 preview words, or the loop's wrap
// restarts the word cycle mid-sequence (hello twice in a row once per loop).
// 12 notes over the 16 beats: divisible by 3, still an even musical stride.
const PREVIEW_NOTES: Record<string, ResolvedNote[]> = {
  textDisplay: makeLoopNotes([48], 1.2, 4 / 3),
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
  return {
    beat: 0,
    secPerBeat: 60 / PREVIEW_BPM,
    beatsPerBar: 4,
    params,
    energy: 0,
    blackedOut: false,
    world: new Matrix4(),
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
function ObjectPreviewDriver({ instrumentId, notes, sync }: { instrumentId: string; notes?: ResolvedNote[]; sync?: boolean }) {
  const state = useMemo(() => {
    const s = makePreviewState(instrumentId)
    // Track rows preview their OWN notes rather than the canned arc.
    if (notes && notes.length > 0) s.notes = notes
    return s
  }, [instrumentId, notes])
  useFrame((root) => {
    const beat = previewBeatNow(root.clock.elapsedTime, sync)
    state.beat = beat
    state.activeNotes.length = 0
    let lastOnset = -Infinity
    let lastVel = 0
    for (const n of state.notes) {
      if (beat >= n.beat && beat < n.beat + n.durationBeats) state.activeNotes.push(n)
      if (n.beat <= beat && n.beat > lastOnset) { lastOnset = n.beat; lastVel = n.velocity }
    }
    state.energy = lastOnset === -Infinity ? 0 : (lastVel / 127) * Math.exp(-3 * (beat - lastOnset))
    setPreviewObjectState(PREVIEW_TRACK_ID, state)
  })
  useEffect(() => {
    return () => setPreviewObjectState(PREVIEW_TRACK_ID, null)
  }, [instrumentId])
  return null
}

function ObjectPreview({ instrumentId, notes, sync }: { instrumentId: string; notes?: ResolvedNote[]; sync?: boolean }) {
  const def = getInstrument(instrumentId)
  if (!def) return null
  const Comp = def.component
  return (
    <>
      <ObjectPreviewDriver instrumentId={instrumentId} notes={notes} sync={sync} />
      <Suspense fallback={null}>
        <Comp trackId={PREVIEW_TRACK_ID} />
      </Suspense>
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

function MoverPreview({ moverId, notes, sync, inputValues }: { moverId: string; notes?: ResolvedNote[]; sync?: boolean; inputValues?: Record<string, number> }) {
  const def = getMoverOrSplitterDefinition(moverId)
  const meshesRef = useRef<Mesh[]>([])
  const chain = useMemo(() => {
    if (!def) return null
    return def.resolve({
      settings: mergeDefinitionSettings(def, inputValues),
      notes: notes && notes.length > 0 ? notes : MOVER_NOTES,
    })
  }, [def, notes, inputValues])
  const offsetSeed = def?.kind === 'mover'

  useFrame((root) => {
    if (!chain) return
    const beat = previewBeatNow(root.clock.elapsedTime, sync)
    const seed = identityVisualCopy()
    if (offsetSeed) seed.transform.makeTranslation(MOVER_BASE_OFFSET, 0, 0)
    const copies: VisualCopy[] = chain.apply(seed, { beat, index: 0, count: 1 })
    const meshes = meshesRef.current
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i]
      if (!mesh) continue
      const copy = copies[i]
      mesh.visible = !!copy
      if (!copy) continue
      mesh.matrixAutoUpdate = false
      mesh.matrix.copy(copy.transform)
      const mat = mesh.material as MeshStandardMaterial
      mat.transparent = true
      mat.opacity = copy.opacity
      mat.color.copy(CUBE_BASE_COLOR).offsetHSL(copy.colorShift.hue, copy.colorShift.saturation, copy.colorShift.lightness)
    }
  })

  if (!chain) return null
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
          mover/splitter - the solid copies show what adding it does. */}
      <mesh position={offsetSeed ? [MOVER_BASE_OFFSET, 0, 0] : [0, 0, 0]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={CUBE_BASE_COLOR} transparent opacity={0.12} wireframe />
      </mesh>
      {Array.from({ length: MAX_COPIES }, (_, i) => (
        <mesh key={i} ref={(m) => { if (m) meshesRef.current[i] = m }} visible={false}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={CUBE_BASE_COLOR} />
        </mesh>
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
  return (
    <div
      className="fixed z-[90] w-[228px] h-[128px] rounded border border-[var(--border)] bg-[var(--bg-canvas)] shadow-xl shadow-black/60 pointer-events-none overflow-hidden"
      style={preview ? { left: preview.anchor.left + 8, top } : { left: -9999, top, visibility: 'hidden' }}
    >
      {/* dpr follows the device (clamped) - at dpr 1 a HiDPI screen renders the
          popup half-res, which text previews show as blur. The canvas is tiny,
          so the extra pixels cost nothing. */}
      <Canvas dpr={[1, 2]} frameloop={preview && !draw2d ? 'always' : 'never'} camera={{ position: [0, 0.9, 4.2], fov: 55 }} gl={{ antialias: true }}>
        <color attach="background" args={['#09090b']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 4, 5]} intensity={1.1} />
        {preview && !draw2d && (preview.item.kind === 'object'
          ? <ObjectPreview key={preview.item.id} instrumentId={preview.item.id} notes={preview.notes} sync={preview.sync} />
          : <MoverPreview key={preview.item.id} moverId={preview.item.id} notes={preview.notes} sync={preview.sync} inputValues={preview.inputValues} />)}
      </Canvas>
      {preview && draw2d && <Preview2D key={preview.item.id} draw={draw2d} />}
    </div>
  )
}

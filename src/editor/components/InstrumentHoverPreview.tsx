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
import type { ObjectState, ResolvedNote } from '../core/visual/types'
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
// The pattern loops over this span; the driver starts a few beats IN so the
// first rendered frame already has notes in the past - motion from frame one,
// no dead ramp-up while the popup appears.
const LOOP_BEATS = 16
const START_OFFSET_BEATS = 4

/** One note per beat, cycling a mid-range pitch arc so pitch-mapped
 *  instruments (spawn height, lane position) visibly vary. */
function makeLoopNotes(pitches: number[]): ResolvedNote[] {
  return Array.from({ length: LOOP_BEATS }, (_, i) => ({
    beat: i,
    blockStartBeat: 0,
    blockEndBeat: 1e9,
    pitch: pitches[i % pitches.length],
    velocity: 100,
    durationBeats: 0.5,
  }))
}

function previewBeat(elapsedSec: number): number {
  return (elapsedSec * BEATS_PER_SEC + START_OFFSET_BEATS) % LOOP_BEATS
}

// Instruments whose idle render needs context a popup can't provide (uploads,
// live audio, the scene camera, a scene to filter). Text-only popup for these.
const NO_PREVIEW = new Set(['video', 'photo', 'oscilloscope', 'cameraControl', 'colorFilters'])

export function canPreview(item: InstrumentItem): boolean {
  if (item.kind === 'object') return !NO_PREVIEW.has(item.id) && !!getInstrument(item.id)
  if (item.kind === 'mover' || item.kind === 'splitter') return !!getMoverOrSplitterDefinition(item.id)
  return false
}

// ── Object preview: the real instrument component on synthetic state ────────

const PREVIEW_TRACK_ID = '__instrument-preview__'

// A gentle arc through the middle of most instruments' pitch ranges.
const OBJECT_NOTES = makeLoopNotes([60, 64, 67, 71, 67, 64])

function makePreviewState(instrumentId: string): ObjectState {
  const def = getInstrument(instrumentId)
  const params: Record<string, number> = {}
  const stringParams: Record<string, string> = {}
  for (const p of def?.params ?? []) {
    if (p.type === 'color' || p.type === 'string') stringParams[p.key] = p.default
    else if (typeof p.default === 'number') params[p.key] = p.default
  }
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
    notes: OBJECT_NOTES,
    activeNotes: [],
  }
}

/** Mounted BEFORE the instrument component (r3f runs useFrame in mount order),
 *  so the state is registered and ticked ahead of the instrument's read.
 *  Recomputes activeNotes and the decaying energy pulse each frame - the
 *  preview's stand-in for what computeAtBeat derives on the main canvas. */
function ObjectPreviewDriver({ instrumentId }: { instrumentId: string }) {
  const state = useMemo(() => makePreviewState(instrumentId), [instrumentId])
  useFrame((root) => {
    const beat = previewBeat(root.clock.elapsedTime)
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

function ObjectPreview({ instrumentId }: { instrumentId: string }) {
  const def = getInstrument(instrumentId)
  if (!def) return null
  const Comp = def.component
  return (
    <>
      <ObjectPreviewDriver instrumentId={instrumentId} />
      <Suspense fallback={null}>
        <Comp trackId={PREVIEW_TRACK_ID} />
      </Suspense>
    </>
  )
}

// ── Mover/splitter preview: a cube through the resolved chain ───────────────

// One note per beat across the common trigger/gate pitches so ballistic lanes
// fire and gate rows toggle, looping like the object pattern.
const MOVER_NOTES = makeLoopNotes([72, 67, 64, 60])

const MAX_COPIES = 24
const CUBE_BASE_COLOR = new Color('#35a7e6')

function MoverPreview({ moverId }: { moverId: string }) {
  const def = getMoverOrSplitterDefinition(moverId)
  const meshesRef = useRef<Mesh[]>([])
  const chain = useMemo(() => {
    if (!def) return null
    return def.resolve({ settings: mergeDefinitionSettings(def, undefined), notes: MOVER_NOTES })
  }, [def])

  useFrame((root) => {
    if (!chain) return
    const beat = previewBeat(root.clock.elapsedTime)
    const copies: VisualCopy[] = chain.apply(identityVisualCopy(), { beat, index: 0, count: 1 })
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

type PreviewTarget = { item: InstrumentItem; anchor: { left: number; top: number } }

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
  return (
    <div
      className="fixed z-[90] w-[228px] h-[128px] rounded border border-[var(--border)] bg-[var(--bg-canvas)] shadow-xl shadow-black/60 pointer-events-none overflow-hidden"
      style={preview ? { left: preview.anchor.left + 8, top } : { left: -9999, top, visibility: 'hidden' }}
    >
      <Canvas dpr={1} frameloop={preview ? 'always' : 'never'} camera={{ position: [0, 0.9, 4.2], fov: 55 }} gl={{ antialias: true }}>
        <color attach="background" args={['#09090b']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 4, 5]} intensity={1.1} />
        {preview && (preview.item.kind === 'object'
          ? <ObjectPreview key={preview.item.id} instrumentId={preview.item.id} />
          : <MoverPreview key={preview.item.id} moverId={preview.item.id} />)}
      </Canvas>
    </div>
  )
}

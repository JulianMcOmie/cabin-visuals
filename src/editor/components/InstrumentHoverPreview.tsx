'use client'

import { Suspense, useEffect, useMemo, useRef } from 'react'
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
 * The hover popup for the instrument browser: name + description, plus a live
 * mini-canvas where that's meaningful. Objects render through their real
 * instrument component fed a synthetic ObjectState - in a block (so ambient
 * layers show) but with no note onsets, per the block-gated visibility rule.
 * Movers and splitters render a plain cube run through the definition's
 * resolved chain with a synthetic looping note pattern, so you see what the
 * mover DOES rather than what it is.
 *
 * The preview canvas is a separate R3F root; its driver advances a private
 * beat off the canvas clock. That clock never touches the transport or the
 * main scene - the pause invariant governs instruments reading state.beat,
 * and these instruments still do exactly that.
 */

const PREVIEW_BPM = 120
const BEATS_PER_SEC = PREVIEW_BPM / 60

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

/** One never-onsetting note whose block bounds cover every beat: beatInBlock
 *  is true (ambient layers render) while "no notes are playing". */
const COVERAGE_NOTE: ResolvedNote = Object.freeze({
  beat: 1e9,
  blockStartBeat: 0,
  blockEndBeat: 1e9,
  pitch: 60,
  velocity: 0,
  durationBeats: 1,
})

function makeIdleState(instrumentId: string): ObjectState {
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
    notes: [COVERAGE_NOTE],
    activeNotes: [],
  }
}

/** Mounted BEFORE the instrument component (r3f runs useFrame in mount order),
 *  so the state is registered and ticked ahead of the instrument's read. */
function ObjectPreviewDriver({ instrumentId }: { instrumentId: string }) {
  const state = useMemo(() => makeIdleState(instrumentId), [instrumentId])
  useFrame((root) => {
    state.beat = root.clock.elapsedTime * BEATS_PER_SEC
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

// A looping bar of synthetic notes across the common trigger/gate pitches so
// ballistic lanes fire and gate rows toggle. The driver wraps its beat to this
// span, so the pattern repeats forever.
const MOVER_LOOP_BEATS = 16
const MOVER_NOTES: ResolvedNote[] = [72, 67, 64, 60, 72, 67, 64, 60].map((pitch, i) => ({
  beat: i * 2,
  blockStartBeat: 0,
  blockEndBeat: 1e9,
  pitch,
  velocity: 100,
  durationBeats: 1,
}))

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
    const beat = (root.clock.elapsedTime * BEATS_PER_SEC) % MOVER_LOOP_BEATS
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

// ── The popup ────────────────────────────────────────────────────────────────

export function InstrumentPreviewPopup({ item, anchor }: { item: InstrumentItem; anchor: { left: number; top: number } }) {
  // Visual only - no popup at all for instruments with nothing to render
  // (their rows keep the native title tooltip instead).
  if (!canPreview(item)) return null
  // Keep the popup on-screen for rows near the bottom of the viewport.
  const top = Math.max(8, Math.min(anchor.top - 12, (typeof window !== 'undefined' ? window.innerHeight : 800) - 148))
  return (
    <div
      className="fixed z-[90] w-[228px] h-[128px] rounded border border-[var(--border)] bg-[var(--bg-canvas)] shadow-xl shadow-black/60 pointer-events-none overflow-hidden"
      style={{ left: anchor.left + 8, top }}
    >
      <Canvas dpr={1} frameloop="always" camera={{ position: [0, 0.9, 4.2], fov: 55 }} gl={{ antialias: true }}>
        <color attach="background" args={['#09090b']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 4, 5]} intensity={1.1} />
        {item.kind === 'object'
          ? <ObjectPreview instrumentId={item.id} />
          : <MoverPreview moverId={item.id} />}
      </Canvas>
    </div>
  )
}

import { Matrix4 } from 'three'
import { resolveProject, type ProjectSnapshot } from './resolve'
import { evaluatePulse } from './energy'
import { sampleLane } from './automation'
import { composeMatrix, cloneSVInto, lerpSV, localTransformToSV } from './stateVector'
import { subsetWeight } from './movers/registry'
import type { ResolvedMover, ResolvedGraph, ObjectState, ResolvedObject, StateVector } from './types'

// The engine is a plain module singleton, NOT a zustand/React store: per-frame
// state must never trigger React re-renders. Renderers read it imperatively from
// useFrame. The only React-visible signal is the object LIST (see below).

let graph: ResolvedGraph = { objects: [], tagIndex: new Map() }
// Project bpm, mirrored on every setProject/syncParams - computeAtBeat derives
// secPerBeat from it so instruments can convert beat-ages to seconds.
let bpm = 120
const states = new Map<string, ObjectState>()
// World transforms, reused across frames (one Matrix4 per object). Also the source
// of each object's parent transform during composition.
const worldMatrices = new Map<string, Matrix4>()
const _local = new Matrix4()

// External-store signal for the object list, so VisualScene reconciles the scene
// tree when objects appear/disappear (on resolve) - never per frame.
let objectList: { trackId: string; instrumentId: string }[] = []
const listeners = new Set<() => void>()

function publishList() {
  objectList = graph.objects.map((o) => ({ trackId: o.trackId, instrumentId: o.instrumentId }))
  listeners.forEach((l) => l())
}

/** Re-derive the graph from the project (called debounced, off the edit path). */
export function setProject(p: ProjectSnapshot) {
  graph = resolveProject(p)
  bpm = p.bpm
  // Drop per-object caches for tracks that no longer resolve to an object.
  const live = new Set(graph.objects.map((o) => o.trackId))
  for (const id of states.keys()) if (!live.has(id)) states.delete(id)
  for (const id of worldMatrices.keys()) if (!live.has(id)) worldMatrices.delete(id)
  publishList()
}

/**
 * Refresh just the base params on the already-resolved objects, in place. Called
 * synchronously on every edit (not debounced) so slider drags are reactive at
 * 60fps, while the expensive structural resolve stays debounced. Reads params from
 * the same source as resolve (`track.params`), so the engine remains the sole owner
 * of params - `computeAtBeat`/renderers are unchanged. Tracks not yet (or no longer)
 * in the graph are skipped; the debounced setProject reconciles structure shortly.
 */
export function syncParams(p: ProjectSnapshot) {
  bpm = p.bpm
  for (const obj of graph.objects) {
    const track = p.tracks[obj.trackId]
    if (track) {
      obj.params = track.params ?? {}
      obj.stringParams = track.stringParams ?? {}
    }
    for (const d of obj.moverChain) {
      const dTrack = p.tracks[d.trackId]
      if (!dTrack) continue
      d.depth = dTrack.depth ?? 1
      d.bypassed = !!dTrack.muted
      d.midiMode = dTrack.midiMode ?? 'none'
      d.midiTargetInput = dTrack.midiTargetInput
      d.interpolation = dTrack.interpolation ?? 'linear'
      d.envelope = dTrack.envelope
      d.weight = dTrack.weight ?? { mode: 'all' }
      d.opMode = dTrack.opMode ?? 'transform'
      for (const [inputName, input] of Object.entries(d.def.inputs)) {
        d.inputBase[inputName] = dTrack.inputValues?.[inputName] ?? input.default
      }
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function clamp01(v: number): number {
  return clamp(v, 0, 1)
}

function clampSigned(v: number): number {
  return clamp(v, -1, 1)
}

function clampOpacity(v: number): number {
  return clamp(v, 0, 1)
}

function sampleMoverInputs(
  d: ResolvedMover,
  beat: number,
  out: Record<string, number>,
  midiAmount: number | null,
) {
  const amountInputs = midiAmount == null ? null : new Set(d.def.amountInputs ?? [])
  for (const key in out) delete out[key]
  for (const [inputName, input] of Object.entries(d.def.inputs)) {
    let value = d.inputBase[inputName] ?? input.default
    for (const auto of d.automations) {
      if (auto.param !== inputName || auto.keyframes.length === 0) continue
      // Existing automation lanes encode an absolute value; movers consume it
      // as an additive offset from the input default so base + automation behaves
      // naturally for non-zero-default inputs such as rate.
      value += sampleLane(auto.keyframes, beat, auto.mode) - input.default
    }

    if (d.midiMode === 'continuous' && d.midiTargetInput === inputName) {
      const keyframes = d.continuousKeyframes[inputName]
      if (keyframes?.length) value = sampleLane(keyframes, beat, d.interpolation)
    }

    if (amountInputs?.has(inputName)) {
      value = input.default + (value - input.default) * (midiAmount ?? 0)
    }

    out[inputName] = clamp(value, input.min, input.max)
  }
}

function midiAmount(d: ResolvedMover, beat: number): number | null {
  if (d.midiMode !== 'amount') return null
  if (d.amountKeyframes.length === 0) return 0
  return clamp(sampleLane(d.amountKeyframes, beat, d.interpolation), -1, 1)
}

function ballisticGain(d: ResolvedMover, beat: number): number {
  if (d.midiMode !== 'ballistic') return 1
  const attack = Math.max(0.0001, d.envelope?.attack ?? 0.05)
  const decay = Math.max(0.0001, d.envelope?.decay ?? 0.4)
  const lookback = attack + 8 * decay
  let gain = 0
  for (const note of d.notes) {
    if (note.beat > beat || beat - note.beat > lookback) continue
    const age = beat - note.beat
    const velocity = note.velocity <= 1 ? note.velocity : note.velocity / 127
    if (age < attack) gain += velocity * (age / attack)
    else {
      const decayStart = Math.max(attack, note.durationBeats || 0)
      const tailAge = Math.max(0, age - decayStart)
      gain += velocity * Math.exp(-tailAge / decay)
    }
  }
  return clamp01(gain)
}

function isBallisticOpacityMover(d: ResolvedMover): boolean {
  return d.def.id === 'opacity' && d.midiMode === 'ballistic'
}

function applyBallisticOpacityTarget(
  entry: StateVector,
  inputs: Record<string, number>,
  d: ResolvedMover,
  beat: number,
  out: StateVector,
): void {
  cloneSVInto(out, entry)
  out.opacity = clampOpacity(entry.opacity * clamp01(inputs.opacity ?? 1) * ballisticGain(d, beat))
}

function setElementChannels(out: Record<string, number>, i: number, N: number): void {
  for (const key in out) delete out[key]
  out.i = i
  out.n = N
  out.frac = N <= 1 ? 0 : i / (N - 1)
  out.parity = i % 2
}

function addWeightedDelta(dst: StateVector, entry: StateVector, result: StateVector, w: number): void {
  dst.pos[0] += (result.pos[0] - entry.pos[0]) * w
  dst.pos[1] += (result.pos[1] - entry.pos[1]) * w
  dst.pos[2] += (result.pos[2] - entry.pos[2]) * w
  dst.rot[0] += (result.rot[0] - entry.rot[0]) * w
  dst.rot[1] += (result.rot[1] - entry.rot[1]) * w
  dst.rot[2] += (result.rot[2] - entry.rot[2]) * w
  dst.logScale += (result.logScale - entry.logScale) * w
  dst.opacity += (result.opacity - entry.opacity) * w
  for (const key in entry.aux) {
    const av = entry.aux[key] ?? 0
    const bv = result.aux[key] ?? 0
    dst.aux[key] = (dst.aux[key] ?? av) + (bv - av) * w
  }
  for (const key in result.aux) {
    if (key in entry.aux) continue
    dst.aux[key] = (dst.aux[key] ?? 0) + result.aux[key] * w
  }
}

function applyMoverChain(
  obj: ResolvedObject,
  base: StateVector,
  beat: number,
  i: number,
  N: number,
): StateVector {
  const ctx = { beat, i, N, channels: obj.scratchChannels }
  cloneSVInto(obj.scratchA, base)
  for (let index = 0; index < obj.moverChain.length; index++) {
    const d = obj.moverChain[index]
    if (d.bypassed) continue

    if (d.opMode === 'add') {
      cloneSVInto(obj.scratchEntry, obj.scratchA)
      cloneSVInto(obj.scratchAdd, obj.scratchEntry)
      while (index < obj.moverChain.length && obj.moverChain[index].opMode === 'add') {
        const addDim = obj.moverChain[index]
        if (!addDim.bypassed) {
          sampleMoverInputs(addDim, beat, obj.scratchInputs, midiAmount(addDim, beat))
          let gain = ballisticGain(addDim, beat)
          if (isBallisticOpacityMover(addDim)) {
            applyBallisticOpacityTarget(obj.scratchEntry, obj.scratchInputs, addDim, beat, obj.scratchB)
            gain = 1
          } else {
            addDim.def.apply(obj.scratchEntry, obj.scratchInputs, ctx, obj.scratchB)
          }
          const w = clampSigned(addDim.depth * subsetWeight(addDim.weight, i, N) * gain)
          addWeightedDelta(obj.scratchAdd, obj.scratchEntry, obj.scratchB, w)
        }
        index++
      }
      index--
      cloneSVInto(obj.scratchA, obj.scratchAdd)
      continue
    }

    sampleMoverInputs(d, beat, obj.scratchInputs, midiAmount(d, beat))
    let gain = ballisticGain(d, beat)
    if (isBallisticOpacityMover(d)) {
      applyBallisticOpacityTarget(obj.scratchA, obj.scratchInputs, d, beat, obj.scratchB)
      gain = 1
    } else {
      d.def.apply(obj.scratchA, obj.scratchInputs, ctx, obj.scratchB)
    }
    const w = clampSigned(d.depth * subsetWeight(d.weight, i, N) * gain)
    // Phase 1 intentionally lerps axis-angle components directly. This is an
    // approximation, acceptable for prototype magnitudes below about pi.
    lerpSV(obj.scratchA, obj.scratchA, obj.scratchB, w)
  }
  return obj.scratchA
}

/** Per frame (runs first, from VisualBeatSync): compose each object's world
 *  transform down the hierarchy, then stash state for the renderer to pull.
 *  graph.objects is in parent-before-child order (resolve walks the tree DFS), so a
 *  parent's world is always ready when its children compose. */
export function computeAtBeat(beat: number) {
  const secPerBeat = 60 / bpm
  for (const obj of graph.objects) {
    // The note-pulse signal (the old implicit `energy` port, now direct).
    const energy = !obj.muted && obj.notes.length > 0 ? evaluatePulse(obj.notes, beat) : 0
    // Automation drives params over time: overlay each lane's sampled value onto the
    // base params for this frame (a pure function of the beat, so scrub == playback).
    let params = obj.params
    if (obj.automations.length) {
      params = { ...obj.params }
      for (const auto of obj.automations) {
        if (auto.keyframes.length) params[auto.param] = sampleLane(auto.keyframes, beat, auto.mode)
      }
    }
    let world = worldMatrices.get(obj.trackId)
    if (!world) { world = new Matrix4(); worldMatrices.set(obj.trackId, world) }
    const parentWorld = obj.parentId ? worldMatrices.get(obj.parentId) : undefined
    const isEnsemble = obj.elementCount > 1 || !!obj.layoutState
    // Color-mover output (object-level: element 0's aux channels).
    let hueShift = 0
    let satShift = 0
    let lightShift = 0
    if (isEnsemble) {
      if (parentWorld) world.copy(parentWorld)
      else world.identity()
      const N = obj.elementCount
      for (let i = 0; i < N; i++) {
        if (obj.layoutState) {
          setElementChannels(obj.scratchChannels, i, N)
          obj.layoutState({ params, energy, beat, i, N, channels: obj.scratchChannels }, obj.scratchBase)
        } else {
          setElementChannels(obj.scratchChannels, i, N)
          const local = obj.localTransform ? obj.localTransform({ params, energy, beat }) : {}
          localTransformToSV(local, obj.scratchBase)
        }
        const elementState = applyMoverChain(obj, obj.scratchBase, beat, i, N)
        composeMatrix(elementState, obj.elementMatrices[i])
        obj.elementOpacities[i] = clampOpacity(elementState.opacity)
        if (i === 0) {
          hueShift = elementState.aux.hueShift ?? 0
          satShift = elementState.aux.satShift ?? 0
          lightShift = elementState.aux.lightShift ?? 0
        }
      }
    } else {
      const local = obj.localTransform ? obj.localTransform({ params, energy, beat }) : {}
      localTransformToSV(local, obj.scratchBase)
      setElementChannels(obj.scratchChannels, 0, 1)
      const localState = applyMoverChain(obj, obj.scratchBase, beat, 0, 1)
      composeMatrix(localState, _local)
      obj.elementOpacities[0] = clampOpacity(localState.opacity)
      hueShift = localState.aux.hueShift ?? 0
      satShift = localState.aux.satShift ?? 0
      lightShift = localState.aux.lightShift ?? 0
      if (parentWorld) world.multiplyMatrices(parentWorld, _local)
      else world.copy(_local)
    }

    // Effect automation lanes sample per frame into an override map the effect
    // wrappers merge over each instance's stored settings ('enabled' as 0/1).
    let effectOverrides: Record<string, Record<string, number>> | undefined
    if (obj.effectAutomations.length) {
      effectOverrides = {}
      for (const ea of obj.effectAutomations) {
        if (!ea.keyframes.length) continue
        ;(effectOverrides[ea.instanceId] ??= {})[ea.key] = sampleLane(ea.keyframes, beat, ea.mode)
      }
    }

    // Muted (or soloed-out) objects are hidden, and a `mute` modifier blacks out its span.
    const blackedOut = obj.muted || obj.blackouts.some((r) => beat >= r.start && beat < r.end)
    // Notes live at this beat - pitch-reactive instruments read them (a zero-length note
    // stays "on" for a hair so single-tick triggers still register).
    const activeNotes = obj.notes.filter((n) => beat >= n.beat && beat < n.beat + (n.durationBeats || 0.05))
    states.set(obj.trackId, {
      beat,
      secPerBeat,
      params,
      energy,
      videoPads: obj.videoPads,
      world,
      elementCount: obj.elementCount,
      elementMatrices: obj.elementMatrices,
      elementOpacities: obj.elementOpacities,
      opacity: obj.elementOpacities[0] ?? 1,
      hueShift,
      satShift,
      lightShift,
      effectOverrides,
      blackedOut,
      stringParams: obj.stringParams,
      abilityEvents: obj.abilityEvents,
      notes: obj.notes,
      activeNotes,
    })
  }
}

/** Pull API for the renderer. */
export function getObjectState(trackId: string): ObjectState | undefined {
  return states.get(trackId)
}

// ── Object-list subscription (VisualScene via useSyncExternalStore) ──
export function subscribeObjects(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
export function getObjectList() {
  return objectList
}

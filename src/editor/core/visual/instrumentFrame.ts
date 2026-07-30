import { useContext, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color } from 'three'
import { getObjectState, getVisualCopy } from './VisualEngine'
import { applyColorShiftToInstrumentParams, InstrumentCopyContext } from './instrumentColor'
import { sampleAutomationLane } from './automation'
import type { ObjectState } from './types'
import type { VisualCopy } from '../visualCopies/types'

/** What an object with no VisualCopy sees: the identity shift. Frozen module
 *  constant so the per-frame signature compares by identity, not by allocation. */
const NO_COLOR_SHIFT: VisualCopy['colorShift'] =
  { hue: 0, saturation: 0, lightness: 0, tint: null, tintAmount: 0 }

/**
 * THE per-frame entry point for instrument visuals - instruments use this, never
 * useFrame directly (enforced by lint). The callback receives only the object's
 * engine state; r3f's clock and delta are deliberately out of scope, so motion
 * can't be written against anything but `state.beat`.
 *
 * The pause invariant this exists to protect: every visual is a pure function of
 * the current beat (+ params/ports/notes). A static playhead is a static frame;
 * scrubbing to a beat shows exactly what playback would show there.
 *
 * The same purity is also a per-object skip condition: if none of an object's
 * inputs changed since its last run, its callback would repaint identical pixels
 * - so it isn't called. That is what makes paused-editing cheap: muting a track
 * or dragging a block re-renders a frame (RenderGovernor), but a heavy full-frame
 * instrument whose own inputs didn't move skips its multi-MB canvas redraw and
 * texture re-upload. The signature covers everything a callback can legally read:
 * ObjectState (beat first - during playback it changes every frame and short-
 * circuits the comparison), canvas size/DPR, and the camera pose (some
 * instruments do CPU-side billboard math against it).
 *
 * Runs after VisualBeatSync's computeAtBeat (r3f calls useFrame subscribers in
 * mount order, and VisualBeatSync mounts first), so state is always this frame's.
 * Skipped while the object isn't resolved yet.
 *
 * A callback that cannot apply the frame yet (refs not attached, canvas not
 * ready) must return `false` instead of silently bailing: the signature was
 * already committed by then, so a silent bail would eat the change - the
 * object then renders stale defaults until the NEXT input change, and a
 * paused project may never deliver one (the Laser Sphere "params do nothing
 * until remount" bug). Returning `false` resets the signature so the frame
 * retries until the callback can actually run.
 */
export function useInstrumentFrame(trackId: string, cb: (state: ObjectState) => void | false) {
  const copyContext = useContext(InstrumentCopyContext)
  // Signature buffer, reused across frames (write-and-compare, no allocation).
  const buf = useRef<unknown[]>([]).current
  const shiftedStringParams = useRef<Record<string, string>>({}).current
  const shiftedState = useRef<ObjectState | null>(null)
  const scratchColor = useRef(new Color()).current
  const scratchTint = useRef(new Color()).current
  useFrame((root) => {
    const state = getObjectState(trackId)
    if (!state) {
      // Unresolved: clear so the first resolved frame always runs.
      buf.length = 0
      return
    }
    const visualCopy = copyContext
      ? getVisualCopy(trackId, copyContext.visualCopyIndex)
      : undefined
    const colorShift = visualCopy?.colorShift ?? NO_COLOR_SHIFT
    const hueShift = colorShift.hue
    const saturationShift = colorShift.saturation
    const lightnessShift = colorShift.lightness
    const tint = colorShift.tint
    const tintAmount = colorShift.tintAmount
    let i = 0
    let dirty = false
    const put = (v: unknown) => {
      if (!Object.is(buf[i], v)) {
        dirty = true
        buf[i] = v
      }
      i++
    }
    put(state.beat)
    put(state.secPerBeat)
    put(state.beatsPerBar)
    put(state.blackedOut)
    put(root.size.width)
    put(root.size.height)
    put(root.viewport.dpr)
    // Stable references per resolve - a structural re-resolve replaces them.
    put(state.notes)
    put(state.stringParams)
    // Copy color and copy opacity are instrument inputs: MIDI-driven shifts and
    // visibility fades must invalidate an otherwise static instrument (the
    // lasers write copy opacity into a shader uniform) even though the base
    // stringParams are stable - e.g. tweaking a visibility mover's ADSR while
    // paused changes copy opacity at a frozen beat.
    put(hueShift)
    put(saturationShift)
    put(lightnessShift)
    put(tint)
    put(tintAmount)
    put(visualCopy?.opacity ?? 1)
    put(state.abilityEvents)
    put(state.videoPads)
    put(state.photoPads)
    put(state.opacity)
    // Mutated in place each computeAtBeat: compare by element.
    const w = state.world.elements
    for (let k = 0; k < 16; k++) put(w[k])
    const cam = root.camera
    put(cam.position.x); put(cam.position.y); put(cam.position.z)
    put(cam.quaternion.x); put(cam.quaternion.y); put(cam.quaternion.z); put(cam.quaternion.w)
    put(state.activeNotes.length)
    for (const n of state.activeNotes) put(n)
    put(state.energy)
    for (const k in state.params) { put(k); put(state.params[k]) }
    if (buf.length !== i) {
      buf.length = i
      dirty = true
    }
    if (dirty) {
      const colorShiftActive = copyContext && copyContext.colorParams.length > 0 &&
        (Math.abs(hueShift) + Math.abs(saturationShift) + Math.abs(lightnessShift) > 0.0001 ||
          (tint !== null && tintAmount > 0.0001))
      if (!colorShiftActive) {
        // Couldn't apply yet: drop the committed signature so next frame retries.
        if (cb(state) === false) buf.length = 0
        return
      }
      applyColorShiftToInstrumentParams(
        state.stringParams,
        copyContext.colorParams,
        colorShift,
        shiftedStringParams,
        scratchColor,
        scratchTint,
      )
      const nextState = shiftedState.current ?? { ...state, stringParams: shiftedStringParams }
      Object.assign(nextState, state)
      nextState.stringParams = shiftedStringParams
      shiftedState.current = nextState
      if (cb(nextState) === false) buf.length = 0
    }
  })
}

/**
 * True while the playhead sits inside any of the object's blocks, derived from
 * the block bounds each resolved note carries. Instruments with ambient
 * baselines gate on this so a track with no block at the current beat renders
 * NOTHING - blocks are the instrument's on-screen region, like clips in a DAW.
 * (A block with zero notes contributes no bounds and therefore no coverage.)
 */
/**
 * What `param` was at some OTHER beat - normally the beat something spawned at.
 *
 * `state.params` answers "right now", which is wrong for anything that should
 * LATCH: a word that fades out over two beats while its position is automated
 * would slide around after being placed, because it keeps reading the live value.
 * Sampling the lane at the spawn beat pins it instead, so a fading word stays put
 * and only the next one moves.
 *
 * Safe for the pause invariant: sampleAutomationLane is a pure function of beat,
 * so this is still a function of (beat, document) and scrub == playback.
 *
 * Does NOT reproduce envelope overlay (the base ← automation ← envelope merge
 * stops at automation here). Envelopes are ADSR-gated around the CURRENT beat, so
 * latching one to a past beat would be meaningless rather than merely incomplete.
 */
export function paramAtBeat(state: ObjectState, param: string, beat: number): number {
  const base = state.baseParams[param] ?? state.params[param] ?? 0
  for (const auto of state.automations) {
    if (auto.param !== param) continue
    const v = sampleAutomationLane(auto, beat, base)
    // NaN = the lane is inert at this beat; fall back to the base value.
    if (!Number.isNaN(v)) return v
    break
  }
  return base
}

export function beatInBlock(state: ObjectState): boolean {
  for (const n of state.notes) {
    if (state.beat >= n.blockStartBeat && state.beat < n.blockEndBeat) return true
  }
  return false
}

/**
 * Deterministic stand-in for Math.random (which is banned in instruments): the
 * same seed always yields the same value in [0, 1). Seed per entity from stable
 * facts - e.g. `seededRand(note.beat * 13 + note.pitch * 7 + i)` - so a scrub to
 * the same beat regenerates the identical "randomness".
 */
export function seededRand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280
  return x - Math.floor(x)
}

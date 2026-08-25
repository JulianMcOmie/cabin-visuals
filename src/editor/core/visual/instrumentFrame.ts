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
/** The write-and-compare signature buffer one useInstrumentFrame mount owns.
 *  A plain record walked by a module-level `put` rather than a per-frame
 *  closure: the closure version allocated one function per copy per frame,
 *  which at fifty-odd puts a copy was the hook's own biggest cost. */
interface FrameSignature {
  buf: unknown[]
  i: number
  dirty: boolean
}

function put(sig: FrameSignature, v: unknown) {
  const i = sig.i
  if (!Object.is(sig.buf[i], v)) {
    sig.dirty = true
    sig.buf[i] = v
  }
  sig.i = i + 1
}

export function useInstrumentFrame(trackId: string, cb: (state: ObjectState) => void | false) {
  const copyContext = useContext(InstrumentCopyContext)
  // Signature buffer, reused across frames (write-and-compare, no allocation).
  const sig = useRef<FrameSignature>({ buf: [], i: 0, dirty: false }).current
  const shiftedStringParams = useRef<Record<string, string>>({}).current
  const shiftedState = useRef<ObjectState | null>(null)
  const scratchColor = useRef(new Color()).current
  const scratchTint = useRef(new Color()).current
  useFrame((root) => {
    // Per-copy state when this occurrence is a STAGGERED copy (the whole
    // object at the copy's own clock); the shared object state otherwise.
    const state = getObjectState(trackId, copyContext?.visualCopyIndex)
    const buf = sig.buf
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
    const tintPerceptual = colorShift.tintPerceptual ?? false
    const huePerceptual = colorShift.huePerceptual ?? false
    sig.i = 0
    sig.dirty = false
    put(sig, state.beat)
    put(sig, state.secPerBeat)
    put(sig, state.beatsPerBar)
    put(sig, state.blackedOut)
    put(sig, root.size.width)
    put(sig, root.size.height)
    put(sig, root.viewport.dpr)
    // Stable references per resolve - a structural re-resolve replaces them.
    put(sig, state.notes)
    put(sig, state.stringParams)
    // Copy color and copy opacity are instrument inputs: MIDI-driven shifts and
    // visibility fades must invalidate an otherwise static instrument (the
    // lasers write copy opacity into a shader uniform) even though the base
    // stringParams are stable - e.g. tweaking a visibility mover's ADSR while
    // paused changes copy opacity at a frozen beat.
    put(sig, hueShift)
    put(sig, saturationShift)
    put(sig, lightnessShift)
    put(sig, tint)
    put(sig, tintAmount)
    // Which mix the tint walks changes the rendered color at a fixed beat, so
    // flipping the Colorizer's MIX while paused has to repaint like any other
    // colorShift field.
    put(sig, tintPerceptual)
    // Same reason for the hue: which circle it turns on changes the rendered
    // color at a fixed beat, so flipping a Hue Rotate's MODE while paused has
    // to repaint.
    put(sig, huePerceptual)
    put(sig, visualCopy?.opacity ?? 1)
    put(sig, state.abilityEvents)
    put(sig, state.videoPads)
    put(sig, state.photoPads)
    // Document identity: any store edit to the clips or lanes mints fresh
    // arrays, and this is what repaints the words while paused.
    put(sig, state.lyricClips)
    put(sig, state.styleLanes)
    put(sig, state.opacity)
    // Mutated in place each computeAtBeat: compare by element.
    const w = state.world.elements
    for (let k = 0; k < 16; k++) put(sig, w[k])
    const cam = root.camera
    put(sig, cam.position.x); put(sig, cam.position.y); put(sig, cam.position.z)
    put(sig, cam.quaternion.x); put(sig, cam.quaternion.y); put(sig, cam.quaternion.z); put(sig, cam.quaternion.w)
    // The active-note array is per-object scratch the engine refills in place,
    // so its identity says nothing - its length and elements do.
    const active = state.activeNotes
    put(sig, active.length)
    for (let k = 0; k < active.length; k++) put(sig, active[k])
    put(sig, state.energy)
    const params = state.params
    for (const k in params) { put(sig, k); put(sig, params[k]) }
    if (buf.length !== sig.i) {
      buf.length = sig.i
      sig.dirty = true
    }
    if (sig.dirty) {
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

import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { getObjectState } from './VisualEngine'
import type { ObjectState } from './types'

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
 */
export function useInstrumentFrame(trackId: string, cb: (state: ObjectState) => void) {
  // Signature buffer, reused across frames (write-and-compare, no allocation).
  const buf = useRef<unknown[]>([]).current
  useFrame((root) => {
    const state = getObjectState(trackId)
    if (!state) {
      // Unresolved: clear so the first resolved frame always runs.
      buf.length = 0
      return
    }
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
    put(state.blackedOut)
    put(root.size.width)
    put(root.size.height)
    put(root.viewport.dpr)
    // Stable references per resolve - a structural re-resolve replaces them.
    put(state.notes)
    put(state.stringParams)
    put(state.abilityEvents)
    put(state.videoPads)
    // Mover-system outputs (Swarm et al. read these). The arrays are
    // per-resolve identities whose CONTENTS are pure functions of the fields
    // already compared here (beat, params, ports, notes), so ref-compare is
    // exact: same refs + same inputs ⇒ same element transforms.
    put(state.opacity)
    put(state.elementCount)
    put(state.elementMatrices)
    put(state.elementOpacities)
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
    if (dirty) cb(state)
  })
}

/**
 * True while the playhead sits inside any of the object's blocks, derived from
 * the block bounds each resolved note carries. Instruments with ambient
 * baselines gate on this so a track with no block at the current beat renders
 * NOTHING - blocks are the instrument's on-screen region, like clips in a DAW.
 * (A block with zero notes contributes no bounds and therefore no coverage.)
 */
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

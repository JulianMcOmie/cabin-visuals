import { useFrame } from '@react-three/fiber'
import { getObjectState } from './VisualEngine'
import type { ObjectState } from './types'

/**
 * THE per-frame entry point for instrument visuals — instruments use this, never
 * useFrame directly (enforced by lint). The callback receives only the object's
 * engine state; r3f's clock and delta are deliberately out of scope, so motion
 * can't be written against anything but `state.beat`.
 *
 * The pause invariant this exists to protect: every visual is a pure function of
 * the current beat (+ params/ports/notes). A static playhead is a static frame;
 * scrubbing to a beat shows exactly what playback would show there.
 *
 * Runs after VisualBeatSync's computeAtBeat (r3f calls useFrame subscribers in
 * mount order, and VisualBeatSync mounts first), so state is always this frame's.
 * Skipped while the object isn't resolved yet.
 */
export function useInstrumentFrame(trackId: string, cb: (state: ObjectState) => void) {
  useFrame(() => {
    const state = getObjectState(trackId)
    if (state) cb(state)
  })
}

/**
 * Deterministic stand-in for Math.random (which is banned in instruments): the
 * same seed always yields the same value in [0, 1). Seed per entity from stable
 * facts — e.g. `seededRand(note.beat * 13 + note.pitch * 7 + i)` — so a scrub to
 * the same beat regenerates the identical "randomness".
 */
export function seededRand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280
  return x - Math.floor(x)
}

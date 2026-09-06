import { midiVelocity } from '../utils/midiVelocity'
import type { ObjectState } from '../core/visual/types'

// The pure half of the Water Drop instrument: which drops are alive at a beat
// and where each one is released. Split out of WaterDrop.tsx for the same
// reason laserSphereCore.ts is split out of LaserSphere.tsx - the component
// pulls in `instrumentFrame`, which reaches the engine and back around to the
// instrument registry, so a test importing the .tsx hits an import cycle.

/** Lowest of the eleven height rows (middle C); rows run up to +10 semitones. */
export const WATER_DROP_PITCH_MIN = 60
export const WATER_DROP_LEVELS = 11

/** Mirrors the engine's own liveness rule for zero-length notes (VisualEngine). */
const MIN_NOTE_BEATS = 0.05

/** Newest drops win when more than this are alive - the cap is on instance
 *  budget, and old drops are the faint ones nobody misses. */
export const MAX_ACTIVE_DROPS = 10
export const MAX_ARMS = 24
export const MAX_BEADS = 6
export const MAX_DROPLETS = 16
/** 1 core bead + the tendril chains + the flung droplets. */
export const INSTANCES_PER_DROP = 1 + MAX_ARMS * MAX_BEADS + MAX_DROPLETS

/**
 * Where a pitch's drop is released, in world units. Level 0 (the bottom row)
 * sits at -span/2 and the top row at +span/2, so the eleven rows are an evenly
 * spaced ladder centered on the track's own origin.
 */
export function waterDropHeight(pitch: number, heightSpan: number): number {
  const level = Math.max(0, Math.min(WATER_DROP_LEVELS - 1, Math.round(pitch) - WATER_DROP_PITCH_MIN))
  return (level / (WATER_DROP_LEVELS - 1) - 0.5) * heightSpan
}

/** One drop this frame: `t` is its normalized age, `seed` its stable identity. */
export interface LiveDrop {
  t: number
  seed: number
  pitch: number
  velocity: number
}

/**
 * The drops alive at `state.beat`, oldest first, capped to the newest
 * MAX_ACTIVE_DROPS. Lifetime is in SECONDS (not beats) on purpose: a drop
 * spreading through water has a physical settling time, and tying it to tempo
 * would make the same patch read as a different liquid at a different BPM.
 */
export function collectLiveDrops(
  state: Pick<ObjectState, 'notes' | 'beat' | 'secPerBeat'>,
  lifetimeSec: number,
): LiveDrop[] {
  const alive: LiveDrop[] = []
  if (lifetimeSec <= 0) return alive
  for (const n of state.notes) {
    if (n.beat > state.beat) break  // notes are sorted; the rest are in the future
    const level = Math.round(n.pitch) - WATER_DROP_PITCH_MIN
    if (level < 0 || level >= WATER_DROP_LEVELS) continue
    const ageSec = (state.beat - n.beat) * state.secPerBeat
    if (ageSec < 0 || ageSec >= lifetimeSec) continue
    alive.push({
      t: ageSec / lifetimeSec,
      // Beat and pitch together identify the note stably across scrubs, and the
      // duration keeps two same-pitch notes on the same beat from twinning.
      seed: n.beat * 137.13 + n.pitch * 31.7 + (n.durationBeats || MIN_NOTE_BEATS) * 3.1,
      pitch: n.pitch,
      velocity: midiVelocity(n.velocity),
    })
  }
  return alive.length > MAX_ACTIVE_DROPS ? alive.slice(-MAX_ACTIVE_DROPS) : alive
}

// Approach splitter: the "flying into it" illusion. Copies stream along the
// camera axis, each one born at the far end at scale ZERO, swelling as it comes
// at you, until it passes the lens and is recycled straight back to the far end
// to start over. Reverse the direction and the same machine runs backwards -
// copies peel off the camera and shrink away into the distance.
//
// Scale, not fog, is what sells it. The Tunnel splitter next door moves copies
// down the same axis but renders them all at full size and fades their opacity,
// which reads as a corridor you are travelling through. Here the copy grows from
// nothing, so the eye reads the growth as approach and the recycle as a fresh
// object appearing far away - the reason a copy may vanish at its LARGEST size
// (right in your face, behind the lens) without the loop ever becoming visible.
//
// As with the Tunnel, endlessness is an illusion: there are only `density`
// structural copies and the wrap is `mod`, not an accumulator, so the whole
// thing stays a closed-form function of the beat and pause / scrub / playback /
// export agree exactly.
//
// Two things the defaults protect, because getting them wrong exposes the loop:
//  - The near end sits BEHIND the default camera (z = 5), so a copy is recycled
//    at the moment it is off-screen. Pulled in front of the lens, copies visibly
//    blink out of existence at full size in the middle of the frame.
//  - Distances are world-metric: offsets divide out the placement's scale, so an
//    instrument that draws itself at half size does not halve the run and drag
//    the near end back in front of the camera (the same trap tunnel.ts documents).
//
// Spawn modes, chosen in the panel's segmented control:
//  - STREAM: copies are evenly phase-offset around the run, so something is
//    always approaching. `density` is literally how many are in flight, and
//    therefore how often the next one arrives.
//  - NOTES: nothing flies until a note fires. The slots still exist (copy count
//    is structural - the splitter invariant), but an unclaimed slot sits at
//    opacity zero. Slot i flies the i-th most recent note, and velocity scales
//    how big that one gets, so a MIDI part choreographs the arrivals.

import { Matrix4, Vector3 } from 'three'
import type { MidiRowDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { midiVelocity } from '../../utils/midiVelocity'
import { placementAxisScale } from './tunnel'
import type { VisualCopy } from './types'
import { APPROACH_COLOR } from './identityColors'

export interface ApproachSettings {
  /** Copies in flight at once - and so how often the next arrival lands. */
  density: number
  /** Units travelled per beat along the approach axis. */
  speed: number
  /** Length of the run: how far out a copy is born. */
  depth: number
  /** Scale a copy reaches at the near end; it starts every run at 0. */
  size: number
  /** 0 = toward the camera, 1 = away into the distance. */
  direction: number
  /** 0 = STREAM (evenly phase-offset), 1 = NOTES (one flight per note). */
  spawnMode: number
  /** Axial coordinate copies are recycled AT. Keep it behind the camera
   *  (z = 5 by default) so the recycle happens off-screen. */
  nearEnd: number
}

export const APPROACH_SPAWN_PITCH = 60

const APPROACH_ROWS: MidiRowDef[] = [{ pitch: APPROACH_SPAWN_PITCH, label: 'Send one in' }]

const APPROACH_MAX_DENSITY = 48
/** Scale is never exactly zero: a fully degenerate matrix is non-invertible and
 *  three.js warns on it. Small enough to be sub-pixel at the far end anyway. */
const MIN_SCALE = 1e-4
/** Fraction of the run over which a copy fades in. Its scale already hides the
 *  birth; this only stops an emissive instrument from popping a hot pixel into
 *  frame at the far end, where bloom would catch it before it has any size. */
const FADE_IN = 0.12
/** Where the default camera sits on the approach axis. */
export const APPROACH_CAMERA_Z = 5
/** World units past the camera plane a copy travels before its slot is released.
 *  A copy is a solid object, not a point: its centre crosses the lens while its
 *  near face is still in frame, so releasing exactly at the plane would clip it
 *  mid-screen. Two units clears any sanely-sized instrument. */
const EXIT_MARGIN = 2

const Z_AXIS = new Vector3(0, 0, 1)

function positiveModulo(value: number, period: number): number {
  return ((value % period) + period) % period
}

/** Structural copy count - settings only, never the beat or the notes. */
export function approachCount(settings: Pick<ApproachSettings, 'density'>): number {
  return Math.max(1, Math.min(APPROACH_MAX_DENSITY, Math.round(settings.density)))
}

/** +1 when copies come toward the camera, -1 when they recede. */
export function approachDirectionSign(settings: Pick<ApproachSettings, 'direction'>): number {
  return Math.round(settings.direction) === 1 ? -1 : 1
}

/**
 * One flight, expressed as `progress` along the run: 0 at the far end (born, no
 * size) and 1 at the near end (full size, at the lens). Everything else -
 * position, scale, opacity - is derived from it, which is what keeps the two
 * spawn modes visually identical apart from WHEN a flight starts.
 */
export interface ApproachFlight {
  progress: number
  /** Scale multiplier applied at the near end; MIDI velocity rides here. */
  sizeScale: number
  /** 0 for a slot with no flight to fly (NOTES mode, nothing claimed it). */
  active: boolean
}

/**
 * STREAM mode: slot i sits a fixed fraction of the run behind slot i-1, and the
 * whole column slides by `speed * beat`. The modulo recycles whatever passes the
 * near end back to the far one.
 */
export function approachStreamFlight(
  slot: number,
  settings: ApproachSettings,
  beat: number,
): ApproachFlight {
  const count = approachCount(settings)
  const depth = Math.max(0.0001, settings.depth)
  const travel = settings.speed * beat * approachDirectionSign(settings)
  const spacing = depth / count
  return {
    progress: positiveModulo(slot * spacing + travel, depth) / depth,
    sizeScale: 1,
    active: true,
  }
}

/**
 * The progress at which a copy sits exactly on the object's NORMAL placement -
 * axial 0, where the object would be with no Approach in the chain. Solving
 * `nearEnd - depth + progress * depth = 0` gives `(depth - nearEnd) / depth`.
 *
 * Clamped, because the run does not always cross the home position: a near end
 * past the far end (`nearEnd >= depth`) means the whole flight happens in front
 * of it, and a near end behind the origin means the whole flight happens beyond
 * it. In those cases the note lands at whichever end of the run is closest.
 */
export function approachHomeProgress(settings: Pick<ApproachSettings, 'depth' | 'nearEnd'>): number {
  const depth = Math.max(0.0001, settings.depth)
  return Math.max(0, Math.min(1, (depth - settings.nearEnd) / depth))
}

/**
 * NOTES mode: slot i flies the i-th most recent note, and the flight is timed so
 * the copy is at the object's NORMAL position exactly ON the note's onset.
 *
 * That timing is the whole point of the mode. A flight that *starts* on the beat
 * puts a scale-zero speck on the downbeat and lands its arrival somewhere in the
 * gap after it - visually late, and unusable for anything rhythmic. Leading the
 * flight in by `runBeats * homeProgress` instead means the copy sweeps in from
 * the distance BEFORE the note and hits home on it, then carries on past the
 * lens. The note is the impact, not the launch.
 *
 * So a flight is alive from `note.beat - runBeats * home` to
 * `note.beat + runBeats * (1 - home)`, and notes that have not fired yet are
 * already in the air - the filter deliberately admits `beat < note.beat`.
 *
 * Direction applies as a REVERSED flight rather than reversed travel: in 'away'
 * mode the copy is already past the lens, sweeps back through home on the onset,
 * and shrinks into the distance after it. (STREAM mode gets its reversal by
 * negating travel, which would be meaningless here - a flight is anchored to its
 * note either way.)
 *
 * Velocity scales the arrival size, so one row can throw big and small objects
 * at the viewer.
 */

/** Beats a copy takes to cover the whole run. Infinite at speed 0 - nothing
 *  flies, so every claimed copy simply parks where its note put it. */
export function approachRunBeats(settings: Pick<ApproachSettings, 'depth' | 'speed'>): number {
  const speed = Math.abs(settings.speed)
  return speed <= 1e-9 ? Infinity : Math.max(0.0001, settings.depth) / speed
}

/**
 * The progress at which a copy has passed the lens and is no longer on screen.
 * Past this point the copy is behind the camera contributing nothing, so this -
 * not the end of the run - is where its slot is RELEASED. That distinction is
 * most of the mode's usable capacity: with the default 24-unit run the stretch
 * from the lens to the near end is a fifth of the flight, and holding a slot
 * across it caps concurrency well below what Density promises.
 */
export function approachExitProgress(settings: Pick<ApproachSettings, 'depth' | 'nearEnd'>): number {
  const depth = Math.max(0.0001, settings.depth)
  return Math.max(0, Math.min(1, (APPROACH_CAMERA_Z + EXIT_MARGIN + depth - settings.nearEnd) / depth))
}

/** One note's claim on one copy slot, in absolute beats. Beat-independent, so
 *  the whole allocation is computed ONCE at resolve rather than per frame. */
export interface ApproachAllocation {
  slot: number
  /** Onset the flight is anchored to; progress is measured from here. */
  noteBeat: number
  /** When the copy enters view, and when it leaves it and frees the slot. */
  startBeat: number
  endBeat: number
  sizeScale: number
}

/**
 * Voice allocation for NOTES mode: assign each note a copy slot it holds for
 * exactly as long as its copy is ON SCREEN.
 *
 * Two things here are load-bearing, both learned the hard way:
 *
 *  - **Slots are freed at the lens, not at the end of the run.** A copy past the
 *    camera is invisible; letting it keep a slot spends the budget on things
 *    nobody can see. This alone is what made Density feel like a much smaller
 *    number than it is.
 *  - **Allocation is FIRST-FIT over genuinely free slots**, not round-robin over
 *    note index. Round-robin is only optimal for a perfectly even stream; give
 *    it phrases with gaps, or any rhythm that is not uniform, and it collides
 *    notes on a busy slot while other slots sit idle. First-fit collides only
 *    when every copy really is on screen at once.
 *
 * The earlier recency-ranked cap was worse than either: it kept the NEWEST
 * `density` flights, so it culled the oldest - the one furthest along, about to
 * reach the camera - and a dense phrase delivered nothing until its final notes.
 * Whatever replaces this must evict the newborn, never the one about to land.
 *
 * When every slot really is busy, the incoming note steals the one that would
 * have freed soonest and that victim's flight is truncated then and there -
 * the same trade a synth makes when it runs out of voices.
 */
export function allocateApproachFlights(
  settings: ApproachSettings,
  notes: readonly ResolvedNote[],
): ApproachAllocation[] {
  const count = approachCount(settings)
  const runBeats = approachRunBeats(settings)
  const home = approachHomeProgress(settings)
  // A run that never puts a copy in front of the lens after home (a near end
  // pulled back past the camera, say) would compute a zero-length visible
  // window and silently show nothing. Fall back to releasing at the end of the
  // run instead: worse capacity, but the mover still does something.
  const rawExit = approachExitProgress(settings)
  const exit = rawExit > home ? rawExit : 1
  const receding = approachDirectionSign(settings) < 0

  // How far either side of the onset the copy is visible. Toward the camera the
  // copy spends `home` of the run arriving and the rest departing; receding, the
  // two swap - it sweeps in from the lens and leaves via the far end.
  const lead = runBeats * (receding ? Math.max(0, exit - home) : home)
  const tail = runBeats * (receding ? home : Math.max(0, exit - home))

  const spawns = notes
    .filter((note) => note.pitch === APPROACH_SPAWN_PITCH)
    .sort((a, b) => a.beat - b.beat)

  const allocation: ApproachAllocation[] = []
  const freeAt: number[] = new Array(count).fill(-Infinity)
  // Which allocation currently holds each slot, so a steal can truncate it.
  const held: (ApproachAllocation | null)[] = new Array(count).fill(null)

  for (const note of spawns) {
    const startBeat = note.beat - lead
    const endBeat = note.beat + tail

    // First genuinely free slot.
    let slot = -1
    for (let i = 0; i < count; i++) {
      if (freeAt[i] <= startBeat) { slot = i; break }
    }
    if (slot < 0) {
      // Every copy is on screen. Steal the one that would free soonest and cut
      // its flight off here - the least visible loss available.
      let soonest = 0
      for (let i = 1; i < count; i++) if (freeAt[i] < freeAt[soonest]) soonest = i
      // At speed 0 nothing ever frees; parked copies keep their slots instead of
      // being churned by every later note.
      if (!Number.isFinite(freeAt[soonest])) continue
      slot = soonest
      const victim = held[slot]
      if (victim) victim.endBeat = Math.min(victim.endBeat, startBeat)
    }

    const claim: ApproachAllocation = {
      slot,
      noteBeat: note.beat,
      startBeat,
      endBeat,
      sizeScale: midiVelocity(note.velocity),
    }
    allocation.push(claim)
    freeAt[slot] = endBeat
    held[slot] = claim
  }
  return allocation
}

/** Sample a precomputed allocation at `beat` into per-slot flights. */
export function approachFlightsAt(
  settings: ApproachSettings,
  allocation: readonly ApproachAllocation[],
  beat: number,
): ApproachFlight[] {
  const count = approachCount(settings)
  const runBeats = approachRunBeats(settings)
  const home = approachHomeProgress(settings)
  const sign = approachDirectionSign(settings)

  const flights: ApproachFlight[] = Array.from({ length: count }, () => ({
    progress: 0,
    sizeScale: 1,
    active: false,
  }))
  for (const claim of allocation) {
    if (claim.slot >= count) continue
    if (beat < claim.startBeat || beat >= claim.endBeat) continue
    const elapsed = Number.isFinite(runBeats) ? (beat - claim.noteBeat) / runBeats : 0
    const progress = home + sign * elapsed
    flights[claim.slot] = {
      progress: Math.max(0, Math.min(1, progress)),
      sizeScale: claim.sizeScale,
      active: true,
    }
  }
  return flights
}

/** Allocate and sample in one go. The runtime path splits these so allocation
 *  happens once per resolve; this is for direct/test evaluation. */
export function approachNoteFlights(
  settings: ApproachSettings,
  notes: readonly ResolvedNote[],
  beat: number,
): ApproachFlight[] {
  return approachFlightsAt(settings, allocateApproachFlights(settings, notes), beat)
}

/**
 * A flight's transform and opacity. The copy sits at `nearEnd - depth` plus how
 * far it has come, and scales linearly from nothing to `size` across the run -
 * linear in SCALE, which the eye reads as accelerating approach because apparent
 * size on screen also goes with 1/distance.
 *
 * Offsets are divided by the placement scale for the same world-metric reason
 * tunnel.ts documents; the SCALE component deliberately is not, because that one
 * is meant to multiply whatever size the instrument draws itself at.
 */
export function approachFlightTransform(
  flight: ApproachFlight,
  settings: ApproachSettings,
  placementScale: [number, number, number],
): { transform: Matrix4; opacity: number } {
  const depth = Math.max(0.0001, settings.depth)
  const progress = Math.max(0, Math.min(1, flight.progress))
  const scale = Math.max(MIN_SCALE, progress * settings.size * flight.sizeScale)

  const axial = settings.nearEnd - depth + progress * depth
  const position = new Vector3()
    .addScaledVector(Z_AXIS, axial)
  position.set(position.x / placementScale[0], position.y / placementScale[1], position.z / placementScale[2])

  const transform = new Matrix4().makeScale(scale, scale, scale).setPosition(position)
  const fade = FADE_IN <= 0 ? 1 : Math.min(1, progress / FADE_IN)
  return { transform, opacity: flight.active ? fade : 0 }
}

export const approachSplitter: MoverOrSplitterDefinition<ApproachSettings> = {
  id: 'approach',
  label: 'Approach',
  kind: 'splitter',
  identityColor: APPROACH_COLOR,
  params: [
    // 8 in flight over a 24-unit run at 5/beat: an arrival every ~0.6 beats,
    // and the run is short enough that copies are already legibly large by the
    // time they are a third of the way in. Dropped on a track these defaults
    // have to READ as flying-into-it immediately - a longer, sparser run is a
    // truer corridor but shows the viewer almost nothing on the first frame.
    { key: 'density', label: 'Density', min: 1, max: APPROACH_MAX_DENSITY, step: 1, default: 8, integer: true },
    { key: 'speed', label: 'Speed / beat', min: 0, max: 60, step: 0.1, default: 5 },
    { key: 'depth', label: 'Distance', min: 1, max: 200, step: 1, default: 24 },
    { key: 'size', label: 'Arrival size', min: 0, max: 8, step: 0.05, default: 2 },
    {
      key: 'direction',
      label: 'Direction',
      type: 'select',
      options: [
        { value: 0, label: 'Toward camera' },
        { value: 1, label: 'Away into distance' },
      ],
      default: 0,
    },
    {
      key: 'spawnMode',
      label: 'Spawn',
      type: 'select',
      options: [
        { value: 0, label: 'Stream' },
        { value: 1, label: 'On notes' },
      ],
      default: 0,
    },
    // Camera sits at z = 5; recycling at 12 keeps the swap comfortably behind it.
    { key: 'nearEnd', label: 'Near end (past camera)', min: -20, max: 40, step: 0.5, default: 12 },
  ],
  midiRows: () => APPROACH_ROWS,
  resolve({ settings, notes }) {
    const count = approachCount(settings)
    const noteMode = Math.round(settings.spawnMode) === 1
    // Voice allocation is a pure function of (settings, notes) - no beat in it -
    // so it is computed once here rather than rebuilt on every frame.
    const allocation = noteMode ? allocateApproachFlights(settings, notes) : []
    return {
      apply(visualCopy, { beat, placementTransform }) {
        const placementScale = placementAxisScale(placementTransform)
        const flights = noteMode
          ? approachFlightsAt(settings, allocation, beat)
          : Array.from({ length: count }, (_, slot) => approachStreamFlight(slot, settings, beat))
        return flights.map((flight) => {
          const { transform, opacity } = approachFlightTransform(flight, settings, placementScale)
          // LOCAL composition (previous * delta), the chain default: each copy's
          // transform re-frames the movers below it, so a Rotate under an
          // Approach spins each incoming copy about its own axis.
          const next: VisualCopy = {
            transform: visualCopy.transform.clone().multiply(transform),
            opacity: visualCopy.opacity * opacity,
            colorShift: { ...visualCopy.colorShift },
          }
          return next
        })
      },
    }
  },
}

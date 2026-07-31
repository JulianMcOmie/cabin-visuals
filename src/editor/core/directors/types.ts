import type { MidiRowDef, ParamDef } from '../../instruments/types'
import type { Scene, Track } from '../../types'

export interface CompositionLayer {
  directorTrackId: string
  sceneId: string
  opacity: number
  /** Normalized viewport in final-frame coordinates. */
  viewport: { x: number; y: number; width: number; height: number }
  /** Optional full-frame partition mask. Linear layers share straight or
   * diagonal boundaries; radial layers form nested discs, small-to-large;
   * slice layers are evenly spaced bands at an arbitrary angle.
   *
   * `slice` differs from `linear` in two ways that matter. Its bands are even
   * in width measured PERPENDICULAR to the cut (linear's are even in screen x,
   * so a slanted linear band is visibly thinner than an upright one), and its
   * band span is derived from the frame's extent along the cut normal, so the
   * outermost bands always reach the corners instead of leaving the wedge that
   * linear's fixed shear leaves. `angle` is in degrees and wraps continuously:
   * 0 stacks bands left to right, 90 bottom to top, 180 right to left. */
  partition?:
    | { kind: 'linear'; index: number; count: number; slant: number }
    | { kind: 'radial'; index: number; count: number; radiusIndex?: number }
    | { kind: 'slice'; index: number; count: number; angle: number; radial?: boolean }
  /**
   * Entry flash: how far the layer is mixed toward white. 0 = untouched,
   * 1 = fully blown out.
   *
   * A cut flash is a WHITE frame - a film splice, a camera pop - not a brighter
   * frame, so this washes out rather than lifting exposure. It is a lerp toward
   * white rather than an additive offset, which is the difference between a
   * clean dip-to-white and a muddy one: adding a constant leaves the darks
   * lifted and grey and the brights clipping unevenly per channel, while a lerp
   * carries every value to white together and returns each of them exactly to
   * where it started. The white target sits slightly above 1 so the peak is
   * unambiguously clipped and has headroom to drive the bloom pass.
   */
  flash?: number
  /**
   * Directional motion blur on the layer's content, as a smear length in
   * normalized frame widths. The direction is implied by the partition - across
   * the bands for a linear cut, outward from the center for a radial one - so
   * the streak always runs along the axis the mask is organized by.
   */
  blur?: number
  /** Future directors can request a named scene camera without changing the
   * composition contract. Omitted means the scene's default camera. */
  cameraId?: string
  blendMode?: 'normal' | 'add' | 'multiply' | 'screen'
}

export interface DirectorResolveContext {
  beat: number
  beatsPerBar: number
  totalBars: number
  scenes: Record<string, Scene>
  sceneOrder: string[]
}

/** Directors are Main-scene instruments. The runtime always resolves an ordered
 * array of them; the first product UI happens to create only a Switcher. */
export interface DirectorInstrumentDef {
  id: string
  name: string
  params: ParamDef[]
  midiRows: (track: Track, scenes: Record<string, Scene>, sceneOrder: string[]) => MidiRowDef[]
  /**
   * Keep the settings panel from listing the MIDI rows. Worth setting when the
   * rows are mechanical (slice 1..N) rather than informative (a scene per row):
   * the piano roll already labels them, and a director with 32 divisions would
   * otherwise bury its own parameters under 32 lines of list.
   */
  hideMidiRowsInSettings?: boolean
  /**
   * This director targets exactly ONE scene rather than composing several, so
   * its rows mean something other than "which scene". The settings panel offers
   * a single scene picker instead of an order list, and resolve() should read
   * the first binding. Without this the choice is unreachable: the scene would
   * be whichever one happens to sort first.
   */
  targetsSingleScene?: boolean
  resolve: (track: Track, context: DirectorResolveContext) => CompositionLayer[]
}

export const FULL_FRAME = { x: 0, y: 0, width: 1, height: 1 } as const
export const DIRECTOR_OPACITY_PARAM: ParamDef = {
  key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01, default: 1,
}

/** The params an automation child lane may target on a director track: the
 *  shared Opacity plus the director's own params. The single source for the
 *  context menu, the lane's piano-roll value rows and the engine's lane
 *  resolution, so they can never disagree about a param's [min,max]. */
export function directorAutomatableParams(def: DirectorInstrumentDef | undefined): ParamDef[] {
  return def ? [DIRECTOR_OPACITY_PARAM, ...def.params] : []
}

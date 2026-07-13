import type { MidiRowDef, ParamDef } from '../../instruments/types'
import type { Scene, Track } from '../../types'

export interface CompositionLayer {
  directorTrackId: string
  sceneId: string
  opacity: number
  /** Normalized viewport in final-frame coordinates. */
  viewport: { x: number; y: number; width: number; height: number }
  /** Optional full-frame partition mask. Linear layers share straight or
   * diagonal boundaries; radial layers form nested discs, small-to-large. */
  partition?:
    | { kind: 'linear'; index: number; count: number; slant: number }
    | { kind: 'radial'; index: number; count: number; radiusIndex?: number }
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
  resolve: (track: Track, context: DirectorResolveContext) => CompositionLayer[]
}

export const FULL_FRAME = { x: 0, y: 0, width: 1, height: 1 } as const
export const DIRECTOR_OPACITY_PARAM: ParamDef = {
  key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01, default: 1,
}

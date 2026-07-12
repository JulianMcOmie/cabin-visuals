import type { MidiRowDef, ParamDef } from '../../instruments/types'
import type { Scene, Track } from '../../types'

export interface CompositionLayer {
  directorTrackId: string
  sceneId: string
  opacity: number
  /** Normalized viewport in final-frame coordinates. */
  viewport: { x: number; y: number; width: number; height: number }
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

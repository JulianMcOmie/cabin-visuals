export interface Note {
  id: string
  startBeat: number
  durationBeats: number
  pitch: number
  velocity: number
}

export interface Block {
  id: string
  startBar: number
  durationBars: number
  loop: boolean
  notes: Note[]
}

export type TrackType = 'base' | 'add' | 'mute' | 'suppress' | 'override' | 'automation'

export type InterpolationMode = 'step' | 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'exponential' | 'smooth-step'

export interface Track {
  id: string
  name: string
  type: TrackType
  instrumentId: string
  /** User-set instrument parameter values (keys defined by the instrument schema). */
  params?: Record<string, number>
  color: string
  muted: boolean
  solo: boolean
  blocks: Block[]
  parentId?: string
  childIds: string[]
  targets?: { targetTrackId: string; targetPort: string }[]
  targetParam?: string
  interpolation?: InterpolationMode
}

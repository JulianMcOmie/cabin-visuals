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

/**
 * A modulator's routing: which port it drives, over what scope, scaled by how much.
 * `scope` is what lets one modulator hit a single track, a whole tag group, or
 * (phase 5) a subtree. `port` is the target objects' port key; `amount` scales the
 * modulator's output before it's combined at the port.
 */
export interface Routing {
  port: string
  scope:
    | { kind: 'track'; id: string }
    | { kind: 'tag'; tag: string }
    | { kind: 'subtree'; id: string }
  amount: number
}

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
  /** Modulator-only: the ports this modulator drives (one modulator → many ports). */
  targets?: Routing[]
  targetParam?: string
  interpolation?: InterpolationMode
}

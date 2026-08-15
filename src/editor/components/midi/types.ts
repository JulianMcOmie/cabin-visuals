export interface MidiRow {
  pitch: number
  label: string
  color: string
  noteLabel?: string
  emphasized?: boolean
  /** See MidiRowDef: style-lane rows render their label in their own face. */
  fontFamily?: string
  sizeScale?: number
  laneIndex?: number
}

export interface RangeLabel {
  startPitch: number
  endPitch: number
  label: string
}

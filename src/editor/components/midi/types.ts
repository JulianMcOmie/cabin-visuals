export interface MidiRow {
  pitch: number
  label: string
  color: string
  noteLabel?: string
  emphasized?: boolean
}

export interface RangeLabel {
  startPitch: number
  endPitch: number
  label: string
}

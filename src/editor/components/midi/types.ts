export interface MidiRow {
  pitch: number
  label: string
  color: string
  noteLabel?: string
  emphasized?: boolean
  backgroundColor?: string
}

export interface RangeLabel {
  startPitch: number
  endPitch: number
  label: string
}

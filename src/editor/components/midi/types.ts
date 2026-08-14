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
  /** This row holds the track's LYRIC CLIPS, not notes: the grid renders the
   *  clips in it (note-style rects with move/resize), and note drawing skips
   *  it. Text tracks put it at the top. */
  clipRow?: boolean
}

export interface RangeLabel {
  startPitch: number
  endPitch: number
  label: string
}

// MIDI import: bytes in, document-shaped data out. No store access - the only
// file that imports @tonejs/midi. Time stays in the beat domain end to end: a
// note's ticks over the file's PPQ ARE beats (quarter note = 1 beat), so the
// file's tempo map and the project's bpm never meet.
import { Midi } from '@tonejs/midi'
import type { Note } from '../types'

// Floor for degenerate zero/near-zero durations - anything shorter is
// invisible and un-grabbable in the editor.
const MIN_NOTE_DURATION_BEATS = 0.05

export interface ImportedMidiTrack {
  /** MIDI track name, trimmed; '' when the file names nothing (callers number these). */
  name: string
  /** startBeat is FILE-absolute; placement shifts notes block-relative. */
  notes: Note[]
  /** End of the last note, in file-absolute beats. */
  endBeat: number
}

// Which files ARE MIDI (isMidiFileName / isMidiMimeType) lives with the rest
// of the media-kind routing in mediaFileKinds.ts; this file only turns bytes
// into notes.

/** Parse a .mid file into one entry per MIDI track that has notes. Throws on
 *  malformed bytes. Pitch imports verbatim (full range - narrow instruments
 *  ignore what they don't map; the view reconciles). CC / pitch-bend lanes are
 *  dropped for now; TODO: map them onto the automation system once it has
 *  richer targets than instrument params. */
export function parseMidiFile(bytes: ArrayBuffer): ImportedMidiTrack[] {
  const midi = new Midi(bytes)
  const ppq = midi.header.ppq
  return midi.tracks
    .filter((t) => t.notes.length > 0)
    .map((t) => {
      const notes: Note[] = t.notes.map((n) => ({
        id: crypto.randomUUID(),
        pitch: n.midi,
        startBeat: n.ticks / ppq,
        durationBeats: Math.max(MIN_NOTE_DURATION_BEATS, n.durationTicks / ppq),
        velocity: Math.round(n.velocity * 127),
      }))
      let endBeat = 0
      for (const n of notes) endBeat = Math.max(endBeat, n.startBeat + n.durationBeats)
      return { name: t.name.trim(), notes, endBeat }
    })
}

import type { Note } from '../types'

// Note provenance: who wrote a note and a hash of what they wrote (Note.src).
// A script (the cabin CLI) stamps every note it adds; the editor never does.
// So at any time a note is one of:
//   untouched script note  src present, hash of its CURRENT content == src.h
//   edited script note     src present, hash differs (you moved/stretched it)
//   your note              no src (drawn in the editor)
// Re-running a script replaces only untouched script notes (tools/cabin/lib/
// api.ts), and the piano roll marks them so you can tell whose is whose.
//
// The hash is over ABSOLUTE content (block start + beat), so moving a block
// counts as an edit too.

/** FNV-1a over the note's absolute beat, pitch, length and velocity. */
export function noteHash(absBeat: number, pitch: number, dur: number, vel: number): string {
  const s = `${Math.round(absBeat * 1e4)}|${pitch}|${Math.round(dur * 1e4)}|${vel}`
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** A script-written note nobody has touched since. */
export function isUntouchedScriptNote(note: Pick<Note, 'startBeat' | 'durationBeats' | 'pitch' | 'velocity' | 'src'>, blockStartBeat: number): boolean {
  return !!note.src && note.src.h === noteHash(blockStartBeat + note.startBeat, note.pitch, note.durationBeats, note.velocity)
}

import type { Block, Note, Track } from '../../types'
import type { ResolvedNote } from './types'

/** Hard ceiling on notes emitted per block, so a tiny pattern stretched across a
 *  huge block can never hang the resolve. */
const NOTE_CAP_PER_BLOCK = 10000

/** A looped block's pattern length in beats: the explicit loopLengthBars when set,
 *  otherwise the note extent rounded up to whole bars (minimum one bar). */
export function loopLengthBeats(block: Pick<Block, 'loopLengthBars' | 'notes'>, beatsPerBar: number): number {
  const explicit = typeof block.loopLengthBars === 'number' ? block.loopLengthBars * beatsPerBar : 0
  if (explicit > 0) return explicit
  let maxNoteEnd = 0
  for (const note of block.notes) maxNoteEnd = Math.max(maxNoteEnd, note.startBeat + note.durationBeats)
  if (maxNoteEnd <= 0) return beatsPerBar
  return Math.max(beatsPerBar, Math.ceil(maxNoteEnd / beatsPerBar) * beatsPerBar)
}

/** One occurrence of a pattern note in a looped block, in block-local beats. */
export interface TiledNote {
  note: Note
  startBeat: number
  /** Clipped at the block end. */
  durationBeats: number
  /** 0 = the pattern occurrence, 1+ = repeats. */
  repeat: number
}

/** Tile a looped block's pattern across the block length. Each note's phase is
 *  its startBeat modulo the loop length (split-produced blocks store shifted
 *  phases, possibly negative); the final partial repeat clips at the block end. */
export function tileLoopNotes(notes: Note[], loopBeats: number, blockBeats: number, maxNotes = NOTE_CAP_PER_BLOCK): TiledNote[] {
  const out: TiledNote[] = []
  if (loopBeats <= 0 || blockBeats <= 0) return out
  for (let repeat = 0, offset = 0; offset < blockBeats; repeat++, offset += loopBeats) {
    for (const note of notes) {
      // Plain remainder, not a double modulo: an in-window startBeat must come
      // back bit-identical so previews can match occurrences to authored notes.
      const rem = note.startBeat % loopBeats
      const phase = rem < 0 ? rem + loopBeats : rem
      const startBeat = offset + phase
      if (startBeat >= blockBeats) continue
      out.push({ note, startBeat, durationBeats: Math.min(note.durationBeats, blockBeats - startBeat), repeat })
      if (out.length >= maxNotes) return out
    }
  }
  return out
}

/** Flatten block-local notes into absolute project beats, expanding looped blocks at resolve time. */
export function flattenBlocks(blocks: Block[], beatsPerBar: number, totalBars?: number): ResolvedNote[] {
  const notes: ResolvedNote[] = []
  const projectEndBeat = totalBars == null ? Infinity : totalBars * beatsPerBar
  for (const block of blocks) {
    const blockStartBeat = block.startBar * beatsPerBar
    const blockEndBeat = Math.min(blockStartBeat + block.durationBars * beatsPerBar, projectEndBeat)
    const blockBeats = blockEndBeat - blockStartBeat
    if (blockBeats <= 0) continue
    if (block.loop) {
      const tiled = tileLoopNotes(block.notes, loopLengthBeats(block, beatsPerBar), blockBeats)
      if (tiled.length >= NOTE_CAP_PER_BLOCK) {
        console.warn(`Loop expansion capped at ${NOTE_CAP_PER_BLOCK} notes for block ${block.id}`)
      }
      for (const t of tiled) {
        notes.push({
          beat: blockStartBeat + t.startBeat,
          blockStartBeat,
          blockEndBeat,
          pitch: t.note.pitch,
          velocity: t.note.velocity,
          durationBeats: t.durationBeats,
        })
      }
    } else {
      for (const note of block.notes) {
        const beat = blockStartBeat + note.startBeat
        if (beat < blockStartBeat || beat >= blockEndBeat) continue
        notes.push({
          beat,
          blockStartBeat,
          blockEndBeat,
          pitch: note.pitch,
          velocity: note.velocity,
          durationBeats: Math.min(note.durationBeats, Math.max(0, blockEndBeat - beat)),
        })
      }
    }
  }
  notes.sort((a, b) => a.beat - b.beat)
  return notes
}

export function flattenTrackNotes(track: Track, beatsPerBar: number, totalBars?: number): ResolvedNote[] {
  return flattenBlocks(track.blocks, beatsPerBar, totalBars)
}

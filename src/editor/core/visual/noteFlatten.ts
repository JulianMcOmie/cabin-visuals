import type { Block, Track } from '../../types'
import type { ResolvedNote } from './types'

function inferredLoopLengthBeats(block: Block, beatsPerBar: number): number {
  const explicit = typeof block.loopLengthBars === 'number' ? block.loopLengthBars * beatsPerBar : 0
  if (explicit > 0) return explicit
  let maxNoteEnd = 0
  for (const note of block.notes) maxNoteEnd = Math.max(maxNoteEnd, note.startBeat + note.durationBeats)
  if (maxNoteEnd <= 0) return beatsPerBar
  return Math.max(beatsPerBar, Math.ceil(maxNoteEnd / beatsPerBar) * beatsPerBar)
}

/** Flatten block-local notes into absolute project beats, expanding looped blocks at resolve time. */
export function flattenBlocks(blocks: Block[], beatsPerBar: number, totalBars?: number): ResolvedNote[] {
  const notes: ResolvedNote[] = []
  const projectEndBeat = totalBars == null ? Infinity : totalBars * beatsPerBar
  const NOTE_CAP_PER_BLOCK = 10000
  for (const block of blocks) {
    const blockStartBeat = block.startBar * beatsPerBar
    const blockEndBeat = Math.min(blockStartBeat + block.durationBars * beatsPerBar, projectEndBeat)
    const loopLengthBeats = block.loop ? inferredLoopLengthBeats(block, beatsPerBar) : block.durationBars * beatsPerBar
    let emitted = 0
    for (let offset = 0; blockStartBeat + offset < blockEndBeat; offset += loopLengthBeats) {
      for (const note of block.notes) {
        const beat = blockStartBeat + offset + note.startBeat
        if (beat < blockStartBeat || beat >= blockEndBeat || beat >= projectEndBeat) continue
        notes.push({
          beat,
          blockStartBeat,
          blockEndBeat,
          pitch: note.pitch,
          velocity: note.velocity,
          durationBeats: Math.min(note.durationBeats, Math.max(0, blockEndBeat - beat)),
        })
        emitted++
        if (emitted >= NOTE_CAP_PER_BLOCK) {
          console.warn(`Loop expansion capped at ${NOTE_CAP_PER_BLOCK} notes for block ${block.id}`)
          offset = blockEndBeat - blockStartBeat
          break
        }
      }
      if (!block.loop) break
    }
  }
  notes.sort((a, b) => a.beat - b.beat)
  return notes
}

export function flattenTrackNotes(track: Track, beatsPerBar: number, totalBars?: number): ResolvedNote[] {
  return flattenBlocks(track.blocks, beatsPerBar, totalBars)
}


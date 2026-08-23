import type { Block, Note, Track } from '../../types'
import type { ResolvedNote } from './types'
import { carriesLyricClips, isLyricClipNote } from './lyricClips'

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

/** Tile a looped block's pattern across the block length. Each pattern note's
 *  phase is its startBeat modulo the loop length (split-produced blocks store
 *  shifted phases, possibly NEGATIVE - folding those is their storage
 *  contract); the final partial repeat clips at the block end.
 *
 *  Notes PAST the pattern window (startBeat >= loop length) do not loop: they
 *  play once, where they were authored. Folding them into the window turned a
 *  note the user placed after the pattern into a mystery repeat inside it. */
export function tileLoopNotes(notes: Note[], loopBeats: number, blockBeats: number, maxNotes = NOTE_CAP_PER_BLOCK): TiledNote[] {
  const out: TiledNote[] = []
  if (loopBeats <= 0 || blockBeats <= 0) return out
  for (const note of notes) {
    if (note.startBeat < loopBeats || note.startBeat >= blockBeats) continue
    out.push({ note, startBeat: note.startBeat, durationBeats: Math.min(note.durationBeats, blockBeats - note.startBeat), repeat: 0 })
    if (out.length >= maxNotes) return out
  }
  for (let repeat = 0, offset = 0; offset < blockBeats; repeat++, offset += loopBeats) {
    for (const note of notes) {
      if (note.startBeat >= loopBeats) continue
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

/** Flatten block-local notes into absolute project beats, expanding looped
 *  blocks at resolve time. `lyricClips` says the blocks belong to a TEXT
 *  track, whose pitch-61 notes are phrase spans with block-edge exemptions
 *  (below); off - the default, and what every other caller wants - a
 *  pitch-61 note is C#4 and is culled and truncated like any other. */
export function flattenBlocks(blocks: Block[], beatsPerBar: number, totalBars?: number, lyricClips = false): ResolvedNote[] {
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
          id: t.note.id,
          beat: blockStartBeat + t.startBeat,
          blockStartBeat,
          blockEndBeat,
          pitch: t.note.pitch,
          velocity: t.note.velocity,
          durationBeats: t.durationBeats,
          ...(t.note.lyric ? { lyric: t.note.lyric } : {}),
        })
      }
    } else {
      for (const note of block.notes) {
        const beat = blockStartBeat + note.startBeat
        // A LYRIC CLIP note is a phrase span, not a performance event, so the
        // block's edges neither cull nor truncate it: clips were block-independent
        // before they became notes (schema v16), and a phrase that reaches past
        // its block must keep working rather than going silently inert. It still
        // RIDES the block - its beat is block-relative like any note.
        const isClip = lyricClips && isLyricClipNote(note)
        if (!isClip && (beat < blockStartBeat || beat >= blockEndBeat)) continue
        notes.push({
          id: note.id,
          beat,
          blockStartBeat,
          blockEndBeat,
          pitch: note.pitch,
          velocity: note.velocity,
          durationBeats: isClip ? note.durationBeats : Math.min(note.durationBeats, Math.max(0, blockEndBeat - beat)),
          ...(note.lyric ? { lyric: note.lyric } : {}),
        })
      }
    }
  }
  notes.sort((a, b) => a.beat - b.beat)
  return notes
}

export function flattenTrackNotes(track: Track, beatsPerBar: number, totalBars?: number): ResolvedNote[] {
  return flattenBlocks(track.blocks, beatsPerBar, totalBars, carriesLyricClips(track))
}

// The composition instruments (core/directors) flatten their track's notes on
// EVERY frame - they never enter the resolved graph, so there is no resolve
// step to do it once for them. This memo keys on the blocks array's identity
// (the store replaces it on any block/note edit, the same invalidation the
// per-track resolve cache in resolve.ts relies on) plus the two tempo inputs,
// and hands back the same array until one of them changes. Read-only by
// contract: callers iterate it and never sort or splice it. Deliberately not
// wired into `flattenTrackNotes` itself - the resolve-time callers hand the
// result to definitions that own it, and sharing one array between two
// resolves of the same track is not something they were written to expect.
interface FlattenMemo {
  beatsPerBar: number
  totalBars: number | undefined
  /** Part of the key: an instrument swap keeps the blocks' identity but can
   *  change whether pitch 61 is a clip or a note. */
  lyricClips: boolean
  notes: ResolvedNote[]
}
const flattenMemo = new WeakMap<Block[], FlattenMemo>()

export function flattenTrackNotesMemo(track: Track, beatsPerBar: number, totalBars?: number): ResolvedNote[] {
  const blocks = track.blocks
  const lyricClips = carriesLyricClips(track)
  const hit = flattenMemo.get(blocks)
  if (hit && hit.beatsPerBar === beatsPerBar && hit.totalBars === totalBars && hit.lyricClips === lyricClips) return hit.notes
  const notes = flattenBlocks(blocks, beatsPerBar, totalBars, lyricClips)
  flattenMemo.set(blocks, { beatsPerBar, totalBars, lyricClips, notes })
  return notes
}

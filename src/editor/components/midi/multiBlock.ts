import type { Block, Note } from '../../types'
import { loopLengthBeats, tileLoopNotes } from '../../core/visual/noteFlatten'

export interface MidiBlockView {
  trackId: string
  name: string
  color: string
  block: Block
}

/** Overlapping clips get separate header lanes; adjacent clips share a lane. */
export function midiBlockLanes(blocks: MidiBlockView[]) {
  const ends: number[] = []
  return [...blocks].sort((a, b) => a.block.startBar - b.block.startBar || a.block.id.localeCompare(b.block.id)).map(view => {
    const { startBar, durationBars } = view.block
    let lane = ends.findIndex(end => end <= startBar)
    if (lane < 0) lane = ends.length
    ends[lane] = startBar + durationBars
    return { ...view, lane }
  })
}

/** Display-only instances retain their owner and never enter another clip's note array. */
export function midiBlockPreviewNotes(block: Block, beatsPerBar: number): (Note & { repeat: number })[] {
  if (!block.loop) return block.notes.map(note => ({ ...note, repeat: 0 }))
  return tileLoopNotes(block.notes, loopLengthBeats(block, beatsPerBar), block.durationBars * beatsPerBar, 2000)
    .map(instance => ({ ...instance.note, startBeat: instance.startBeat, durationBeats: instance.durationBeats, repeat: instance.repeat }))
}

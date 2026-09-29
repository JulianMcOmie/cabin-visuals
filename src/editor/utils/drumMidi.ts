import type { ImportedMidiTrack } from '../core/midiImport'
import type { AudioBlock, Track } from '../types'
import { DRUM_NAMES, DRUM_PITCHES, type DrumHit, type DrumPart } from './drumDetection'

export function placeDrumMidi(hits: DrumHit[], part: DrumPart, audio: AudioBlock, bpm: number, beatsPerBar: number): ImportedMidiTrack {
  const notes = hits.filter((h) => Number.isFinite(h.time) && Number.isFinite(h.velocity) && h.time >= audio.trimStart && h.time < audio.trimEnd)
    .map((h) => ({
      id: crypto.randomUUID(), pitch: DRUM_PITCHES[part],
      startBeat: audio.startBar * beatsPerBar + (h.time - audio.trimStart) * bpm / 60,
      durationBeats: Math.min(0.1, (audio.trimEnd - h.time) * bpm / 60),
      velocity: Math.max(1, Math.min(127, Math.round(h.velocity))),
    }))
  return {
    name: `${DRUM_NAMES[part]} MIDI`, notes,
    endBeat: notes.reduce((end, n) => Math.max(end, n.startBeat + n.durationBeats), 0),
    drumMidi: { audioBlockId: audio.id, anchorBar: audio.startBar },
  }
}

/** Rescale the CURRENT editable document, never regenerate from detections.
 * This preserves deleted notes, hand timing, velocities, block moves and loops. */
export function rescaleDrumMidi(track: Track, ratio: number, anchorBar: number): Track {
  if (!track.drumMidi) return track
  return { ...track, blocks: track.blocks.map((b) => ({
    ...b,
    startBar: anchorBar + (b.startBar - anchorBar) * ratio,
    durationBars: b.durationBars * ratio,
    ...(b.loopLengthBars === undefined ? {} : { loopLengthBars: b.loopLengthBars * ratio }),
    notes: b.notes.map((n) => ({ ...n, startBeat: n.startBeat * ratio, durationBeats: n.durationBeats * ratio })),
  })) }
}

import type { LyricWord } from '../store/ProjectStore'

// Timed words (seconds into the song) -> lyric notes (project beats). Shared
// by the lyric-template setup pipeline; the seconds come from the
// transcription/alignment routes (/api/transcribe, /api/align).

export interface TranscribedWord {
  word: string
  start: number
  end: number
}

// Text Display's parser treats whitespace as the word separator and gives
// '!' and '|' grouping powers - none of which a lyric word should smuggle in.
// Edge punctuation goes too (aligners echo it back); inner apostrophes stay.
export function sanitizeWord(raw: string): string {
  return raw
    .replace(/[\s|!]+/g, '')
    .replace(/^[.,;:"“”‘’()[\]?-]+|[.,;:"“”‘’()[\]?-]+$/g, '')
}

/** Sung seconds -> project-beat words, mapped through the audio placement.
 *  `trustEnds` decides where a word's note ends: forced alignment returns
 *  dependable end times, so aligned words end when they're sung (no
 *  lingering); transcription end times are noisier, so those words hold
 *  until the next one's onset instead. */
export function placeTranscription(
  words: TranscribedWord[],
  audio: { startBar: number; trimStart: number },
  bpm: number,
  beatsPerBar: number,
  trustEnds: boolean,
): LyricWord[] {
  const secPerBeat = 60 / bpm
  const blockStartBeat = audio.startBar * beatsPerBar
  const placed: LyricWord[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const word = sanitizeWord(w.word)
    if (!word) continue
    const startBeat = blockStartBeat + (w.start - audio.trimStart) / secPerBeat
    if (startBeat < 0) continue // sung before the clip's in-point
    const next = words[i + 1]
    const endSec = trustEnds
      ? Math.min(w.end, next?.start ?? Infinity) // never across the next onset
      : next ? next.start : w.start + 2 * secPerBeat
    const durationBeats = Math.max(0.15, (endSec - w.start) / secPerBeat)
    placed.push({ word, startBeat, durationBeats })
  }
  return placed
}

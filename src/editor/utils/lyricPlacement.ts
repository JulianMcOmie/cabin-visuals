// Timed words (seconds into the song) -> lyric notes (project beats). Shared
// by the lyric-template setup pipeline AND ProjectStore's BPM rescale: the
// transcribed Lyrics track keeps its word timing in SECONDS as the source of
// truth, and beats are re-derived through this whenever the BPM changes.

export interface TranscribedWord {
  word: string
  start: number
  end: number
}

/** One lyric word placed on the project timeline (absolute beats). */
export interface LyricWord {
  word: string
  startBeat: number
  durationBeats: number
}

// Text Display's parser treats whitespace as the word separator and gives
// '!' and '|' grouping powers - none of which a lyric word should smuggle in.
// Edge punctuation goes too (aligners echo it back); inner apostrophes stay.
export function sanitizeWord(raw: string): string {
  return raw
    .replace(/[\s|!]+/g, '')
    .replace(/^[.,;:"“”‘’()[\]?-]+|[.,;:"“”‘’()[\]?-]+$/g, '')
}

/** A span (absolute beats) during which the Monochrome invert strobe holds.
 *  `velocity` is MIDI velocity for the invert note - Color Filters scales the
 *  invert amount by it, so a sub-127 span renders a partially-inverted
 *  (dimmed-white) frame. */
export interface StrobeSpan {
  startBeat: number
  durationBeats: number
  velocity: number
}

/**
 * The Monochrome style's polarity plan, measured frame-by-frame off the
 * reference: the frame flips on EVERY word onset ("WHO" white → "+YOU" black
 * → "+FOOLIN'?" white → ...), a strict global toggle. Even-indexed words
 * (0-based) invert the frame from their onset until the next word lands - or,
 * when the line pauses, until shortly after the word ends. No words = no
 * spans: the frame sits black through instrumentals (the reference's verse
 * shows zero visual events).
 */
export function invertStrobeSpans(
  words: { startBeat: number; durationBeats: number }[],
  holdBeats = 0.75,
): StrobeSpan[] {
  const sorted = [...words].sort((a, b) => a.startBeat - b.startBeat)
  const spans: StrobeSpan[] = []
  // The reference's measured "flicker": a white hold DIMS to ~85% for its last
  // couple of frames before flipping to black (luminance 145 → ~123 → 22).
  // Encoded as a short lower-velocity tail carved out of longer spans.
  const TAIL_BEATS = 0.12
  const TAIL_VELOCITY = 108 // ≈ 85% invert = the measured dimmed white
  for (let i = 0; i < sorted.length; i += 2) {
    const word = sorted[i]
    const next = sorted[i + 1]
    const naturalEnd = word.startBeat + word.durationBeats + holdBeats
    const end = next ? Math.min(next.startBeat, naturalEnd) : naturalEnd
    const length = end - word.startBeat
    if (length <= 0) continue
    if (length >= 0.5) {
      spans.push({ startBeat: word.startBeat, durationBeats: length - TAIL_BEATS, velocity: 127 })
      spans.push({ startBeat: end - TAIL_BEATS, durationBeats: TAIL_BEATS, velocity: TAIL_VELOCITY })
    } else {
      spans.push({ startBeat: word.startBeat, durationBeats: length, velocity: 127 })
    }
  }
  return spans
}

/**
 * Where new Stack cards begin (excluding the very first): at a phrase gap of
 * `phraseGapBeats` or when the previous card holds `maxWords` words. MUST
 * mirror Text Display's Stack segmentation exactly - the Monochrome refill
 * places its 1-frame zoom flashes on these boundaries (the reference's
 * giant-letter inserts punctuate exactly these cuts), and a flash on a
 * non-boundary would blow up the wrong card.
 */
export function stackCardStarts(
  words: { startBeat: number; durationBeats: number }[],
  phraseGapBeats: number,
  maxWords: number,
): number[] {
  const sorted = [...words].sort((a, b) => a.startBeat - b.startBeat)
  const starts: number[] = []
  let count = 0
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) { count = 1; continue }
    if (sorted[i].startBeat - sorted[i - 1].startBeat >= phraseGapBeats || count >= maxWords) {
      starts.push(sorted[i].startBeat)
      count = 1
    } else {
      count++
    }
  }
  return starts
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

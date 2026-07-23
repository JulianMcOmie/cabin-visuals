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

/** A span (absolute beats) during which the Monochrome invert strobe holds. */
export interface StrobeSpan {
  startBeat: number
  durationBeats: number
}

/**
 * The Monochrome style's polarity plan: words split into phrases at gaps of
 * `minGapBeats` or more, and every OTHER phrase gets an invert span covering
 * it - so the frame flips black/white per phrase, and NEVER flips while
 * nothing is being sung (no words = no spans, the screen stays black).
 * Long phrases flip at their midpoint instead of holding one polarity, which
 * is the reference's inside-a-line flip ("WHO YOU" white → "FOOLIN'?" black).
 */
export function invertStrobeSpans(
  words: { startBeat: number; durationBeats: number }[],
  minGapBeats = 1,
): StrobeSpan[] {
  if (words.length === 0) return []
  const phrases: { start: number; end: number }[] = []
  let start = words[0].startBeat
  let end = words[0].startBeat + words[0].durationBeats
  for (const w of words.slice(1)) {
    if (w.startBeat - end >= minGapBeats) {
      phrases.push({ start, end })
      start = w.startBeat
    }
    end = Math.max(end, w.startBeat + w.durationBeats)
  }
  phrases.push({ start, end })

  const spans: StrobeSpan[] = []
  let inverted = false // open on black, like the reference
  for (const phrase of phrases) {
    const length = phrase.end - phrase.start
    if (length > 6) {
      // A long phrase alternates within itself: half one polarity, half the other.
      const half = length / 2
      spans.push({ startBeat: inverted ? phrase.start : phrase.start + half, durationBeats: half })
    } else if (inverted) {
      spans.push({ startBeat: phrase.start, durationBeats: length })
    }
    inverted = !inverted
  }
  return spans
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

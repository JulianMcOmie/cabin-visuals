import { doc, track, block, n, every, pulse } from './builder'
import type { TemplateDef } from './library'
import type { Note } from '../editor/types'

// The lyric-video template: a styled Text Display track named 'Lyrics'
// carrying placeholder words, ready for the real flow - create the project,
// drop in a song (BPM + downbeat auto-match), open Lyrics → Transcribe, and
// the transcription REPLACES this track's words while keeping its styling
// (addLyricTrack refills a root track named 'Lyrics' instead of stacking a
// second one).

const NEXT_WORD = 48 // Text Display's "advance to the next word" pitch
const BASS_POP = 47 // punch + shake accent

const BARS = 16
const BEATS = BARS * 4
const PHRASE = 16 // the 12-word pattern below repeats every 16 beats

// Placeholder lines (original words). The Nth word note shows the Nth word,
// cycling - so one phrase of notes can repeat while the 12 words stay in step.
type WordHit = [word: string, beat: number, dur?: number]
const LINES: WordHit[] = [
  ['we', 0], ['light', 1], ['up', 2], ['the', 3], ['night', 4, 1.8], ['sky', 6, 1.8],
  ['every', 8], ['heart', 9], ['beats', 10], ['louder', 11], ['right', 12, 1.8], ['now', 14, 1.8],
]

function lyricPattern(): { text: string; notes: Note[] } {
  const pattern = LINES.map(([, beat, dur]) => n(beat, NEXT_WORD, dur ?? 0.9))
  return {
    text: LINES.map(([word]) => word).join(' '),
    notes: every(PHRASE, BEATS, pattern),
  }
}

const words = lyricPattern()

/** One phrase-start punch per 4-bar boundary. */
const pops = pulse(BASS_POP, PHRASE, BEATS, { dur: 0.5 })

export const LYRIC_TEMPLATES: TemplateDef[] = [
  {
    id: 'lyricVideo',
    name: 'Lyric Video',
    description: 'Big bold words on black, punching in time. Add your song, then Lyrics → Transcribe to drop in the real words.',
    bpm: 120,
    cardPreview: 'animatedLyric',
    document: doc({
      bpm: 120,
      totalBars: BARS,
      tracks: [
        track({
          name: 'Lyrics',
          instrumentId: 'textDisplay',
          color: '#e4e4e7',
          params: { fontSize: 1.25, onsetBounce: 0.12, releaseDuration: 0.6, strokeWidth: 0 },
          stringParams: { text: words.text },
          blocks: [block(0, BARS, [...words.notes, ...pops])],
        }),
      ],
    }),
  },
]

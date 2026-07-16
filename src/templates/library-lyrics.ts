import { doc, track, block, n, every, pulse } from './builder'
import type { TemplateDef } from './library'
import type { Note } from '../editor/types'

// Lyric-video templates: each is a styled Text Display track named 'Lyrics'
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

/** One phrase-start punch per bar-4 boundary. */
const pops = pulse(BASS_POP, PHRASE, BEATS, { dur: 0.5 })

// Alternating line heights: line 1 sits low-center, line 2 lifts - held 60-72
// pitches steer Text Display's vertical placement.
const lineHeights = every(PHRASE, BEATS, [n(0, 64, 8), n(8, 69, 8)])

export const LYRIC_TEMPLATES: TemplateDef[] = [
  {
    id: 'lyricClassic',
    name: 'Lyric Video - Classic',
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
  {
    id: 'lyricNeon',
    name: 'Lyric Video - Neon',
    description: 'Rainbow words with ping-pong echoes trailing each line. Transcribe your song to swap in the real lyrics.',
    bpm: 120,
    cardPreview: 'animatedLyric',
    document: doc({
      bpm: 120,
      totalBars: BARS,
      tracks: [
        track({
          name: 'Lyrics',
          instrumentId: 'textDisplay',
          color: '#22d3ee',
          params: {
            fontSize: 1.1,
            onsetBounce: 0.08,
            strokeWidth: 0.06,
            rainbowEnabled: 1,
            rainbowCycleLength: 12,
            delayTaps: 3,
            delayTime: 0.25,
            delayOpacityFalloff: 0.3,
            pingPongEnabled: 1,
            pingPongWidth: 0.35,
          },
          stringParams: { text: words.text },
          blocks: [block(0, BARS, words.notes)],
        }),
      ],
    }),
  },
  {
    id: 'lyricFlight',
    name: 'Lyric Video - Flight',
    description: 'Every word launches past the camera and tumbles into depth. Transcribe your song to fly the real lyrics.',
    bpm: 120,
    cardPreview: 'animatedLyric',
    document: doc({
      bpm: 120,
      totalBars: BARS,
      tracks: [
        track({
          name: 'Lyrics',
          instrumentId: 'textDisplay',
          color: '#a78bfa',
          params: {
            fontSize: 1,
            flightEnabled: 1,
            flightSpeed: 18,
            flightMaxDepth: 60,
            flightDrift: 0.5,
            flightTumble: 0.8,
            flightSubdivRate: 8,
            releaseDuration: 0.5,
          },
          stringParams: { text: words.text },
          blocks: [block(0, BARS, words.notes)],
        }),
      ],
    }),
  },
  {
    id: 'lyricRise',
    name: 'Lyric Video - Rise',
    description: 'Lines trade places on the screen, low then lifted, with a springy bounce. Transcribe to use your own words.',
    bpm: 120,
    cardPreview: 'animatedLyric',
    document: doc({
      bpm: 120,
      totalBars: BARS,
      tracks: [
        track({
          name: 'Lyrics',
          instrumentId: 'textDisplay',
          color: '#f472b6',
          params: { fontSize: 1.05, onsetBounce: 0.16, heightAmount: 0.6, releaseDuration: 0.5, strokeWidth: 0.03 },
          stringParams: { text: words.text, color: '#fbcfe8' },
          blocks: [block(0, BARS, [...words.notes, ...lineHeights, ...pops])],
        }),
      ],
    }),
  },
]

import { doc, track, block, n, every, pulse } from './builder'
import type { TemplateDef } from './library'
import type { Note, Track } from '../editor/types'
import { LYRIC_TEMPLATE_TRACKS } from './library-lyrics-tracks'

// The lyric-video templates. All of them ship a styled Text Display track named
// 'Lyrics' carrying placeholder words, ready for the real flow: create the
// project, drop in a song (BPM + downbeat auto-match), transcribe, then pick a
// look. Transcription REPLACES that track's words while keeping its styling
// (addLyricTrack refills a root track named 'Lyrics' instead of stacking a
// second one), and switching between these styles carries the transcribed
// words across (applyTemplate's lyric carry-over).
//
// 'Lyric Video' is deliberately BARE: white words on black and nothing else.
// It is the honest starting point and the thing the gallery advertises; the
// decorated looks (Dark Red here, Silent Film next door) are styles chosen
// once there is a song to hear them against.

export const NEXT_WORD = 48 // Text Display's "advance to the next word" pitch
export const BASS_POP = 47 // punch + shake accent

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

/** The placeholder words + word-advance notes shared by every lyric template.
 *  Fresh note ids per call, so each template document owns its notes. */
export function lyricPattern(): { text: string; notes: Note[] } {
  const pattern = LINES.map(([, beat, dur]) => n(beat, NEXT_WORD, dur ?? 0.9))
  return {
    text: LINES.map(([word]) => word).join(' '),
    notes: every(PHRASE, BEATS, pattern),
  }
}

// The burst family's authored pattern covers 16 bars, but a real song grows
// the project far past that (transcription extends totalBars to fit the
// words) - so each of those tracks collapses to ONE long looping block: the
// authored pattern repeating until the last bar, wherever that ends up.
// 512 = the project-length ceiling (MAX_TOTAL_BARS); blocks past the visible
// end are tolerated, the timeline just ends sooner.
const REPEAT_UNTIL_BARS = 512

function repeatBlocksToEnd(t: Track): Track {
  if (t.blocks.length === 0) return t
  const beatsPerBar = 4
  const start = Math.min(...t.blocks.map((b) => b.startBar))
  // Already a single looping block (Visibility): keep its pattern window,
  // just stretch the block to the ceiling.
  if (t.blocks.length === 1 && t.blocks[0].loop) {
    return { ...t, blocks: [{ ...t.blocks[0], durationBars: REPEAT_UNTIL_BARS - start }] }
  }
  // Several written-out blocks (Particle Burst, Burst): merge them into one
  // block whose pattern window is their combined span, looping to the ceiling.
  const end = Math.max(...t.blocks.map((b) => b.startBar + b.durationBars))
  const notes = t.blocks.flatMap((b) =>
    b.notes.map((n) => ({ ...n, startBeat: n.startBeat + (b.startBar - start) * beatsPerBar })),
  )
  return {
    ...t,
    blocks: [{
      id: t.blocks[0].id,
      startBar: start,
      durationBars: REPEAT_UNTIL_BARS - start,
      loop: true,
      loopLengthBars: end - start,
      notes,
    }],
  }
}

// ------------------------------------------------------------------ Bare bones
// Nothing but the words: white, centred, popping on the beat, over black.
function bareBonesDocument() {
  const words = lyricPattern()
  return doc({
    bpm: 120,
    totalBars: BARS,
    tracks: [
      track({
        name: 'Lyrics',
        instrumentId: 'textDisplay',
        color: '#e4e4e7',
        params: {
          font: 0, // Impact / Arial Black - the classic lyric-video face
          fontSize: 0.7,
          opacity: 1,
          colorMode: 0,
          strokeWidth: 0,
          onsetBounce: 0.08,
          releaseDuration: 0.4,
          rainbowEnabled: 0,
        },
        stringParams: { text: words.text, color: '#ffffff' },
        blocks: [block(0, BARS, words.notes)],
      }),
    ],
  })
}

// -------------------------------------------------------------------- Dark red
// Julia's hand-tuned stack: the Lyrics track's hue shift lands the teal base
// colour in deep red, over an Oscilloscope and the Particle Burst family.
function darkRedDocument() {
  const words = lyricPattern()
  // One phrase-start punch per 4-bar boundary.
  const pops = pulse(BASS_POP, PHRASE, BEATS, { dur: 0.5 })
  const document = doc({
    bpm: 120,
    totalBars: BARS,
    tracks: [
      // Settings extracted VERBATIM from Julia's project 2a617703… ("Save your
      // tears lyric video") Lyrics track - only the words are placeholder
      // (transcription replaces them, keeping this styling).
      track({
        name: 'Lyrics',
        instrumentId: 'textDisplay',
        color: '#e4e4e7',
        params: {
          hue: 0.49,
          font: 2,
          // The source project had opacity 0.05 - an experiment leftover that
          // made template lyrics invisible. Full opacity here; the rest of
          // the extracted styling stands.
          opacity: 1,
          fontSize: 0.5,
          colorMode: 0,
          onsetBounce: 0,
          strokeWidth: 0,
          rainbowEnabled: 0,
          releaseDuration: 0.4,
          rainbowCycleLength: 64,
        },
        stringParams: { text: words.text, color: '#54b9bb', strokeColor: '#5c197b' },
        blocks: [block(0, BARS, [...words.notes, ...pops])],
      }),
    ],
  })
  const sceneId = document.sceneOrder.find((id) => !document.scenes[id]?.isMain)!
  const scene = document.scenes[sceneId]
  // The Particle Burst family (the instrument + its mover children) repeats
  // its pattern to the last bar; the Oscilloscope (blockless) rides as-is.
  const burst = LYRIC_TEMPLATE_TRACKS.find((t) => t.instrumentId === 'particleBurst')
  const burstFamily = new Set(burst ? [burst.id, ...burst.childIds] : [])
  for (const t of LYRIC_TEMPLATE_TRACKS) {
    const placed = burstFamily.has(t.id) ? repeatBlocksToEnd(t) : t
    scene.tracks[placed.id] = placed
    if (!placed.parentId) scene.rootTrackIds.push(placed.id)
  }
  return document
}

export const LYRIC_TEMPLATES: TemplateDef[] = [
  {
    id: 'lyricVideo',
    name: 'Lyric Video',
    styleName: 'Minimal',
    description: 'Just the words - big, white, landing on the beat. Add your song and they write themselves.',
    bpm: 120,
    cardPreview: 'animatedLyric',
    lyricFlow: true,
    document: bareBonesDocument(),
  },
  {
    id: 'darkRed',
    name: 'Dark Red',
    styleName: 'Dark Red',
    description: 'Deep red words over a live waveform and particle bursts.',
    bpm: 120,
    cardPreview: 'animatedLyric',
    lyricFlow: true,
    hiddenFromGallery: true,
    document: darkRedDocument(),
  },
]

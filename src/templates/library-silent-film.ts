import { doc, track, block, n, pulse } from './builder'
import type { TemplateDef } from './library'
import type { Block, Note } from '../editor/types'
import { lyricPattern, BASS_POP } from './library-lyrics'

// The Silent Film lyric template (docs/lyric-template-silent-film.md): words
// as degraded silent-movie title cards. Film Stock + Film Grain sandwich the
// frame (background / on-top wear), the Lyrics track scatters IM Fell caps
// with a projected-light glow, Scribble punctuates phrases in the cyan accent,
// and a paper intro card opens the reel. Same refill contract as every lyric
// template: the root track named 'Lyrics' keeps its styling when transcription
// replaces its words.

const BARS = 16 // placeholder song length; transcription extends totalBars

// Ambience must cover the whole eventual song, wherever transcription ends it:
// one LOOP block per ambient track stretched to the ceiling (512 =
// MAX_TOTAL_BARS; blocks past the visible end are tolerated). Loop blocks -
// not written-out patterns - because both transcription and a lyric-template
// switch trim `loop` blocks to the song's end.
const CEILING_BARS = 512

/** A ceiling-length loop block: `notes` written inside a `loopBars` window. */
function loopBlock(loopBars: number, notes: Note[]): Block {
  return { ...block(0, CEILING_BARS, notes), loop: true, loopLengthBars: loopBars }
}

const words = lyricPattern()

function silentFilmDocument() {
  return doc({
    bpm: 120,
    totalBars: BARS,
    tracks: [
      track({
        name: 'Lyrics',
        instrumentId: 'textDisplay',
        color: '#e8e4da',
        params: {
          font: 4, // Old Press Caps (IM Fell SC)
          layoutMode: 1, // Scatter
          phraseGap: 2,
          scatterSpread: 0.6,
          glow: 0.6,
          jitter: 0.5,
          // Scatter words render at 55% of Center-mode scale (they share the
          // frame), so full fontSize here lands them at reference size.
          fontSize: 1,
          opacity: 1,
          colorMode: 0,
          strokeWidth: 0,
          onsetBounce: 0.1,
          releaseDuration: 0.5,
        },
        stringParams: { text: words.text, color: '#fdfbfe' },
        blocks: [block(0, BARS, [
          ...words.notes,
          ...pulse(BASS_POP, 16, BARS * 4, { dur: 0.5 }),
        ])],
      }),
      track({
        name: 'Scribbles',
        instrumentId: 'scribble',
        color: '#87dcfb',
        params: { size: 0.55, glow: 0.7, wobble: 0.5, lineWidth: 0.8 },
        stringParams: { color: '#87dcfb' },
        // 32-bar loop: swooshes each half, a loop and a flourish per cycle.
        blocks: [loopBlock(32, [
          n(28, 60, 1.5, 90), // underline swoosh
          n(92, 60, 1.5, 90), // underline swoosh
          n(60, 62, 1.5, 90), // lasso loop
          n(124, 64, 1.5, 100), // S flourish
        ])],
      }),
      // No title card. It used to open the video at bars 0-2, which was wrong
      // twice over: every exported video began with the placeholder words
      // "ARTIST NAME", and the gallery clip (bars 1-4) was half title card
      // instead of the style it is selling. Add the Film Card instrument for an
      // intro (bar 0) or a closing title (last bar, Card = Title Outro).
      track({
        name: 'Film Grain',
        instrumentId: 'filmGrain',
        color: '#8a8590',
        // Warp matches Film Stock's so the two bowed frame edges coincide.
        params: { grain: 0.35, dust: 0.3, flicker: 0.35, vignette: 0.55, warp: 0.2 },
        // 16-bar loop: a dust burst every 4 bars, one flicker pop per cycle.
        blocks: [loopBlock(16, [
          ...pulse(60, 16, 64, { dur: 0.25, vel: 55, offset: 8 }), // dust bursts
          n(48, 62, 0.25, 70), // flicker pop
        ])],
      }),
      track({
        name: 'Film Stock',
        instrumentId: 'filmStock',
        color: '#3d3742',
        params: { grain: 0.55, dust: 0.5, scratch: 0.5, grid: 0.25, flicker: 0.35, vignette: 0.65, warp: 0.2 },
        // 16-bar loop: burn flashes each half, one scratch streak per cycle.
        blocks: [loopBlock(16, [
          ...pulse(60, 32, 64, { dur: 0.5, vel: 70 }), // burn flashes
          n(24, 64, 0.5, 80), // scratch streak
        ])],
      }),
    ],
  })
}

// The id stays 'silentFilm' on purpose: it is written into every project that
// has ever used this style (appliedTemplateId) and is the key the preview-card
// palette and the preview clip in the storage bucket are filed under. Renaming
// it would orphan all three. Only the label the user reads changes.
export const silentFilm: TemplateDef = {
  id: 'silentFilm',
  name: 'Vintage',
  styleName: 'Vintage',
  description: 'Words as degraded silent-movie title cards - grainy stock, vintage serif, glowing accents.',
  bpm: 120,
  cardPreview: 'animatedLyric',
  lyricFlow: true,
  hiddenFromGallery: true,
  document: silentFilmDocument(),
}

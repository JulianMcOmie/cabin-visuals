import { doc, track, block, n, fx, pulse } from './builder'
import type { TemplateDef } from './library'
import type { Block, Note } from '../editor/types'
import { lyricPattern } from './library-lyrics'

// The Monochrome lyric style: stark black-and-white Didone words that snap in
// dead-center while the whole frame strobes between polarities. Deconstructed
// frame-by-frame from a reference Instagram lyric edit (makidacusinn, "why we
// dont" - 18s scanned at 4fps plus whisper word timing):
//
//   - Black frame, huge white high-contrast serif word dead center (Didone -
//     hairline serifs, thick stems; Playfair Display is the library's face).
//     Words are ALL CAPS with their punctuation kept ("FOOLIN'?", "BRO").
//   - The signature: the ENTIRE frame flips to white-with-black-text on
//     certain words/phrases and back - a per-phrase polarity strobe, not a
//     text color change. Some flips hold ~2 beats (phrase cards like "WHO YOU
//     FOOLIN'?"), some are single-word flashes ("CALL", "UP").
//   - Words SNAP: no fade-in, a hard cut onto the beat, quick release. A hint
//     of onset pop. No stroke, no glow halo, no shadow.
//   - Faint film dust and streaks live on the black frames (visible as gray
//     specks / horizontal scratches around 3.5s and 13s); the black is never
//     perfectly clean.
//   - The mid-song verse ("Shawty actin'...") shows NO text at all - the edit
//     breathes. That is per-song authoring, not style: after transcription,
//     delete the word notes across a verse to reproduce it.
//
// How the strobe is built: the Lyrics track renders in Invert Behind mode,
// and a Color Filters track ('Invert Strobe') holds INVERT notes. While
// invert holds, the black scene renders white and the inverted text renders
// black over it - both polarities from one text track, exactly like the
// reference. The strobe FOLLOWS THE WORDS: transcription rebuilds its notes
// from the sung phrases (invertStrobeSpans - alternating polarity per phrase,
// long phrases flipping at their midpoint), so the frame never strobes while
// nothing is being sung - measured off the reference, whose 8.2s-13.6s verse
// shows zero visual events.
//
// The full measured effect set (every-frame pass, 30fps):
//   - BOIL: the glyphs are re-inked every 2-3 frames (edges wobble and hold,
//     then re-roll) with a melt band sweeping down through the letters -
//     the `boil` shader effect on the Lyrics track.
//   - ZOOM FLASH: word transitions are punctuated by 1-frame inserts of the
//     text blown up ~6x (letterform fragments filling the frame) - Text
//     Display's pitch-46 row.
//   - STATIC: dense horizontal scratch-hatch bursts (2-4 frames of TV noise
//     over the whole frame, ~3.5s and ~13s in the reference) - Film Grain's
//     'static' + its pitch-56 burst row.
//
// One measured compromise: the reference sets its multi-word CARDS in a
// curlier old-print face than its single words. One Lyrics track means one
// font - Playfair (the singles, most of the screen time) wins.

const BARS = 16 // placeholder song length; transcription extends totalBars
const CEILING_BARS = 512

/** A ceiling-length loop block: `notes` written inside a `loopBars` window. */
function loopBlock(loopBars: number, notes: Note[]): Block {
  return { ...block(0, CEILING_BARS, notes), loop: true, loopLengthBars: loopBars }
}

const words = lyricPattern()

const INVERT = 72 // Color Filters' Invert row

function monochromeDocument() {
  return doc({
    bpm: 120,
    totalBars: BARS,
    tracks: [
      track({
        name: 'Lyrics',
        instrumentId: 'textDisplay',
        color: '#e4e4e7',
        params: {
          font: 6, // Didone (Playfair) - the reference's high-contrast serif
          fontSize: 1.15, // singles run huge, near the frame's width
          colorMode: 1, // Invert Behind: white on black, black on the strobe
          strokeWidth: 0,
          shadow: 0,
          glow: 0,
          opacity: 1,
          // Snap, don't fade: hard cut in on the word's beat, fast release.
          onsetBounce: 0.05,
          releaseDuration: 0.15,
          // Dead center - the reference never moves or scatters its words.
          posY: 0,
        },
        stringParams: {
          text: words.text,
          // Unused while Invert Behind is on; staged so switching to Custom
          // lands on the reference's white.
          color: '#ffffff',
          strokeColor: '#000000',
        },
        // The boil: glyph edges re-inked every few frames plus a melt band
        // sweeping down through the letters - the reference's words are never
        // still. Measured off consecutive frames (the distortion holds 2-3
        // frames, then re-rolls; the band descends over roughly a second).
        effects: [fx('boil', { amount: 0.55, speed: 6, melt: 0.5, meltRate: 0.25 })],
        blocks: [block(0, BARS, [
          ...words.notes,
          // Zoom flashes: 1-frame giant-letterform inserts on the line
          // boundaries - the reference punctuates its word transitions (and
          // polarity flips) with them.
          ...pulse(46, 8, BARS * 4, { dur: 0.1, offset: 8 }),
        ])],
      }),
      // The polarity strobe. Full-velocity invert notes flip the whole frame
      // (scene, grain, and - via Invert Behind - the text) to white/black.
      //
      // The strobe follows the WORDS, never the clock: here it alternates per
      // placeholder line (second line of each 16-beat window inverted), and on
      // transcription addLyricTrack/applyTemplate REBUILD these notes from the
      // real word times (invertStrobeSpans) - so the frame flips per sung
      // phrase and stays black through instrumentals.
      track({
        name: 'Invert Strobe',
        instrumentId: 'colorFilters',
        color: '#ffffff',
        params: { amount: 1 },
        blocks: [block(0, BARS, pulse(INVERT, 16, BARS * 4, { dur: 8, offset: 8, vel: 127 }))],
      }),
      // The black is never clean: faint specks plus the reference's STATIC -
      // dense horizontal scratch-hatch bursts (2-4 frames of TV noise) on
      // accents. Flat digital frame: warp 0, vignette low, so it reads as
      // texture rather than Silent Film.
      track({
        name: 'Film Grain',
        instrumentId: 'filmGrain',
        color: '#8a8590',
        params: { grain: 0.2, dust: 0.15, static: 0, flicker: 0.12, vignette: 0.3, warp: 0 },
        // Two static bursts and a flicker pop per 16-bar cycle, on beats where
        // the placeholder holds a word (the reference's bursts land on held
        // words, not in silence).
        blocks: [loopBlock(16, [
          n(12, 56, 0.6, 100), // static burst - held word
          n(44, 56, 0.4, 80), // static burst
          n(8, 60, 0.25, 50), // dust burst
          n(56, 62, 0.25, 60), // flicker pop
        ])],
      }),
    ],
  })
}

export const monochrome: TemplateDef = {
  id: 'monochrome',
  name: 'Monochrome',
  styleName: 'Monochrome',
  description: 'Huge black-and-white serif words snapping dead center while the whole frame strobes between polarities.',
  bpm: 120,
  cardPreview: 'animatedLyric',
  lyricFlow: true,
  hiddenFromGallery: true,
  document: monochromeDocument(),
}

import { doc, track, block, n, fx, fxTarget } from './builder'
import type { TemplateDef } from './library'
import type { Block, Note } from '../editor/types'
import { invertStrobeSpans, stackCardStarts } from '../editor/utils/lyricPlacement'
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
// reference. The strobe FOLLOWS THE WORDS, one flip per word: the measured
// rule is a strict toggle on EVERY word onset ("WHO" white → "+YOU" black →
// "+FOOLIN'?" white), which invertStrobeSpans encodes and transcription
// rebuilds from real word times - so the frame flips word by word and never
// strobes while nothing is being sung (the reference's 8.2s-13.6s verse
// shows zero visual events).
//
// The full measured effect set (every-frame pass, 30fps):
//   - STACK CARDS: words ACCUMULATE within a phrase into centered stacked
//     lines ("WHO" → "WHO YOU" → "WHO YOU / FOOLIN'?"), clearing at phrase
//     gaps - Text Display's Stack layout, built for this template.
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
//
// Latest sync: "monochrome reference" (316a7f6d-43cc-432d-adfc-886153c77ebd,
// 111.57bpm, 9:16) - Julia's hand-tune on top of the measured rebuild:
// 3-word cards on a tighter 1.5-beat phrase cut, words SUSTAIN until replaced,
// a slower/heavier boil (0.27-beat holds, full-strength line taking 5 beats
// per sweep), and a much livelier black - dust 0.75 with coarse grain 4.
// Where her values disagree with the measurements, hers win.

const BARS = 16 // placeholder song length; transcription extends totalBars
const CEILING_BARS = 512

/** A ceiling-length loop block: `notes` written inside a `loopBars` window. */
function loopBlock(loopBars: number, notes: Note[]): Block {
  return { ...block(0, CEILING_BARS, notes), loop: true, loopLengthBars: loopBars }
}

const words = lyricPattern()

const INVERT = 72 // Color Filters' Invert row

// The boil instance is held in a variable so the Line Sweeps envelope lane
// below can address its linePhase setting (fxTarget needs the instance id).
const boilFx = fx('boil', { wobble: 0.65, wobbleHold: 0.27, line: 1, linePhase: 0 })

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
          // STACK: the phrase accumulates into centered stacked lines ("WHO" →
          // "WHO YOU" → "WHO YOU / FOOLIN'?"), clearing at phrase gaps - the
          // reference's multi-word cards, measured frame by frame.
          layoutMode: 2,
          phraseGap: 1.5,
          stackMaxWords: 3,
          fontSize: 1.2, // BIG - a single word spans near half the frame
          // Words never fade on their own - each holds until the next lands.
          sustain: 1,
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
        // The boil, at Julia's tune: a gentler wobble holding each distortion
        // longer (0.27 beats), line at FULL strength. The line's MOTION is not
        // here - it is an EVENT, fired by the Line Sweeps envelope lane below.
        effects: [boilFx],
        blocks: [block(0, BARS, [
          ...words.notes,
          // Zoom flashes: 1-frame giant-letterform inserts (~6x) exactly ON
          // the card boundaries - the same stackCardStarts rule the refill
          // re-derives from real words after transcription, so demo and song
          // behave identically.
          ...stackCardStarts(
            words.notes.map((note) => ({ startBeat: note.startBeat, durationBeats: note.durationBeats })),
            1.5, // phraseGap, matching the params above
            3, // stackMaxWords
          ).map((beat) => n(beat, 46, 0.1)),
        ])],
        children: [
          // THE LINE IS MIDI. Each gate note here fires ONE top-to-bottom
          // sweep of the boil's traveling line: the envelope's attack (5
          // beats, Julia's tuned travel time) ramps linePhase 0→1 across the
          // note, the near-zero release parks the line off-frame the instant
          // the note ends, and velocity scales how deep the sweep cuts. Move,
          // add, or delete notes to place sweeps on the song - nothing here
          // is periodic except this placeholder's loop.
          track({
            name: 'Line Sweeps',
            instrumentId: '',
            type: 'envelope',
            color: '#e4e4e7',
            targetParam: fxTarget(boilFx, 'linePhase'),
            adsr: { attackBeats: 5, decayBeats: 0.01, sustainLevel: 1, releaseBeats: 0.01 },
            envDepth: 1,
            envTarget: 1,
            blocks: [loopBlock(2, [n(2, 60, 5, 127)])],
          }),
        ],
      }),
      // The polarity strobe. Full-velocity invert notes flip the whole frame
      // (scene, grain, and - via Invert Behind - the text) to white/black.
      //
      // Measured rule: the frame flips on EVERY word onset. The placeholder's
      // strobe is generated from the placeholder words by the same helper
      // (invertStrobeSpans) transcription uses to REBUILD it from real word
      // times - so the demo, and every song after it, flips word by word and
      // sits black through instrumentals.
      track({
        name: 'Invert Strobe',
        instrumentId: 'colorFilters',
        color: '#ffffff',
        params: { amount: 1 },
        blocks: [block(0, BARS, invertStrobeSpans(
          words.notes.map((note) => ({ startBeat: note.startBeat, durationBeats: note.durationBeats })),
        ).map((span) => n(span.startBeat, INVERT, span.durationBeats, span.velocity)))],
      }),
      // MEASURED, not assumed: the reference's black frames are DEAD steady -
      // per-frame luminance sits at 19.6 ± 0.1 through the whole verse, so
      // constant flicker/crawl here is near zero and the frame only ever
      // moves when something is authored: static bursts (the smeared TV-snow
      // scribble, ~2-4 frames on accents) and the strobe itself, whose white
      // holds dim to ~85% for their last two frames (encoded in the strobe
      // notes' velocities, not here).
      track({
        name: 'Film Grain',
        instrumentId: 'filmGrain',
        color: '#8a8590',
        // Julia's tune runs the black much livelier than the measured
        // reference: heavy dust, coarse grain, a touch of flicker.
        params: {
          grain: 0.3, grainSize: 4, dust: 0.75, flicker: 0.15, vignette: 0.1, warp: 0,
          static: 0, staticSize: 1.1, staticStreak: 0.7,
        },
        // Static bursts on held-word beats; a rare dust speck between.
        blocks: [loopBlock(16, [
          n(12, 56, 0.6, 110), // static burst - held word
          n(28, 56, 0.4, 90), // static burst
          n(44, 56, 0.5, 100), // static burst
          n(8, 60, 0.25, 40), // dust speck
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

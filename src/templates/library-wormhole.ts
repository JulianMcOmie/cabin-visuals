import { doc, track, block, n } from './builder'
import type { TemplateDef } from './library'
import type { Block, Note } from '../editor/types'
import { lyricPattern } from './library-lyrics'

// The Wormhole style: words riding a point tunnel that lurches on every beat.
//
// Every value here is copied verbatim from one of Julia's real projects, tuned
// by hand against an actual song. Only the words are placeholder, since
// transcription replaces them while keeping this styling.
//
// Latest sync: "wormhole template glow" (3d2f2e16-ce7b-4e74-9bf4-18ee298cf6cf,
// Tame Impala at 98bpm) - the pass that switched the words to PARTICLE MODE:
// each word is a cloud of dots that morphs into the next across the whole gap
// between word notes (Fill Gap on). This re-sync picked up Julia's retune on
// top of the brightness-normalized glow: Invert Behind (white dots), the full
// 8000 particles at a finer dot size, glow at the slider's top, and full
// morph stagger. Earlier syncs came from "wormhole template reference" (Save
// Your Tears at 118bpm), where the tunnel settings were dialled in - those
// carried across unchanged.
//
// The reference project also opens with a "-" lead-in word noted at beat 0,
// so the cloud idles as a dash and streams into the first sung word instead
// of holding the sphere through the intro. That is NOT baked into this
// document (the placeholder pattern already starts at beat 0, which is the
// rule's "already a note at the very start" case) - transcription adds it to
// particle-words tracks whose first sung word starts late (see addLyricTrack
// in ProjectStore).
//
// Brightness, Warp Scale and Ring Detail are all pinned to their maximum: a
// blown-out, heavily warped tube at the densest lattice the instrument offers.
// Ring Detail 192 is the expensive one (~74k points per tube, both tubes sharing
// the one geometry); it is what makes the walls read as solid rather than
// speckled, so drop it before dropping anything else if this needs to get cheaper.
//
// Flight Speed is 76, re-tuned against the raised 200 ceiling (it sat at the old
// maximum of 40 until then) - so this one IS a considered value now, not a slider
// that ran out of room.
//
// The other mid-range values carry the look: Tunnel Width 7.8 (near the top of
// 0.5-8) puts the camera well inside a wide tube rather than threading a pipe, and
// View Distance 67 of a possible 250 keeps the far end fading out, so the motion
// reads as speed instead of a static starfield.
//
// NOT captured here: the reference project's canvas aspect, whatever it happens
// to be on (it has moved between 9:16 and fill across re-syncs). doc() CAN
// carry viewAspect now (creation-only; see builder.ts), but this style
// deliberately doesn't declare one - applying a style never reshapes the
// project's canvas, and neither should starting from it until the reference
// settles on an aspect. See the note at the bottom of this file.

const BARS = 16
// 512 = MAX_TOTAL_BARS, the project-length ceiling. The block is authored to it
// and trimmed back to the song's end on apply (see songEndBars) - the template
// cannot know how long the song is, so it claims the ceiling and gets cut down.
const CEILING_BARS = 512

/** A ceiling-length loop block whose pattern window is `loopBars`. */
function loopBlock(loopBars: number, notes: Note[]): Block {
  return { ...block(0, CEILING_BARS, notes), loop: true, loopLengthBars: loopBars }
}

// Julia's pattern: one bar, four on the floor, alternating the top row of the
// pulse ladder with the middle. Row 8 (67) is the full-force hit and row 5 (64)
// is roughly a third of it, so the tunnel reads as strong/weak/strong/weak
// rather than a flat metronome. Short notes - only the onset matters, the
// envelope owns everything after it.
const PULSE_PATTERN: Note[] = [
  n(0, 67, 0.25, 100),
  n(1, 64, 0.25, 100),
  n(2, 67, 0.25, 100),
  n(3, 64, 0.25, 100),
]

function wormholeDocument() {
  const words = lyricPattern()
  return doc({
    bpm: 120,
    totalBars: BARS,
    tracks: [
      // Rainbow-cycled PARTICLE words: each word is a cloud of dots in Bebas
      // Neue that streams into the next word across the whole gap between
      // word notes. The flight-mode params from the earlier plane-based look
      // are carried (they come back if Particle Words is toggled off) but sit
      // dormant while particle mode owns the words.
      track({
        name: 'Lyrics',
        instrumentId: 'textDisplay',
        color: '#e4e4e7',
        params: {
          font: 7, // Poster (Bebas Neue)
          fontSize: 0.9,
          // Size latches per word, like placement does - a word that is still
          // fading keeps the size it was born at while the next one is placed
          // at a different one. Required for the Font Size lane below to read
          // as varied word sizes rather than everything on screen pulsing.
          sizeMode: 1,
          opacity: 1,
          // Invert Behind: in particle mode this renders the dots plain WHITE -
          // the invert blending trick is canvas-plane-only - which is the look
          // this sync chose: white sparks over the green tunnel. Rainbow + hue
          // below sit dormant while this is on; toggling back to Custom lands
          // on the rainbow cycle the earlier syncs used.
          colorMode: 1,
          glow: 0,
          // Hue Shift rotates whatever colour is about to draw. Rainbow is on
          // below, so this offsets the whole cycle by ~245 degrees rather than
          // tinting one fixed colour - it moves where the cycle starts, which is
          // what changes the mood of a run of words.
          hue: 0.68,
          glowContained: 1,
          strokeWidth: 0.2,
          onsetBounce: 0.09,
          releaseDuration: 0.5,
          rainbowEnabled: 1,
          rainbowCycleLength: 64,
          flightEnabled: 1,
          flightSpeed: 60,
          flightTumble: 2.2,
          flightSubdivRate: 2,
          // --- Particle words, the pass this sync exists for ---
          particleEnabled: 1,
          // The full buffer at a fine dot: dense, sharp glyphs. Brightness is
          // area-normalized per word, so the count sets granularity, not glow.
          particleCount: 30000,
          particleSize: 0.015,
          // Top of the quartic slider. Survivable because the dots are white
          // (luma 1, no luminance boost) and stacking is normalized per word -
          // this reads as hot sparks, not a blown-out core.
          particleGlow: 1,
          particleOpaque: 0,
          // Every morph spans the full distance between its two word notes -
          // the cloud is always in motion at the lyric's own pace. Morph beats
          // then only governs the opening sphere → first-word morph.
          particleFillGap: 1,
          particleMorphBeats: 0.3,
          // Full stagger: dots leave one by one, so mid-morph the word smears
          // into a comet trail before snapping together on the beat.
          particleStagger: 1,
          particleVariation: 0.3,
        },
        stringParams: {
          text: words.text,
          // Only shows if Rainbow is switched off - the cycle overrides it while
          // it's on. Carried anyway so turning rainbow off lands on Julia's red
          // rather than a default white.
          color: '#ff0000',
          strokeColor: '#000000',
        },
        // No offset effect: the reference dropped the -0.1 y nudge that used to
        // lift the words off centre. The placement lanes below do all the
        // positioning now.
        blocks: [block(0, BARS, words.notes)],
        // The placement lanes. STEP interpolation, not linear: each word should
        // snap to its spot and stay there, and the instrument's per-word latching
        // (posMode 1, the default) is what holds a fading word in place while the
        // next one is placed somewhere else. Ramping between them instead would
        // slide every word across the frame, which is the thing that behaviour
        // exists to prevent.
        //
        // Placement steps every 4 beats - a new spot each bar, twice the rate of
        // the size lane below, so a run of words moves around the frame more
        // often than it changes size. Pitches read through the automation scale
        // (36-84 spanning the param's -1..1), so 56-64 around a 60 centre is
        // ±0.17 of a half-frame: nudges that keep words off dead centre without
        // throwing them at the edges.
        children: [
          track({
            name: 'Position X',
            instrumentId: '',
            type: 'automation',
            color: '#e4e4e7',
            targetParam: 'posX',
            interpolation: 'step',
            blocks: [loopBlock(16, [
              n(0, 60, 4, 100), n(4, 56, 4, 100), n(8, 64, 4, 100), n(12, 60, 4, 100),
              n(16, 56, 4, 100), n(20, 60, 4, 100), n(24, 64, 4, 100), n(28, 60, 4, 100),
              n(32, 60, 4, 100), n(36, 64, 4, 100), n(40, 56, 4, 100), n(44, 64, 4, 100),
              n(48, 56, 4, 100), n(52, 64, 4, 100), n(56, 60, 4, 100), n(60, 64, 4, 100),
            ])],
          }),
          track({
            name: 'Position Y',
            instrumentId: '',
            type: 'automation',
            color: '#e4e4e7',
            targetParam: 'posY',
            interpolation: 'step',
            blocks: [loopBlock(16, [
              n(0, 60, 4, 100), n(4, 56, 4, 100), n(8, 64, 4, 100), n(12, 60, 4, 100),
              n(16, 56, 4, 100), n(20, 60, 4, 100), n(24, 64, 4, 100), n(28, 60, 4, 100),
              n(32, 60, 4, 100), n(36, 64, 4, 100), n(40, 56, 4, 100), n(44, 60, 4, 100),
              n(48, 56, 4, 100), n(52, 60, 4, 100), n(56, 64, 4, 100), n(60, 60, 4, 100),
            ])],
          }),
          // Size steps every 8 beats, on the same grid as placement rather than
          // offset off it - so when the size does change, it changes on a beat a
          // word is also being re-placed on. Step for the same reason as the
          // lanes above: sizeMode latches each word at its onset, and ramping
          // would fight that.
          track({
            name: 'Font Size',
            instrumentId: '',
            type: 'automation',
            color: '#e4e4e7',
            targetParam: 'fontSize',
            interpolation: 'step',
            blocks: [loopBlock(16, [
              n(0, 44, 8, 100), n(8, 40, 8, 100), n(16, 44, 8, 100), n(24, 48, 8, 100),
              n(32, 44, 8, 100), n(40, 44, 8, 100), n(48, 44, 8, 100), n(56, 48, 8, 100),
            ])],
          }),
        ],
      }),
      track({
        name: 'Wormhole',
        instrumentId: 'wormhole',
        color: '#22d3ee',
        params: {
          speed: 76,
          radius: 7.8,
          brightness: 3,
          noiseScale: 0.5,
          ringDetail: 192,
          colorSpread: 1,
          viewDistance: 67,
        },
        // The tunnel's own colour, fixed while the words cycle through the
        // rainbow above it - that contrast is most of why the two read as
        // separate layers rather than one glowing mass.
        stringParams: { color: '#8df03d' },
        blocks: [loopBlock(1, PULSE_PATTERN)],
      }),
    ],
  })
}

// The canvas-aspect gap, half-closed on 2026-07-23: `doc()` now takes an
// optional viewAspect (Promo Cuts uses '9:16'), honoured only when a project
// is CREATED from the template - `applyTemplate` still never writes one, so
// picking a STYLE can never silently reshape the user's canvas. This template
// declares none: the reference has sat on both 9:16 and fill across re-syncs.
export const wormhole: TemplateDef = {
  id: 'wormhole',
  name: 'Wormhole',
  styleName: 'Wormhole',
  description: 'Words hurtling down an endless point tunnel that lurches on every beat.',
  bpm: 120,
  cardPreview: 'animatedLyric',
  lyricFlow: true,
  hiddenFromGallery: true,
  document: wormholeDocument(),
}

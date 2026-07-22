import { doc, track, block, n } from './builder'
import type { TemplateDef } from './library'
import type { Block, Note } from '../editor/types'
import { lyricPattern } from './library-lyrics'

// The Wormhole style: words riding a point tunnel that lurches on every beat.
//
// Every value here is copied verbatim from Julia's project "wormhole template
// reference" (561890ec-658f-498a-8c51-58e7bb93308f, Save Your Tears at 118bpm),
// tuned by hand against the real song. Only the words are placeholder, since
// transcription replaces them while keeping this styling.
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
// NOT captured here: the reference project is set to a 9:16 canvas. Templates
// have no way to carry viewAspect - doc() does not take one and applyTemplate
// does not set one - so applying this style leaves the project's aspect alone.
// See the note at the bottom of this file.

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
      // Rainbow-cycled Bebas Neue in FLIGHT mode - the words rush the camera and
      // tumble as they go, so they travel with the tunnel instead of hanging in
      // front of it. Condensed caps at full glow survive a wall running at
      // Brightness 3, and the black stroke stops them dissolving into the tunnel
      // wherever the two overlap.
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
          colorMode: 0,
          glow: 1,
          hue: 0,
          // Glow clipped at the stroke edge rather than bleeding past it -
          // without this the halo washes into the tunnel wall wherever the two
          // overlap, which is the thing the black stroke exists to prevent.
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
          // Backdrop is OFF (shape 0). The colour and opacity are carried anyway
          // so switching the shape on lands on Julia's staged cyan rather than a
          // default black slab.
          backdropShape: 0,
          backdropPad: 0,
          backdropOpacity: 0.5,
        },
        stringParams: {
          text: words.text,
          color: '#fe39a2',
          strokeColor: '#000000',
          backdropColor: '#02beed',
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
        // Pitches read through the automation scale (36-84 spanning the param's
        // -1..1), so 52-68 around a 60 centre is ±0.33 of a half-frame. The
        // reference widened these from the old 56-64 (±0.17) and lengthened the
        // cycle from 14 bars to 16 with eight placements instead of seven, so
        // the words wander further and the pattern lines up with the bar count.
        children: [
          track({
            name: 'Position X',
            instrumentId: '',
            type: 'automation',
            color: '#e4e4e7',
            targetParam: 'posX',
            interpolation: 'step',
            blocks: [loopBlock(16, [
              n(0, 60, 8, 100), n(8, 56, 8, 100), n(16, 64, 8, 100), n(24, 68, 8, 100),
              n(32, 56, 8, 100), n(40, 68, 8, 100), n(48, 64, 8, 100), n(56, 60, 8, 100),
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
              n(0, 60, 8, 100), n(8, 68, 8, 100), n(16, 64, 8, 100), n(24, 56, 8, 100),
              n(32, 60, 8, 100), n(40, 52, 8, 100), n(48, 56, 8, 100), n(56, 60, 8, 100),
            ])],
          }),
          // Word size on the same 16-bar cycle as placement, so a word's size and
          // its spot on the frame change together. Step for the same reason:
          // sizeMode above latches each word at its onset, and ramping would
          // fight that. The quarter-beat offsets are deliberate - the size step
          // lands just after the placement step rather than on top of it.
          track({
            name: 'Font Size',
            instrumentId: '',
            type: 'automation',
            color: '#e4e4e7',
            targetParam: 'fontSize',
            interpolation: 'step',
            blocks: [loopBlock(16, [
              n(0, 48, 8, 100), n(8.25, 52, 8, 100), n(16.25, 48, 8, 100), n(24.25, 40, 8, 100),
              n(32.25, 44, 8, 100), n(40.25, 40, 8, 100), n(48.25, 44, 8, 100), n(56.25, 48, 8, 100),
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
        blocks: [loopBlock(1, PULSE_PATTERN)],
        // Throws the tunnel around its own axes on a 4-bar cycle - two bursts on
        // one pitch then two on the next, so the lurch alternates direction
        // instead of repeating identically every bar like the pulse does.
        children: [
          track({
            name: 'Orbit Burst',
            instrumentId: '',
            type: 'mover',
            moverId: 'orbitBurst',
            color: '#6366f1',
            inputValues: {
              angle: 1.8,
              angleX: 16,
              angleY: 165,
              angleZ: 115,
              sharpness: 1.05,
              burstBeats: 2.5,
            },
            blocks: [loopBlock(4, [
              n(1, 64, 0.25, 100), n(3, 64, 0.25, 100), n(5, 64, 0.25, 100), n(7, 64, 0.25, 100),
              n(9, 65, 0.25, 100), n(11, 65, 0.25, 100), n(13, 65, 0.25, 100), n(15, 65, 0.25, 100),
            ])],
          }),
        ],
      }),
    ],
  })
}

// The 9:16 gap, deliberately left open. Julia's reference project is vertical, and
// this style was clearly composed for it - the offset effect lifting the words a
// tenth of a frame only really makes sense with the tunnel's vanishing point below
// them. But nothing in the template pipeline carries a canvas aspect: `doc()` emits
// no viewAspect and `applyTemplate` never writes one, so a style cannot change it.
//
// Wiring it up is small (one optional field, honoured only when a template declares
// it, so every existing template keeps today's behaviour) but the CONSEQUENCE is
// not: picking a style would silently reshape the user's canvas, which is a much
// louder side effect than swapping colours and fonts. Left for Julia to call.
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

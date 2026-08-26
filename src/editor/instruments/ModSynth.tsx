import type { ObjectInstrumentDef } from './types'
import { lazyInstrument } from './lazyInstrument'

// The Mod Synth def. Every note on the track SPAWNS a voice - a copy of the
// object - and the track's modulator rack (`track.synthMods`, edited in the
// bespoke panel) shapes each voice's flight: size, position, opacity, hue and
// spin, each on its own ADSR / bezier / hand-drawn curve. The rack is a Track
// field (videoPads' pattern), not params - it is variable-length structured
// data. The pure math lives in ./modSynthCore; the mesh pool in
// ./ModSynthVisual.

export const MOD_SYNTH_DEFAULT_COLOR = '#f5b455'

export const modSynthInstrument: ObjectInstrumentDef = {
  id: 'modSynth',
  name: 'Mod Synth',
  kind: 'object',
  userInterfaceRenderer: 'modSynth',
  params: [
    // The BASE size of a voice - the rack's SIZE modulator multiplies it.
    { key: 'size', label: 'Size', min: 0.1, max: 4, step: 0.05, default: 1 },
    { key: 'color', label: 'Color', type: 'color', default: MOD_SYNTH_DEFAULT_COLOR },
  ],
  // Full piano roll on purpose: pitch is the synth's keyboard (key tracking),
  // not a fixed row vocabulary.
  localTransform: ({ params }) => {
    const s = params.size ?? 1
    return { scale: [s, s, s] }
  },
  component: lazyInstrument(() => import('./ModSynthVisual').then((m) => m.ModSynthVisual)),
}

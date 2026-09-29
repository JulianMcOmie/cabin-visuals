import { defineInstrument } from '../../code'

// A shared MIDI lane: notes other instruments read by name with
// `ctx.lane('Kick')` - one lane, many instruments (cabin lanes --from-analysis
// writes Kick, Snare, Hat, Bass, Vocal, Other, Root, Chord into a "Lanes"
// scene that is never shown). It draws nothing itself.

export const instrument = defineInstrument({
  id: 'core.lane',
  name: 'MIDI Lane',
  description: 'A shared MIDI lane other code instruments read with ctx.lane(name). Draws nothing.',
  color: '#94a3b8',
  panel: false,
})

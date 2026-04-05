// Color Palette Instrument
// Acts as a child track of visual instruments to control color palettes via MIDI.

import { Instrument } from '../types';
import { DEFAULT_PALETTES, PALETTE_PITCH_MIN } from '@daw/core/colorPalette';

const rangeLabels = DEFAULT_PALETTES.map((palette, i) => ({
  startPitch: PALETTE_PITCH_MIN + i,
  endPitch: PALETTE_PITCH_MIN + i,
  label: palette.name,
}));

export const ColorPaletteInstrument: Instrument = {
  id: 'colorPalette',
  name: 'Color Palette',
  description: 'Controls color palettes for parent visual instruments via MIDI note selection',
  icon: '🎨',
  color: '#f59e0b',
  hasAudio: false,
  hasVisual: false,
  editorType: 'generic',

  noteRange: { min: PALETTE_PITCH_MIN, max: PALETTE_PITCH_MIN + DEFAULT_PALETTES.length - 1 },
  rangeLabels,

  defaultSettings: {
    palettes: DEFAULT_PALETTES,
    crossfadeDuration: 0,
  },

  settingsSchema: {
    crossfadeDuration: {
      type: 'number',
      label: 'Crossfade Duration (beats)',
      min: 0,
      max: 8,
      step: 0.25,
      default: 0,
    },
  },
};

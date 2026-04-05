import { Instrument } from '../types';

const MAX_STRIPS = 32;

const rangeLabels = Array.from({ length: MAX_STRIPS }, (_, i) => ({
  startPitch: i,
  endPitch: i,
  label: `Strip ${i + 1}`,
}));

export const StripMask: Instrument = {
  id: 'stripMask',
  name: 'Strip Mask',
  description: 'Divides the scene into strips, each toggled on/off by MIDI notes (pitch = strip index)',
  icon: '▥',
  color: '#f59e0b',
  hasAudio: false,
  hasVisual: false,
  editorType: 'generic',
  noteRange: { min: 0, max: 40 },
  rangeLabels,
  defaultSettings: {
    stripCount: 8,
    angle: 0,
    feather: 0.005,
    width: 1,
    height: 1,
    offsetX: 0,
    offsetY: 0,
  },
  settingsSchema: {
    stripCount: {
      type: 'number',
      label: 'Strip Count',
      min: 2,
      max: 32,
      step: 1,
      default: 8,
    },
    angle: {
      type: 'number',
      label: 'Angle',
      min: 0,
      max: 360,
      step: 1,
      default: 0,
    },
    feather: {
      type: 'number',
      label: 'Feather',
      min: 0,
      max: 0.1,
      step: 0.001,
      default: 0.005,
    },
    width: {
      type: 'number',
      label: 'Width',
      min: 0,
      max: 2,
      step: 0.01,
      default: 1,
    },
    height: {
      type: 'number',
      label: 'Height',
      min: 0,
      max: 2,
      step: 0.01,
      default: 1,
    },
    offsetX: {
      type: 'number',
      label: 'Offset X',
      min: -1,
      max: 1,
      step: 0.01,
      default: 0,
    },
    offsetY: {
      type: 'number',
      label: 'Offset Y',
      min: -1,
      max: 1,
      step: 0.01,
      default: 0,
    },
  },
};

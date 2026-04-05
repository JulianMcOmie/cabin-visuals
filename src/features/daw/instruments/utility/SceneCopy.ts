import { Instrument } from '../types';

const MAX_SCENE_SLOTS = 9; // 0 = Main, 1-8 = Scene 1-8

const rangeLabels = [
  { startPitch: 0, endPitch: 0, label: 'Main' },
  ...Array.from({ length: MAX_SCENE_SLOTS - 1 }, (_, i) => ({
    startPitch: i + 1,
    endPitch: i + 1,
    label: `Scene ${i + 1}`,
  })),
];

const DEFAULTS = {
  posX: 0,
  posY: 0,
  posZ: 8,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
  fov: 50,
};

export const SceneCopy: Instrument = {
  id: 'sceneCopy',
  name: 'Scene Copy',
  description: 'Renders a copy of another scene from a different camera angle. Use MIDI notes to select source scene (pitch 0 = Main, 1+ = Scene N).',
  icon: '📷',
  color: '#06b6d4',
  hasAudio: false,
  hasVisual: false,
  editorType: 'generic',
  noteRange: { min: 0, max: MAX_SCENE_SLOTS - 1 },
  rangeLabels,

  defaultSettings: { ...DEFAULTS },

  settingsSchema: {
    posX: { type: 'number', label: 'Position X', min: -50, max: 50, step: 0.5, default: DEFAULTS.posX },
    posY: { type: 'number', label: 'Position Y', min: -50, max: 50, step: 0.5, default: DEFAULTS.posY },
    posZ: { type: 'number', label: 'Position Z', min: -50, max: 50, step: 0.5, default: DEFAULTS.posZ },
    rotX: { type: 'number', label: 'Rotation X', min: -180, max: 180, step: 5, default: DEFAULTS.rotX },
    rotY: { type: 'number', label: 'Rotation Y', min: -180, max: 180, step: 5, default: DEFAULTS.rotY },
    rotZ: { type: 'number', label: 'Rotation Z', min: -180, max: 180, step: 5, default: DEFAULTS.rotZ },
    fov:  { type: 'number', label: 'Field of View', min: 10, max: 120, step: 5, default: DEFAULTS.fov },
  },
};

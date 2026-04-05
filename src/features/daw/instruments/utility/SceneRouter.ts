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

export const SceneRouter: Instrument = {
  id: 'sceneRouter',
  name: 'Scene Router',
  description: 'Routes the parent track to different scenes over time using MIDI notes (pitch 0 = Main, 1+ = Scene N)',
  icon: '🔀',
  color: '#7c3aed',
  hasAudio: false,
  hasVisual: false,
  editorType: 'generic',
  noteRange: { min: 0, max: MAX_SCENE_SLOTS - 1 },
  rangeLabels,
  defaultSettings: {},
};

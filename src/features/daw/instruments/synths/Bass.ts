import * as Tone from 'tone';
import { Instrument, AudioInstance } from '../types';
import { Event } from '@daw/core/types';

interface BassInstance extends AudioInstance {
  synth: Tone.MonoSynth;
}

export const Bass: Instrument = {
  id: 'bass',
  name: 'Bass',
  description: 'Punchy mono bass',
  color: '#f59e0b',
  hasAudio: true,
  hasVisual: false,
  editorType: 'chord',
  noteRange: { min: 24, max: 60 }, // C1–C4
  rangeLabels: [
    { startPitch: 24, endPitch: 28, label: 'Sub Bass' },
    { startPitch: 29, endPitch: 47, label: 'Bass' },
    { startPitch: 48, endPitch: 60, label: 'Upper' },
  ],

  defaultSettings: {
    attack: 0.01,
    decay: 0.3,
    sustain: 0.4,
    release: 0.01,
    filterBaseFrequency: 200,
    filterOctaves: 2.5,
    volume: -4,
  },

  settingsSchema: {
    attack: { type: 'number', label: 'Attack', min: 0.001, max: 1, step: 0.001, default: 0.01 },
    decay: { type: 'number', label: 'Decay', min: 0.01, max: 2, step: 0.01, default: 0.3 },
    sustain: { type: 'number', label: 'Sustain', min: 0, max: 1, step: 0.01, default: 0.4 },
    release: { type: 'number', label: 'Release', min: 0.001, max: 2, step: 0.01, default: 0.01 },
    filterBaseFrequency: { type: 'number', label: 'Filter Base', min: 50, max: 500, step: 10, default: 200 },
    volume: { type: 'number', label: 'Volume', min: -20, max: 0, step: 1, default: -4 },
  },

  createAudio: (settings): BassInstance => {
    const synth = new Tone.MonoSynth({
      oscillator: { type: 'square' },
      envelope: {
        attack: (settings.attack as number) ?? 0.01,
        decay: (settings.decay as number) ?? 0.3,
        sustain: (settings.sustain as number) ?? 0.4,
        release: (settings.release as number) ?? 0.01,
      },
      filterEnvelope: {
        attack: 0.01,
        decay: 0.2,
        sustain: 0.5,
        release: 0.01,
        baseFrequency: (settings.filterBaseFrequency as number) ?? 200,
        octaves: (settings.filterOctaves as number) ?? 2.5,
      },
    }).toDestination();
    synth.volume.value = (settings.volume as number) ?? -4;

    return {
      synth,
      dispose: () => {
        synth.dispose();
      },
    };
  },

  scheduleNote: (instance: AudioInstance, event: Event, time: number) => {
    const inst = instance as BassInstance;
    const note = Tone.Frequency(event.pitch, 'midi').toNote();
    const velocity = event.velocity / 127;
    inst.synth.triggerAttackRelease(note, event.duration, time, velocity);
  },

  updateParam: (instance: AudioInstance, key: string, value: number) => {
    const inst = instance as BassInstance;
    switch (key) {
      case 'filterBaseFrequency':
        inst.synth.filterEnvelope.baseFrequency = value;
        break;
      case 'volume':
        inst.synth.volume.value = value;
        break;
    }
  },
};

import * as Tone from 'tone';
import { Instrument, AudioInstance } from '../types';
import { Event } from '@daw/core/types';

interface PadInstance extends AudioInstance {
  synth: Tone.PolySynth;
}

export const Pad: Instrument = {
  id: 'pad',
  name: 'Pad',
  description: 'Warm triangle pad',
  color: '#8b5cf6',
  hasAudio: true,
  hasVisual: false,
  editorType: 'chord',
  noteRange: { min: 36, max: 72 }, // C2–C5
  rangeLabels: [
    { startPitch: 36, endPitch: 47, label: 'Low' },
    { startPitch: 48, endPitch: 59, label: 'Mid' },
    { startPitch: 60, endPitch: 72, label: 'High' },
  ],

  defaultSettings: {
    attack: 0.3,
    decay: 0.5,
    sustain: 0.8,
    release: 0.01,
    volume: -10,
  },

  settingsSchema: {
    attack: { type: 'number', label: 'Attack', min: 0.01, max: 2, step: 0.01, default: 0.3 },
    decay: { type: 'number', label: 'Decay', min: 0.01, max: 2, step: 0.01, default: 0.5 },
    sustain: { type: 'number', label: 'Sustain', min: 0, max: 1, step: 0.01, default: 0.8 },
    release: { type: 'number', label: 'Release', min: 0.001, max: 2, step: 0.01, default: 0.01 },
    volume: { type: 'number', label: 'Volume', min: -20, max: 0, step: 1, default: -10 },
  },

  createAudio: (settings): PadInstance => {
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: {
        attack: (settings.attack as number) ?? 0.3,
        decay: (settings.decay as number) ?? 0.5,
        sustain: (settings.sustain as number) ?? 0.8,
        release: (settings.release as number) ?? 0.01,
      },
    }).toDestination();
    synth.volume.value = (settings.volume as number) ?? -10;

    return {
      synth,
      dispose: () => {
        synth.dispose();
      },
    };
  },

  scheduleNote: (instance: AudioInstance, event: Event, time: number) => {
    const inst = instance as PadInstance;
    const note = Tone.Frequency(event.pitch, 'midi').toNote();
    const velocity = event.velocity / 127;
    inst.synth.triggerAttackRelease(note, event.duration, time, velocity);
  },

  updateParam: (instance: AudioInstance, key: string, value: number) => {
    const inst = instance as PadInstance;
    if (key === 'volume') inst.synth.volume.value = value;
  },
};

import * as Tone from 'tone';
import { Instrument, AudioInstance } from '../types';
import { Event } from '@daw/core/types';

interface KeysInstance extends AudioInstance {
  synth: Tone.PolySynth;
  reverb: Tone.Reverb;
}

export const Keys: Instrument = {
  id: 'keys',
  name: 'Keys',
  description: 'Warm electric piano',
  color: '#14b8a6',
  hasAudio: true,
  hasVisual: false,
  editorType: 'chord',
  noteRange: { min: 36, max: 84 }, // C2–C6
  rangeLabels: [
    { startPitch: 36, endPitch: 47, label: 'Low' },
    { startPitch: 48, endPitch: 71, label: 'Mid' },
    { startPitch: 72, endPitch: 84, label: 'High' },
  ],

  defaultSettings: {
    attack: 0.001,
    decay: 0.4,
    sustain: 0.3,
    release: 0.01,
    harmonicity: 3,
    modulationIndex: 1.5,
    reverbDecay: 1.5,
    reverbWet: 0.2,
    volume: -8,
  },

  settingsSchema: {
    attack: { type: 'number', label: 'Attack', min: 0.001, max: 2, step: 0.001, default: 0.001 },
    decay: { type: 'number', label: 'Decay', min: 0.01, max: 2, step: 0.01, default: 0.4 },
    sustain: { type: 'number', label: 'Sustain', min: 0, max: 1, step: 0.01, default: 0.3 },
    release: { type: 'number', label: 'Release', min: 0.001, max: 2, step: 0.001, default: 0.01 },
    reverbWet: { type: 'number', label: 'Reverb', min: 0, max: 1, step: 0.05, default: 0.2 },
    volume: { type: 'number', label: 'Volume', min: -20, max: 0, step: 1, default: -8 },
  },

  createAudio: (settings): KeysInstance => {
    const reverb = new Tone.Reverb({
      decay: (settings.reverbDecay as number) ?? 1.5,
      wet: (settings.reverbWet as number) ?? 0.2,
    }).toDestination();

    const synth = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: (settings.harmonicity as number) ?? 3,
      modulationIndex: (settings.modulationIndex as number) ?? 1.5,
      oscillator: { type: 'sine' },
      envelope: {
        attack: (settings.attack as number) ?? 0.001,
        decay: (settings.decay as number) ?? 0.4,
        sustain: (settings.sustain as number) ?? 0.3,
        release: (settings.release as number) ?? 0.01,
      },
      modulation: { type: 'sine' },
      modulationEnvelope: {
        attack: 0.001,
        decay: 0.3,
        sustain: 0.2,
        release: 0.01,
      },
    }).connect(reverb);
    synth.volume.value = (settings.volume as number) ?? -8;

    return {
      synth,
      reverb,
      dispose: () => {
        synth.dispose();
        reverb.dispose();
      },
    };
  },

  scheduleNote: (instance: AudioInstance, event: Event, time: number) => {
    const inst = instance as KeysInstance;
    const note = Tone.Frequency(event.pitch, 'midi').toNote();
    const velocity = event.velocity / 127;
    inst.synth.triggerAttackRelease(note, event.duration, time, velocity);
  },

  updateParam: (instance: AudioInstance, key: string, value: number) => {
    const inst = instance as KeysInstance;
    switch (key) {
      case 'reverbWet':
        inst.reverb.wet.value = value;
        break;
      case 'volume':
        inst.synth.volume.value = value;
        break;
    }
  },
};

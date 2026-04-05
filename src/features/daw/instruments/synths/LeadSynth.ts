import * as Tone from 'tone';
import { Instrument, AudioInstance } from '../types';
import { Event } from '@daw/core/types';

interface LeadSynthInstance extends AudioInstance {
  synth: Tone.PolySynth;
  filter: Tone.Filter;
}

export const LeadSynth: Instrument = {
  id: 'leadSynth',
  name: 'Lead Synth',
  description: 'Sawtooth lead synth',
  color: '#6366f1',
  hasAudio: true,
  hasVisual: false,
  editorType: 'chord',
  noteRange: { min: 48, max: 84 }, // C3–C6
  rangeLabels: [
    { startPitch: 48, endPitch: 59, label: 'Low' },
    { startPitch: 60, endPitch: 71, label: 'Mid' },
    { startPitch: 72, endPitch: 84, label: 'High' },
  ],

  defaultSettings: {
    attack: 0.005,
    decay: 0.15,
    sustain: 0.4,
    release: 0.005,
    filterFrequency: 2500,
    volume: -6,
  },

  settingsSchema: {
    attack: { type: 'number', label: 'Attack', min: 0.001, max: 2, step: 0.001, default: 0.005 },
    decay: { type: 'number', label: 'Decay', min: 0.01, max: 2, step: 0.01, default: 0.15 },
    sustain: { type: 'number', label: 'Sustain', min: 0, max: 1, step: 0.01, default: 0.4 },
    release: { type: 'number', label: 'Release', min: 0.001, max: 2, step: 0.001, default: 0.005 },
    filterFrequency: { type: 'number', label: 'Filter', min: 100, max: 10000, step: 100, default: 2500 },
    volume: { type: 'number', label: 'Volume', min: -20, max: 0, step: 1, default: -6 },
  },

  createAudio: (settings): LeadSynthInstance => {
    const filter = new Tone.Filter({
      frequency: (settings.filterFrequency as number) ?? 2500,
      type: 'lowpass',
      rolloff: -12,
    }).toDestination();

    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sawtooth' },
      envelope: {
        attack: (settings.attack as number) ?? 0.005,
        decay: (settings.decay as number) ?? 0.15,
        sustain: (settings.sustain as number) ?? 0.4,
        release: (settings.release as number) ?? 0.005,
      },
    }).connect(filter);
    synth.volume.value = (settings.volume as number) ?? -6;

    return {
      synth,
      filter,
      dispose: () => {
        synth.dispose();
        filter.dispose();
      },
    };
  },

  scheduleNote: (instance: AudioInstance, event: Event, time: number) => {
    const inst = instance as LeadSynthInstance;
    const note = Tone.Frequency(event.pitch, 'midi').toNote();
    const velocity = event.velocity / 127;
    inst.synth.triggerAttackRelease(note, event.duration, time, velocity);
  },

  updateParam: (instance: AudioInstance, key: string, value: number) => {
    const inst = instance as LeadSynthInstance;
    switch (key) {
      case 'filterFrequency':
        inst.filter.frequency.value = value;
        break;
      case 'volume':
        inst.synth.volume.value = value;
        break;
    }
  },
};

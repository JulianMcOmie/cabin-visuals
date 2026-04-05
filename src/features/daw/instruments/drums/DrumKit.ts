import * as Tone from 'tone';
import { Instrument, AudioInstance } from '../types';
import { Event, getDrumType } from '@daw/core/types';

interface DrumKitInstance extends AudioInstance {
  kick: Tone.MembraneSynth;
  snare: Tone.NoiseSynth;
  hihat: Tone.MetalSynth;
  clap: Tone.NoiseSynth;
}

export const DrumKit: Instrument = {
  id: 'drumKit',
  name: 'Drums',
  description: 'Drum kit with kick, snare, hi-hat, and clap',
  color: '#ef4444',
  hasAudio: true,
  hasVisual: false,
  editorType: 'drum',

  defaultSettings: {
    kickVolume: -2,
    snareVolume: -6,
    hihatVolume: -16,
    clapVolume: -8,
  },

  settingsSchema: {
    kickVolume: { type: 'number', label: 'Kick Vol', min: -20, max: 0, step: 1, default: -2 },
    snareVolume: { type: 'number', label: 'Snare Vol', min: -20, max: 0, step: 1, default: -6 },
    hihatVolume: { type: 'number', label: 'HiHat Vol', min: -20, max: 0, step: 1, default: -16 },
    clapVolume: { type: 'number', label: 'Clap Vol', min: -20, max: 0, step: 1, default: -8 },
  },

  createAudio: (settings): DrumKitInstance => {
    const kick = new Tone.MembraneSynth({
      pitchDecay: 0.05,
      octaves: 6,
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.001,
        decay: 0.4,
        sustain: 0.01,
        release: 0.4,
      },
    }).toDestination();
    kick.volume.value = (settings.kickVolume as number) ?? -2;

    const snare = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: {
        attack: 0.001,
        decay: 0.2,
        sustain: 0,
        release: 0.1,
      },
    }).toDestination();
    snare.volume.value = (settings.snareVolume as number) ?? -6;

    const hihat = new Tone.MetalSynth({
      envelope: {
        attack: 0.001,
        decay: 0.1,
        release: 0.05,
      },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 4000,
      octaves: 1.5,
    }).toDestination();
    hihat.volume.value = (settings.hihatVolume as number) ?? -16;

    const clap = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: {
        attack: 0.005,
        decay: 0.15,
        sustain: 0,
        release: 0.1,
      },
    }).toDestination();
    clap.volume.value = (settings.clapVolume as number) ?? -8;

    return {
      kick,
      snare,
      hihat,
      clap,
      dispose: () => {
        kick.dispose();
        snare.dispose();
        hihat.dispose();
        clap.dispose();
      },
    };
  },

  scheduleNote: (instance: AudioInstance, event: Event, time: number) => {
    const inst = instance as DrumKitInstance;
    const velocity = event.velocity / 127;
    const duration = event.duration;

    const drumType = getDrumType(event.pitch);
    switch (drumType) {
      case 'kick':
        inst.kick.triggerAttackRelease('C1', duration, time, velocity);
        break;
      case 'snare':
        inst.snare.triggerAttackRelease(duration, time, velocity);
        break;
      case 'hihat':
        inst.hihat.triggerAttackRelease('C6', duration * 0.5, time, velocity * 0.6);
        break;
      case 'clap':
        inst.clap.triggerAttackRelease(duration, time, velocity);
        break;
      default:
        // Unknown drum pitch - default to kick
        inst.kick.triggerAttackRelease('C1', duration, time, velocity);
        break;
    }
  },
};

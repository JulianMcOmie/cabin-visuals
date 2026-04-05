import * as Tone from 'tone';
import { Instrument, AudioInstance } from '../types';

// AudioPlayer is special - it doesn't use createAudio/scheduleNote like synths
// Instead it's handled specially by the playback engine for loading audio files
// This definition is primarily for UI/metadata purposes

interface AudioPlayerInstance extends AudioInstance {
  players: Map<string, Tone.Player>;
  blobUrls: Map<string, string>;
}

export const AudioPlayer: Instrument = {
  id: 'audioPlayer',
  name: 'Audio',
  description: 'Audio file playback',
  color: '#22c55e',
  hasAudio: true,
  hasVisual: false,
  editorType: null,

  defaultSettings: {
    volume: -6,
  },

  settingsSchema: {
    volume: { type: 'number', label: 'Volume', min: -20, max: 0, step: 1, default: -6 },
  },

  // AudioPlayer creates an empty instance - players are added per-block
  createAudio: (settings): AudioPlayerInstance => {
    return {
      players: new Map(),
      blobUrls: new Map(),
      volume: (settings.volume as number) ?? -6,
      dispose: () => {
        // Players are disposed separately per-block
      },
    };
  },

  // Audio playback is handled specially - not via scheduleNote
  // The playback engine schedules Tone.Player start/stop directly
};

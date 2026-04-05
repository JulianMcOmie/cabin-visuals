import { Event } from '@daw/core/types';
import { ColorRoleMapping } from '@daw/core/colorPalette';

// Settings schema for auto-generating Inspector UI
export interface SettingsSchema {
  [key: string]: {
    type: 'number' | 'boolean' | 'select' | 'string' | 'color' | 'font' | 'fontVariant';
    label: string;
    min?: number;
    max?: number;
    step?: number;
    options?: { value: string | number; label: string }[];
    default: unknown;
  };
}

// Audio instance returned by createAudio - flexible to accommodate different synth types
export interface AudioInstance {
  // Dispose method to clean up Tone.js nodes
  dispose: () => void;
  // Any other properties the instrument needs
  [key: string]: unknown;
}

// Editor types that instruments can use
export type InstrumentEditorType = 'chord' | 'drum' | 'arp' | 'generic' | null;

// Unified Instrument interface
export interface Instrument {
  id: string;
  name: string;
  description: string;
  icon?: string;
  color: string;
  hasAudio: boolean;
  hasVisual: boolean;
  editorType: InstrumentEditorType;
  defaultSettings: Record<string, unknown>;
  settingsSchema?: SettingsSchema;

  // Audio rendering (if hasAudio)
  createAudio?: (settings: Record<string, unknown>) => AudioInstance;
  scheduleNote?: (instance: AudioInstance, event: Event, time: number) => void;
  // For releasing held notes (used by instruments that track active notes)
  releaseNote?: (instance: AudioInstance, event: Event, time: number) => void;
  // For automation: update a parameter on a live audio instance
  updateParam?: (instance: AudioInstance, key: string, value: number) => void;

  // MIDI note range (clips visible rows in editor)
  noteRange?: { min: number; max: number };
  // Named regions within the note range
  rangeLabels?: { startPitch: number; endPitch: number; label: string }[];

  // Disable bloom post-processing when this instrument is active
  disableBloom?: boolean;

  // Only one track with this instrument can exist at a time
  singleton?: boolean;

  // Master channel instrument (post-processing only, always at bottom of track list)
  isMaster?: boolean;

  // Color palette role mapping for automatic palette-to-param conversion
  colorRoleMapping?: ColorRoleMapping;

  // Visual rendering (if hasVisual) - React component
  VisualComponent?: React.ComponentType<{ trackId: string }>;
}

// Folder structure for Library UI
export interface InstrumentFolder {
  name: string;
  instruments: string[]; // instrument IDs
  subfolders?: InstrumentFolder[];
}

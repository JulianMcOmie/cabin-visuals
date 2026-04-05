// Core Types for Pattern Composer

export const CURRENT_SCHEMA_VERSION = 2;

export interface PreviewTrackData {
  color: string;
  blocks: { startBar: number; endBar: number }[];
  level: number; // 0=root, 1+=nested
}

export interface ProjectMetadata {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  bpm: number;
  totalBars: number;
  trackCount: number;
  previewTracks?: PreviewTrackData[];
}

// MIDI drum pitch values (General MIDI standard)
export const DRUM_PITCHES = {
  kick: 36,
  snare: 38,
  clap: 39,
  hihat: 42,
} as const;

export type DrumType = keyof typeof DRUM_PITCHES;

export function getDrumType(pitch: number): DrumType | null {
  for (const [type, p] of Object.entries(DRUM_PITCHES)) {
    if (p === pitch) return type as DrumType;
  }
  return null;
}

export interface Event {
  startTimeInBeats: number;
  pitch: number; // MIDI note number (drums use 36/38/39/42)
  velocity: number; // 0-127
  duration: number; // in beats
}

export interface EventStream {
  events: Event[];
}

export interface Output {
  events: Event[];
  harmony?: HarmonyInfo;
}

export interface Block {
  id: string;
  startBar: number; // 0-indexed
  durationBars: number;
  loop: boolean;
  streams: EventStream[];
  // For reference blocks
  sourceBlockId?: string;
  sourceTrackId?: string;
  extractMode?: 'timing' | 'pitch' | 'velocity' | 'all';
  // For audio blocks
  audioData?: AudioData;
  audioOffset?: number; // seconds into audio file where playback begins (trim)
}

export type TrackTypeId =
  | 'base'
  | 'add'
  | 'override'
  | 'suppress'
  | 'mute'
  | 'gate'
  | 'shift'
  | 'transpose'
  | 'scale'
  | 'scaleShift'
  | 'harmonyMap'
  | 'rhythm'
  | 'rest'
  | 'swing'
  | 'scene'
  | 'master';

// Legacy type for backwards compatibility during migration
// New code should use string instrumentId directly
export type InstrumentId = 'synth' | 'keys' | 'pad' | 'bass' | 'drums' | 'audio' | string;

// Audio data for audio track blocks
export interface AudioData {
  // Reference ID to audio stored in IndexedDB (allows large files)
  storageId: string;
  // Original filename
  fileName: string;
  // MIME type (audio/wav, audio/mp3, etc.)
  mimeType: string;
  // Duration in seconds (cached after decode)
  duration: number;
  // Sample rate
  sampleRate: number;
  // Pre-computed waveform peaks for visualization (downsampled)
  // Kept in project JSON for fast rendering without loading full audio
  waveformPeaks: number[];
}

// Legacy type for backwards compatibility during migration
export type VisualInstrumentId = 'silkSymmetry' | 'hexagonDots' | 'fractalTunnel' | 'circleGrid' | string;

// Plugin instance for visual effects chain
export interface PluginInstance {
  id: string;
  pluginId: string;
  enabled: boolean;
  settings: Record<string, unknown>;
}

export type InterpolationMode = 'step' | 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'exponential' | 'smooth-step';

export interface AutomationConfig {
  targetParam: string;          // key into settingsSchema
  pluginInstanceId?: string;    // if set, targets a plugin's param instead of the instrument's
  interpolate: boolean;         // legacy: false = step, true = linear (kept for compat)
  interpolation?: InterpolationMode; // new: specific curve type
}

export interface Track {
  id: string;
  name: string;
  typeId: TrackTypeId;
  instrumentId?: string; // Unified instrument ID (e.g., "leadSynth", "fractalTunnel")
  instrumentSettings?: Record<string, unknown>; // Track-level settings for the instrument
  visualPlugins?: PluginInstance[]; // Visual effects plugin chain
  automationConfig?: AutomationConfig; // present = this is an automation track
  muted: boolean;
  solo: boolean;
  collapsed: boolean;
  blocks: Block[];
  childIds: string[];
  parentId?: string;
  patternCategory?: PatternCategory;
  sceneId?: string; // ID of the scene this track is assigned to
  sceneOpaque?: boolean; // For scene tracks: opaque background behind scene content
}

export interface Project {
  id: string;
  name: string;
  bpm: number;
  totalBars: number;
  beatsPerBar: number;
  rootTracks: string[]; // IDs of top-level tracks
  rootScenes: string[]; // IDs of top-level scene tracks
  mainSceneTrackId?: string; // ID of the main scene track (for palette background on main view)
  tracks: Record<string, Track>;
}

export type PatternCategory = 'drums' | 'chords' | 'bass' | 'arp' | 'modifier' | 'rhythm' | 'suppress' | 'mute' | 'rest' | 'swing';

export type PresetType = 'loop' | 'pattern';

export interface Preset {
  id: string;
  name: string;
  category: PatternCategory;
  description: string;
  defaultTrackType: TrackTypeId;
  defaultInstrument?: string; // Unified instrument ID
  events: Event[];
  durationBars: number;
  presetType: PresetType;
}

export interface TrackTypeDefinition {
  id: TrackTypeId;
  name: string;
  description: string;
  category: 'source' | 'combiner' | 'modifier' | 'mapper';
  combine: (parent: Output, self: Output, ctx: ProcessContext) => Output;
}

// Legacy InstrumentDefinition - use Instrument from '@daw/instruments' instead
export interface InstrumentDefinition {
  id: string;
  name: string;
  description: string;
  color: string;
}

export interface HarmonyInfo {
  chord: number[]; // MIDI note numbers
  root: number;
  quality: 'major' | 'minor' | 'diminished' | 'augmented' | 'sus' | 'unknown';
}

export interface ScaleInfo {
  root: number;
  intervals: number[]; // semitones from root
  name: string;
}

export interface ProcessContext {
  bpm: number;
  beatsPerBar: number;
  totalBars: number;
  currentBar: number;
  parentOutput?: Output;
  harmony?: HarmonyInfo;
  scale?: ScaleInfo;
}

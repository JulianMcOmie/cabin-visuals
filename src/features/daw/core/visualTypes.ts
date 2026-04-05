// Visual Instrument Types

import { Event } from './types';
import { ResolvedPalette } from './colorPalette';

export interface VisualInstrumentState {
  instrumentId: string;
  activeNotes: Map<number, Event>;
  currentRotation: number;
  bloom: number;
  colorShift: number;
  params: Record<string, unknown>; // Merged: instrument defaults + track overrides
  pluginParamOverrides: Map<string, Record<string, unknown>>; // pluginInstanceId → { paramKey → value }
  noteOnCount: number; // Increments for EVERY note-on trigger (never throttled)
  pitchNoteOnCounts: Map<number, number>; // Per-pitch note-on counts
  blackedOut: boolean; // True when instrument is completely disabled by a mute region
  activePalette: ResolvedPalette | null; // Active color palette from colorPalette child track
}

export interface VisualEvent {
  trackId: string;
  instrumentId: string;
  startTimeInBeats: number;
  pitch: number;
  velocity: number;
  duration: number;
  type: 'noteOn' | 'noteOff';
}

export interface VisualTrackState {
  trackId: string;
  instrumentId: string;
  state: VisualInstrumentState;
}

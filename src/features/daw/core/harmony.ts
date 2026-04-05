import { Event, HarmonyInfo, ScaleInfo, Output } from './types';
import { HARMONY_TOLERANCE } from './constants';

// Common scales
export const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonicMajor: [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

// Circle of fifths: C -> G -> D -> A -> E -> B -> F#/Gb -> Db -> Ab -> Eb -> Bb -> F -> C
export const CIRCLE_OF_FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

// Chord patterns for detection (intervals from root)
// Order matters! Longer patterns must come first so major7 isn't detected as major
const CHORD_PATTERNS: Record<string, number[]> = {
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  dominant7: [0, 4, 7, 10],
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
};

export function findClosestScaleIndex(pitch: number, scale: ScaleInfo): number {
  const pitchClass = pitch % 12;
  const scaleNotes = scale.intervals.map(i => (scale.root + i) % 12);

  let closestIndex = 0;
  let minDistance = 12;

  for (let i = 0; i < scaleNotes.length; i++) {
    const distance = Math.min(
      Math.abs(pitchClass - scaleNotes[i]),
      12 - Math.abs(pitchClass - scaleNotes[i])
    );
    if (distance < minDistance) {
      minDistance = distance;
      closestIndex = i;
    }
  }

  return closestIndex;
}

export function getScalePitch(scaleIndex: number, scale: ScaleInfo, octave: number): number {
  const normalizedIndex = ((scaleIndex % scale.intervals.length) + scale.intervals.length) % scale.intervals.length;
  const octaveOffset = Math.floor(scaleIndex / scale.intervals.length);
  return (octave + octaveOffset) * 12 + scale.root + scale.intervals[normalizedIndex];
}

export function findHarmonyInOutput(output: Output, atTime?: number): HarmonyInfo | undefined {
  if (output.harmony) return output.harmony;

  // Try to detect chord from events
  const events = atTime !== undefined
    ? output.events.filter(e => Math.abs(e.startTimeInBeats - atTime) < HARMONY_TOLERANCE)
    : output.events.slice(0, 10); // Look at first few events

  const pitches = events
    .filter(e => e.pitch !== undefined)
    .map(e => e.pitch as number);

  if (pitches.length < 2) return undefined;

  return detectChord(pitches);
}

export function detectChord(pitches: number[]): HarmonyInfo | undefined {
  if (pitches.length < 2) return undefined;

  // Get unique pitch classes
  const pitchClasses = [...new Set(pitches.map(p => p % 12))].sort((a, b) => a - b);

  if (pitchClasses.length < 2) return undefined;

  // Find best match - prefer exact matches and longer patterns
  let bestMatch: { root: number; quality: string; score: number } | null = null;

  // Try each pitch as potential root
  for (const root of pitchClasses) {
    const intervals = pitchClasses.map(p => (p - root + 12) % 12).sort((a, b) => a - b);

    // Check against known patterns (ordered longest first in CHORD_PATTERNS)
    for (const [quality, pattern] of Object.entries(CHORD_PATTERNS)) {
      const match = matchesPattern(intervals, pattern);
      if (match.matches) {
        // Score: exact match (pattern length * 2) + pattern length for longer patterns
        const score = match.exact ? pattern.length * 3 : pattern.length;
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { root, quality, score };
        }
        // If we found an exact match, this is probably right
        if (match.exact) break;
      }
    }
  }

  if (bestMatch) {
    return {
      chord: pitches.sort((a, b) => a - b),
      root: bestMatch.root,
      quality: mapQualityToHarmony(bestMatch.quality),
    };
  }

  // Unknown chord
  return {
    chord: pitches.sort((a, b) => a - b),
    root: pitches[0] % 12,
    quality: 'unknown',
  };
}

function matchesPattern(intervals: number[], pattern: number[]): { matches: boolean; exact: boolean } {
  if (intervals.length < pattern.length) return { matches: false, exact: false };
  const matches = pattern.every(p => intervals.includes(p));
  const exact = matches && intervals.length === pattern.length;
  return { matches, exact };
}

// Map internal quality names to HarmonyInfo quality (which has fewer options)
function mapQualityToHarmony(quality: string): HarmonyInfo['quality'] {
  switch (quality) {
    case 'major':
    case 'major7':
      return 'major';
    case 'minor':
    case 'minor7':
      return 'minor';
    case 'diminished':
      return 'diminished';
    case 'augmented':
      return 'augmented';
    case 'sus2':
    case 'sus4':
      return 'sus';
    case 'dominant7':
      return 'major'; // Dominant is major with a flat 7
    default:
      return 'unknown';
  }
}

export function deriveScaleFromHarmony(harmony: HarmonyInfo): ScaleInfo {
  // Simple mapping: major chord -> major scale, minor chord -> minor scale
  let scaleName: string;
  let intervals: number[];

  switch (harmony.quality) {
    case 'major':
      scaleName = 'Major';
      intervals = SCALES.major;
      break;
    case 'minor':
      scaleName = 'Minor';
      intervals = SCALES.minor;
      break;
    case 'diminished':
      scaleName = 'Minor';
      intervals = SCALES.minor;
      break;
    case 'sus':
      scaleName = 'Mixolydian';
      intervals = SCALES.mixolydian;
      break;
    default:
      scaleName = 'Major';
      intervals = SCALES.major;
  }

  return {
    root: harmony.root,
    intervals,
    name: scaleName,
  };
}

export function transposeEvent(event: Event, semitones: number): Event {
  if (event.pitch === undefined) return event;
  return {
    ...event,
    pitch: event.pitch + semitones,
  };
}

export function transposeToKey(events: Event[], fromRoot: number, toRoot: number): Event[] {
  const semitones = toRoot - fromRoot;
  return events.map(e => transposeEvent(e, semitones));
}

export function getNoteNames(): string[] {
  return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
}

export function midiToNoteName(midi: number): string {
  const noteNames = getNoteNames();
  const octave = Math.floor(midi / 12) - 1;
  const noteName = noteNames[midi % 12];
  return `${noteName}${octave}`;
}

export function noteNameToMidi(name: string): number {
  const noteNames = getNoteNames();
  const match = name.match(/^([A-G]#?)(-?\d+)$/);
  if (!match) return 60; // Default to middle C

  const [, noteName, octaveStr] = match;
  const noteIndex = noteNames.indexOf(noteName);
  const octave = parseInt(octaveStr, 10);

  return (octave + 1) * 12 + noteIndex;
}

import { Event } from './types';

// Reference chord (C major for display)
// degrees: 1=C4(60), 2=D4(62), 3=E4(64), 4=F4(65), 5=G4(67), 6=A4(69), 7=B4(71), 8=C5(72)
const REFERENCE_PITCHES: Record<number, number> = {
  1: 60, // C4 - root
  2: 62, // D4 - passing tone
  3: 64, // E4 - third
  4: 65, // F4 - passing tone
  5: 67, // G4 - fifth
  6: 69, // A4 - passing tone
  7: 71, // B4 - passing tone
  8: 72, // C5 - octave
};

// Reverse lookup: pitch offset (from C4=60) to degree
// We use the offset from C4 within an octave to determine the degree
const PITCH_TO_DEGREE: Record<number, number> = {
  0: 1,  // C
  2: 2,  // D
  4: 3,  // E
  5: 4,  // F
  7: 5,  // G
  9: 6,  // A
  11: 7, // B
};

export interface ArpNote {
  id: string;
  degree: number; // 1-8 (with octave offset encoded)
  time: number;
  duration: number;
  velocity: number;
  octaveOffset: number; // -2, -1, 0, +1, +2 relative to middle octave
}

/**
 * Convert MIDI pitch to degree and octave offset
 * Reference: C4 (60) = degree 1, octave 0
 */
export function pitchToDegree(pitch: number): { degree: number; octaveOffset: number } {
  // Calculate the offset from C4 (60)
  const offset = pitch - 60;

  // Get the octave offset (how many octaves from C4)
  const octaveOffset = Math.floor(offset / 12);

  // Get the note within the octave (0-11)
  let noteInOctave = offset % 12;
  if (noteInOctave < 0) noteInOctave += 12;

  // Map to degree (1-7, with 8 being same as 1 but next octave)
  const degree = PITCH_TO_DEGREE[noteInOctave];

  if (degree === undefined) {
    // For chromatic notes not in C major scale, find closest degree
    const degrees = Object.keys(PITCH_TO_DEGREE).map(Number);
    const closest = degrees.reduce((prev, curr) =>
      Math.abs(curr - noteInOctave) < Math.abs(prev - noteInOctave) ? curr : prev
    );
    return { degree: PITCH_TO_DEGREE[closest], octaveOffset };
  }

  return { degree, octaveOffset };
}

/**
 * Convert degree and octave offset to MIDI pitch
 */
export function degreeToPitch(degree: number, octaveOffset: number): number {
  // For degree 8, treat as degree 1 in next octave
  const normalizedDegree = degree === 8 ? 1 : degree;
  const extraOctave = degree === 8 ? 1 : 0;

  const basePitch = REFERENCE_PITCHES[normalizedDegree] ?? 60;
  return basePitch + (octaveOffset + extraOctave) * 12;
}

/**
 * Extract arp notes from block events
 */
export function eventsToArpNotes(events: Event[]): ArpNote[] {
  const pitchedEvents = events.filter(e => e.pitch !== undefined);

  return pitchedEvents.map((event, index) => {
    const { degree, octaveOffset } = pitchToDegree(event.pitch!);
    return {
      id: `arp-${event.startTimeInBeats}-${degree}-${index}`,
      degree,
      time: event.startTimeInBeats,
      duration: event.duration ?? 0.25,
      velocity: event.velocity ?? 100,
      octaveOffset,
    };
  });
}

/**
 * Convert arp notes back to events
 */
export function arpNotesToEvents(notes: ArpNote[]): Event[] {
  return notes.map(note => ({
    startTimeInBeats: note.time,
    pitch: degreeToPitch(note.degree, note.octaveOffset),
    duration: note.duration,
    velocity: note.velocity,
  }));
}

// Degree labels for the editor UI
export const DEGREE_LABELS: Record<string, string> = {
  '8': 'Oct',
  '7': '7th',
  '6': '6th',
  '5': '5th',
  '4': '4th',
  '3': '3rd',
  '2': '2nd',
  '1': 'Root',
};

// Degree colors (teal gradient)
export const DEGREE_COLORS: Record<string, string> = {
  '8': '#2DD4BF', // teal-400
  '7': '#5EEAD4', // teal-300
  '6': '#14B8A6', // teal-500
  '5': '#0D9488', // teal-600
  '4': '#5EEAD4', // teal-300
  '3': '#14B8A6', // teal-500
  '2': '#5EEAD4', // teal-300
  '1': '#0F766E', // teal-700
};

// Ordered rows for the arp editor (high to low)
export const ARP_ROWS = ['8', '7', '6', '5', '4', '3', '2', '1'] as const;
export type ArpRow = typeof ARP_ROWS[number];

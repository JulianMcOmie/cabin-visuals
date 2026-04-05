import { Block, Event } from '@daw/core/types';
import { MidiNote } from '@daw/components/shared/MidiEditor';

/**
 * Get all events from a block's streams.
 */
export function getAllEventsFromBlock(block: Block): Event[] {
  return block.streams?.flatMap(s => s.events) || [];
}

/**
 * Convert MidiNotes to Events, preserving each note's pitch.
 */
export function notesToEvents(notes: MidiNote[]): Event[] {
  return notes.map(n => ({
    startTimeInBeats: n.time,
    pitch: n.pitch,
    velocity: n.velocity,
    duration: n.duration,
  }));
}

/**
 * Convert MidiNotes to Events using a fixed pitch (for single-row editors like Mute, Suppress, Rhythm).
 */
export function notesToEventsFixed(notes: MidiNote[], pitch: number): Event[] {
  return notes.map(n => ({
    startTimeInBeats: n.time,
    pitch,
    velocity: n.velocity,
    duration: n.duration,
  }));
}

/**
 * Convert Events to MidiNotes with an ID prefix.
 */
export function eventsToMidiNotes(events: Event[], idPrefix: string): MidiNote[] {
  return events.map((e, i) => ({
    id: `${idPrefix}-${e.startTimeInBeats}-${e.pitch}-${i}`,
    pitch: e.pitch,
    time: e.startTimeInBeats,
    duration: e.duration,
    velocity: e.velocity,
  }));
}

/**
 * Convert Events to MidiNotes with a fixed pitch override (for single-row editors).
 */
export function eventsToMidiNotesFixed(events: Event[], pitch: number, idPrefix: string): MidiNote[] {
  return events.map((e, i) => ({
    id: `${idPrefix}-${e.startTimeInBeats}-${i}`,
    pitch,
    time: e.startTimeInBeats,
    duration: e.duration,
    velocity: e.velocity,
  }));
}

import { TrackTypeDefinition, Output, ProcessContext, Event } from './types';
import { TIME_TOLERANCE, HARMONY_TOLERANCE } from './constants';

// Helper to merge events, avoiding duplicates at same time
function mergeEvents(a: Event[], b: Event[]): Event[] {
  const result = [...a];
  for (const event of b) {
    const existing = result.find(
      e => e.startTimeInBeats === event.startTimeInBeats && e.pitch === event.pitch
    );
    if (!existing) {
      result.push(event);
    }
  }
  return result.sort((x, y) => x.startTimeInBeats - y.startTimeInBeats);
}

// Helper to find events at matching times
function findEventsAtTime(events: Event[], time: number, tolerance = TIME_TOLERANCE): Event[] {
  return events.filter(e => Math.abs(e.startTimeInBeats - time) < tolerance);
}

export const TRACK_TYPES: Record<string, TrackTypeDefinition> = {
  // Sources - generate events from scratch
  base: {
    id: 'base',
    name: 'Base',
    description: 'Starting point for a pattern - outputs its own events',
    category: 'source',
    combine: (_parent, self) => self,
  },

  rest: {
    id: 'rest',
    name: 'Rest',
    description: 'Silent region - outputs no events',
    category: 'source',
    combine: () => ({ events: [], harmony: undefined }),
  },

  // Combiners - merge with parent output
  add: {
    id: 'add',
    name: 'Add',
    description: 'Adds events to parent output (layering)',
    category: 'modifier',
    combine: (parent, self) => ({
      events: mergeEvents(parent.events, self.events),
      harmony: self.harmony || parent.harmony,
    }),
  },

  override: {
    id: 'override',
    name: 'Override',
    description: 'Replaces parent events within the time range of this track',
    category: 'modifier',
    combine: (parent, self, ctx) => {
      if (self.events.length === 0) return parent;
      if (parent.events.length === 0) return self;

      // Find the time range covered by self's events (by start time only, not duration)
      const minTime = Math.min(...self.events.map(e => e.startTimeInBeats));
      const maxTime = Math.max(...self.events.map(e => e.startTimeInBeats));

      // Round to bar boundaries
      const beatsPerBar = ctx?.beatsPerBar || 4;
      const rangeStart = Math.floor(minTime / beatsPerBar) * beatsPerBar;
      // Use the bar containing the last event's START time, not its end
      const rangeEnd = (Math.floor(maxTime / beatsPerBar) + 1) * beatsPerBar;

      // Keep parent events outside the override range
      const keptParentEvents = parent.events.filter(
        e => e.startTimeInBeats < rangeStart || e.startTimeInBeats >= rangeEnd
      );

      // Combine: parent events outside range + self events
      const combined = [...keptParentEvents, ...self.events];
      combined.sort((a, b) => a.startTimeInBeats - b.startTimeInBeats);

      return {
        events: combined,
        harmony: self.harmony || parent.harmony,
      };
    },
  },

  suppress: {
    id: 'suppress',
    name: 'Suppress',
    description: 'Filters parent events whose start time falls within suppress regions',
    category: 'modifier',
    combine: (parent, self) => {
      if (self.events.length === 0) return parent;
      if (parent.events.length === 0) return parent;

      // Check if a time falls within any suppress region
      const isSuppressed = (time: number): boolean => {
        for (const suppressEvent of self.events) {
          const suppressStart = suppressEvent.startTimeInBeats;
          const suppressEnd = suppressStart + (suppressEvent.duration ?? 0.25);
          if (time >= suppressStart && time < suppressEnd) {
            return true;
          }
        }
        return false;
      };

      // Keep only parent events whose start time is not within a suppress region
      const keptEvents = parent.events.filter(e => !isSuppressed(e.startTimeInBeats));

      return {
        events: keptEvents,
        harmony: parent.harmony,
      };
    },
  },

  mute: {
    id: 'mute',
    name: 'Mute',
    description: 'Completely disables the instrument during marked regions',
    category: 'modifier',
    combine: (parent, _self) => parent, // Pass-through — doesn't filter events
  },

  // Modifiers - transform parent output
  gate: {
    id: 'gate',
    name: 'Gate',
    description: 'Only allows parent events through when this track has events',
    category: 'modifier',
    combine: (parent, self) => {
      if (self.events.length === 0) return parent;
      const gatedEvents = parent.events.filter(parentEvent => {
        return self.events.some(
          gateEvent => Math.abs(gateEvent.startTimeInBeats - parentEvent.startTimeInBeats) < TIME_TOLERANCE
        );
      });
      return {
        events: gatedEvents,
        harmony: parent.harmony,
      };
    },
  },

  shift: {
    id: 'shift',
    name: 'Shift',
    description: 'Shifts pitch of parent events based on this track\'s pitches',
    category: 'modifier',
    combine: (parent, self) => {
      if (self.events.length === 0) return parent;

      const shiftedEvents = parent.events.map(parentEvent => {
        const shifters = findEventsAtTime(self.events, parentEvent.startTimeInBeats);
        if (shifters.length === 0) return parentEvent;

        // Use the first shifter's pitch as offset (relative to middle C = 60)
        const shiftAmount = (shifters[0].pitch ?? 60) - 60;
        return {
          ...parentEvent,
          pitch: parentEvent.pitch !== undefined
            ? parentEvent.pitch + shiftAmount
            : parentEvent.pitch,
        };
      });

      return {
        events: shiftedEvents,
        harmony: parent.harmony,
      };
    },
  },

  transpose: {
    id: 'transpose',
    name: 'Transpose',
    description: 'Transposes parent events within regions defined by MIDI notes (pitch = semitones from C4)',
    category: 'modifier',
    combine: (parent, self) => {
      if (self.events.length === 0) return parent;

      // Helper to find transpose amount at a given time
      // Uses duration of transpose notes to define regions
      const getTransposeAtTime = (time: number): number | null => {
        for (const transposeEvent of self.events) {
          const start = transposeEvent.startTimeInBeats;
          const end = start + (transposeEvent.duration ?? 1);
          if (time >= start && time < end) {
            // Pitch relative to C4 (60) = transposition amount in semitones
            return (transposeEvent.pitch ?? 60) - 60;
          }
        }
        return null;
      };

      const transposedEvents = parent.events.map(parentEvent => {
        const transposeAmount = getTransposeAtTime(parentEvent.startTimeInBeats);
        if (transposeAmount === null) return parentEvent;

        return {
          ...parentEvent,
          pitch: parentEvent.pitch !== undefined
            ? parentEvent.pitch + transposeAmount
            : parentEvent.pitch,
        };
      });

      return {
        events: transposedEvents,
        harmony: parent.harmony,
      };
    },
  },

  scale: {
    id: 'scale',
    name: 'Scale Velocity',
    description: 'Scales velocity of parent events based on this track\'s velocities',
    category: 'modifier',
    combine: (parent, self) => {
      if (self.events.length === 0) return parent;

      const scaledEvents = parent.events.map(parentEvent => {
        const scalers = findEventsAtTime(self.events, parentEvent.startTimeInBeats);
        if (scalers.length === 0) return parentEvent;

        // Use scaler velocity as multiplier (100 = 100% = no change)
        const scaleFactor = (scalers[0].velocity ?? 100) / 100;
        return {
          ...parentEvent,
          velocity: Math.min(127, Math.round((parentEvent.velocity ?? 100) * scaleFactor)),
        };
      });

      return {
        events: scaledEvents,
        harmony: parent.harmony,
      };
    },
  },

  scaleShift: {
    id: 'scaleShift',
    name: 'Scale Shift',
    description: 'Shifts pitches to fit a musical scale',
    category: 'modifier',
    combine: (parent, self, ctx) => {
      if (!ctx.scale) return parent;

      const scale = ctx.scale;
      const scaleNotes = scale.intervals.map(i => (scale.root + i) % 12);

      const shiftedEvents = parent.events.map(parentEvent => {
        if (parentEvent.pitch === undefined) return parentEvent;

        const pitchClass = parentEvent.pitch % 12;
        if (scaleNotes.includes(pitchClass)) return parentEvent;

        // Find closest scale note
        let closestNote = scaleNotes[0];
        let minDistance = 12;
        for (const note of scaleNotes) {
          const distance = Math.min(
            Math.abs(pitchClass - note),
            12 - Math.abs(pitchClass - note)
          );
          if (distance < minDistance) {
            minDistance = distance;
            closestNote = note;
          }
        }

        const octave = Math.floor(parentEvent.pitch / 12);
        return {
          ...parentEvent,
          pitch: octave * 12 + closestNote,
        };
      });

      return {
        events: shiftedEvents,
        harmony: parent.harmony,
      };
    },
  },

  // Rhythm - triggers parent notes at child's event times
  rhythm: {
    id: 'rhythm',
    name: 'Rhythm',
    description: 'Triggers parent notes at child event times',
    category: 'modifier',
    combine: (parent, self) => {
      if (self.events.length === 0) return parent;
      if (parent.events.length === 0) return { events: [], harmony: parent.harmony };

      // Get events active at a given time
      const getEventsAtTime = (time: number): Event[] => {
        // Find events that are active at this time (within their duration)
        const active = parent.events.filter(e => {
          const end = e.startTimeInBeats + e.duration;
          return e.startTimeInBeats <= time && time < end;
        });
        if (active.length > 0) return active;

        // Fallback: most recent events before this time
        const before = parent.events.filter(e => e.startTimeInBeats <= time);
        if (before.length === 0) {
          // Use first events if nothing before
          const firstTime = Math.min(...parent.events.map(e => e.startTimeInBeats));
          return parent.events.filter(e => Math.abs(e.startTimeInBeats - firstTime) < HARMONY_TOLERANCE);
        }
        const lastTime = Math.max(...before.map(e => e.startTimeInBeats));
        return before.filter(e => Math.abs(e.startTimeInBeats - lastTime) < HARMONY_TOLERANCE);
      };

      const triggered: Event[] = [];
      for (const rhythmEvent of self.events) {
        for (const parentEvent of getEventsAtTime(rhythmEvent.startTimeInBeats)) {
          // Pitch carries through naturally (works for both melodic and drum events)
          triggered.push({
            startTimeInBeats: rhythmEvent.startTimeInBeats,
            pitch: parentEvent.pitch,
            velocity: rhythmEvent.velocity ?? parentEvent.velocity,
            duration: rhythmEvent.duration ?? 0.25,
          });
        }
      }
      return { events: triggered.sort((a, b) => a.startTimeInBeats - b.startTimeInBeats), harmony: parent.harmony };
    },
  },

  // Mappers - use harmony context
  harmonyMap: {
    id: 'harmonyMap',
    name: 'Harmony Map',
    description: 'Maps this track\'s pitches to follow parent harmony over time',
    category: 'modifier',
    combine: (parent, self, ctx) => {
      // If no self events, pass through parent unchanged
      if (self.events.length === 0) return parent;

      // Get harmony from the context's parent output (flows down the signal chain)
      const harmonySource = ctx.parentOutput;
      if (!harmonySource) {
        // No upstream harmony - just return self events as-is
        return self;
      }

      const parentPitched = harmonySource.events.filter(e => e.pitch !== undefined);
      if (parentPitched.length === 0) {
        // No pitched events in harmony source - return self as-is
        return self;
      }

      // Helper: extract chord tones from notes, keeping root (lowest) first
      const extractChordTones = (notes: typeof parentPitched): number[] => {
        if (notes.length === 0) return [];
        // Sort by actual pitch to find the bass note (likely the root)
        const sorted = [...notes].sort((a, b) => a.pitch! - b.pitch!);
        const bassNote = sorted[0].pitch! % 12;
        // Get unique pitch classes
        const pitchClasses = [...new Set(notes.map(e => e.pitch! % 12))];
        // Reorder so bass note is first, then others in ascending order
        const others = pitchClasses.filter(p => p !== bassNote).sort((a, b) => a - b);
        return [bassNote, ...others];
      };

      // Helper: find chord tones active at a given time
      const getChordAtTime = (time: number): number[] => {
        // Find parent notes that overlap with this time
        // A note is active if: noteTime <= time < noteTime + noteDuration
        const activeNotes = parentPitched.filter(e => {
          const noteEnd = e.startTimeInBeats + (e.duration || 0.5);
          return e.startTimeInBeats <= time && time < noteEnd;
        });

        if (activeNotes.length > 0) {
          return extractChordTones(activeNotes);
        }

        // Fallback: find the most recent chord before this time
        const beforeNotes = parentPitched.filter(e => e.startTimeInBeats <= time);
        if (beforeNotes.length === 0) {
          // Use first chord if nothing before
          const firstTime = Math.min(...parentPitched.map(e => e.startTimeInBeats));
          const firstChordNotes = parentPitched.filter(e => Math.abs(e.startTimeInBeats - firstTime) < HARMONY_TOLERANCE);
          return extractChordTones(firstChordNotes);
        }

        // Get the most recent time with notes
        const lastTime = Math.max(...beforeNotes.map(e => e.startTimeInBeats));
        const lastChordNotes = beforeNotes.filter(e => Math.abs(e.startTimeInBeats - lastTime) < HARMONY_TOLERANCE);
        return extractChordTones(lastChordNotes);
      };

      // Determine the reference chord from the first arp note's pitch context
      // This lets us figure out what chord degree each arp note represents
      const firstPitch = self.events.find(e => e.pitch !== undefined)?.pitch ?? 60;
      const referenceRoot = firstPitch % 12;

      // Map self's pitches to chord tones at each note's time
      const mappedEvents = self.events.map(selfEvent => {
        if (selfEvent.pitch === undefined) return selfEvent;

        const chordTones = getChordAtTime(selfEvent.startTimeInBeats);
        if (chordTones.length === 0) return selfEvent;

        // Calculate which chord degree this note represents
        // by its semitone distance from the reference root
        const semitones = selfEvent.pitch - firstPitch;

        // Map semitones to chord tone index:
        // 0 semitones = root (index 0)
        // ~4 semitones = 3rd (index 1)
        // ~7 semitones = 5th (index 2)
        // We use the semitone offset to pick a chord tone, wrapping around
        const octaveOffset = Math.floor(semitones / 12);
        const intervalInOctave = ((semitones % 12) + 12) % 12;

        // Map the interval to the nearest chord tone index
        // Divide the octave proportionally by number of chord tones
        const chordIndex = Math.round((intervalInOctave / 12) * chordTones.length) % chordTones.length;
        const chordTone = chordTones[chordIndex];

        // Preserve the octave relationship from the original arp
        const baseOctave = Math.floor(firstPitch / 12);
        const targetOctave = baseOctave + octaveOffset;

        return {
          ...selfEvent,
          pitch: targetOctave * 12 + chordTone,
        };
      });

      return {
        events: mappedEvents,
        harmony: harmonySource.harmony,
      };
    },
  },

  // Swing - delays off-beat events to create swing/groove feel
  swing: {
    id: 'swing',
    name: 'Swing',
    description: 'Delays events to create swing timing (velocity controls amount)',
    category: 'modifier',
    combine: (parent, self, ctx) => {
      if (self.events.length === 0) return parent;
      if (parent.events.length === 0) return parent;

      const beatsPerBar = ctx?.beatsPerBar || 4;

      // Build a map of swing markers: time -> swing amount (0-1)
      // Velocity 0 = no swing, 127 = maximum swing
      const swingMarkers = new Map<number, number>();
      for (const event of self.events) {
        const swingAmount = (event.velocity ?? 64) / 127;
        swingMarkers.set(event.startTimeInBeats, swingAmount);
      }

      // Helper to find the nearest swing marker for a given time
      const getSwingAmount = (time: number): number | null => {
        // Check for exact match first
        if (swingMarkers.has(time)) {
          return swingMarkers.get(time)!;
        }
        // Check within a small tolerance (for floating point issues)
        for (const [markerTime, amount] of swingMarkers) {
          if (Math.abs(markerTime - time) < TIME_TOLERANCE) {
            return amount;
          }
        }
        return null;
      };

      // Apply swing to parent events
      const swungEvents = parent.events.map(parentEvent => {
        const swingAmount = getSwingAmount(parentEvent.startTimeInBeats);
        if (swingAmount === null) return parentEvent;

        // Calculate delay based on swing amount
        // Max delay is 1/3 of an 8th note (0.167 beats) for classic triplet swing
        // This creates the "shuffle" feel where off-beats land 2/3 through
        const maxDelay = 0.167; // ~1/6 beat, creates triplet feel at max
        const delay = swingAmount * maxDelay;

        return {
          ...parentEvent,
          startTimeInBeats: parentEvent.startTimeInBeats + delay,
        };
      });

      return {
        events: swungEvents.sort((a, b) => a.startTimeInBeats - b.startTimeInBeats),
        harmony: parent.harmony,
      };
    },
  },

  // Scene - container for grouping visual tracks with masks
  scene: {
    id: 'scene',
    name: 'Scene',
    description: 'Groups visual tracks into a compositing layer with mask support',
    category: 'source',
    combine: (_parent, self) => self,
  },
};

export function getTrackType(id: string): TrackTypeDefinition {
  return TRACK_TYPES[id] || TRACK_TYPES.base;
}

// Migration alias: old saved projects may have typeId 'mute' meaning the old suppress behavior.
// The new 'mute' in TRACK_TYPES is the blackout concept. Old mute projects that relied on
// event-filtering are handled via the 'suppress' type. If migration is needed for legacy
// projects, remap typeId 'mute' → 'suppress' during project load.

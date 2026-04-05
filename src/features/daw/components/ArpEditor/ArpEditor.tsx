'use client';

import { useCallback } from 'react';
import { Block, Track } from '@daw/core/types';
import { useProjectStore } from '@daw/stores/projectStore';
import { MidiEditor, MidiNote, MidiRow } from '@daw/components/shared/MidiEditor';
import { QuantizeSelect } from '@daw/components/shared/QuantizeSelect';
import { useMidiEditorState } from '@daw/hooks/useMidiEditorState';
import {
  eventsToArpNotes,
  arpNotesToEvents,
  ArpNote,
} from '@daw/core/arp';

interface ArpEditorProps {
  block: Block;
  track: Track;
  beatsPerBar: number;
}

const DEFAULT_QUANTIZE = 0.25;

// MidiRow definitions for arp degrees (pitch = degree for simplicity, 1-8)
const ARP_ROWS: MidiRow[] = [
  { pitch: 8, label: 'Oct', color: '#2DD4BF' },
  { pitch: 7, label: '7th', color: '#5EEAD4' },
  { pitch: 6, label: '6th', color: '#14B8A6' },
  { pitch: 5, label: '5th', color: '#0D9488' },
  { pitch: 4, label: '4th', color: '#5EEAD4' },
  { pitch: 3, label: '3rd', color: '#14B8A6' },
  { pitch: 2, label: '2nd', color: '#5EEAD4' },
  { pitch: 1, label: 'Root', color: '#0F766E' },
];

// Convert ArpNotes to MidiNotes for the editor (pitch = degree)
function arpNotesToMidiNotes(arpNotes: ArpNote[]): MidiNote[] {
  return arpNotes.map(note => ({
    id: note.id,
    pitch: note.degree,
    time: note.time,
    duration: note.duration,
    velocity: note.velocity,
  }));
}

// Convert MidiNotes back to ArpNotes (pitch = degree, all in base octave for simplicity)
function midiNotesToArpNotes(midiNotes: MidiNote[]): ArpNote[] {
  return midiNotes.map(note => ({
    id: note.id,
    degree: note.pitch,
    time: note.time,
    duration: note.duration,
    velocity: note.velocity,
    octaveOffset: 0, // New notes are in base octave
  }));
}

function extractArpFromBlock(block: Block): MidiNote[] {
  const allEvents = block.streams?.flatMap(s => s.events) || [];
  const pitchedEvents = allEvents.filter(e => e.pitch !== undefined);
  const arpNotes = eventsToArpNotes(pitchedEvents);
  return arpNotesToMidiNotes(arpNotes);
}

export function ArpEditor({ block, track, beatsPerBar }: ArpEditorProps) {
  const { updateBlock } = useProjectStore();

  const saveNotes = useCallback((notes: MidiNote[], trackId: string, blockId: string) => {
    const arpNotes = midiNotesToArpNotes(notes);
    const events = arpNotesToEvents(arpNotes);
    updateBlock(trackId, blockId, { streams: [{ events }] });
  }, [updateBlock]);

  const { notes, quantize, setQuantize, handleNotesChange, handleClear } = useMidiEditorState({
    block,
    track,
    extractNotes: extractArpFromBlock,
    saveNotes,
    defaultQuantize: DEFAULT_QUANTIZE,
  });

  const totalBeats = block.durationBars * beatsPerBar;

  return (
    <div className="flex flex-col h-full" data-editor-panel="arp">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <QuantizeSelect value={quantize} onChange={setQuantize} />

        <button
          onClick={handleClear}
          className="px-3 py-1.5 bg-background border border-border text-foreground rounded-lg text-sm font-medium hover:bg-border transition-colors"
        >
          Clear All
        </button>

        <div className="flex-1" />

        <span className="text-xs text-muted">
          {notes.length} {notes.length === 1 ? 'note' : 'notes'} | Click + drag to draw
        </span>
      </div>

      {/* Piano roll area using MidiEditor */}
      <MidiEditor
        blockStartBeat={block.startBar * beatsPerBar}
        rows={ARP_ROWS}
        notes={notes}
        onNotesChange={handleNotesChange}
        totalBeats={totalBeats}
        beatsPerBar={beatsPerBar}
        quantize={quantize}
      />
    </div>
  );
}

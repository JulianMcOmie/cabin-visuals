'use client';

import { useCallback } from 'react';
import { Block, Track } from '@daw/core/types';
import { useProjectStore } from '@daw/stores/projectStore';
import { MidiEditor, MidiNote, MidiRow } from '@daw/components/shared/MidiEditor';
import { QuantizeSelect } from '@daw/components/shared/QuantizeSelect';
import { useMidiEditorState } from '@daw/hooks/useMidiEditorState';
import { getAllEventsFromBlock, eventsToMidiNotesFixed, notesToEventsFixed } from '@daw/utils/midiConverters';
import { DEFAULT_QUANTIZE } from '@daw/core/constants';

interface MuteEditorProps {
  block: Block;
  track: Track;
  beatsPerBar: number;
}

// Single row for mute blackout (pitch 0 as marker)
const MUTE_PITCH = 0;

const MUTE_ROWS: MidiRow[] = [
  { pitch: MUTE_PITCH, label: 'Mute', color: '#991b1b' },
];

function extractMutesFromBlock(block: Block): MidiNote[] {
  return eventsToMidiNotesFixed(getAllEventsFromBlock(block), MUTE_PITCH, 'mute');
}

export function MuteEditor({ block, track, beatsPerBar }: MuteEditorProps) {
  const { updateBlock } = useProjectStore();

  const saveNotes = useCallback((notes: MidiNote[], trackId: string, blockId: string) => {
    const events = notesToEventsFixed(notes, MUTE_PITCH);
    updateBlock(trackId, blockId, { streams: [{ events }] });
  }, [updateBlock]);

  const { notes, quantize, setQuantize, handleNotesChange, handleClear } = useMidiEditorState({
    block,
    track,
    extractNotes: extractMutesFromBlock,
    saveNotes,
    defaultQuantize: DEFAULT_QUANTIZE,
  });

  const totalBeats = block.durationBars * beatsPerBar;

  return (
    <div className="flex flex-col h-full" data-editor-panel="mute">
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
          {notes.length} mute {notes.length === 1 ? 'region' : 'regions'} | Click + drag to draw
        </span>
      </div>

      {/* Midi editor with single row and larger row height */}
      <MidiEditor
        blockStartBeat={block.startBar * beatsPerBar}
        rows={MUTE_ROWS}
        notes={notes}
        onNotesChange={handleNotesChange}
        totalBeats={totalBeats}
        beatsPerBar={beatsPerBar}
        quantize={quantize}
        rowHeight={48}
      />
    </div>
  );
}

'use client';

import { useCallback } from 'react';
import { Block, Track } from '@daw/core/types';
import { useProjectStore } from '@daw/stores/projectStore';
import { MidiEditor, MidiNote, MidiRow } from '@daw/components/shared/MidiEditor';
import { QuantizeSelect } from '@daw/components/shared/QuantizeSelect';
import { useMidiEditorState } from '@daw/hooks/useMidiEditorState';
import { getAllEventsFromBlock, eventsToMidiNotes, notesToEvents } from '@daw/utils/midiConverters';

interface TransposeEditorProps {
  block: Block;
  track: Track;
  beatsPerBar: number;
}

const DEFAULT_QUANTIZE = 4;

// Transpose rows: -12 to +12 semitones (two octaves range)
// We use pitch = 60 + semitones (so -12 = 48, 0 = 60, +12 = 72)
const TRANSPOSE_ROWS: MidiRow[] = [
  { pitch: 72, label: '+12 (Oct)', color: '#ef4444' },
  { pitch: 71, label: '+11', color: '#f97316' },
  { pitch: 70, label: '+10', color: '#f97316' },
  { pitch: 69, label: '+9', color: '#eab308' },
  { pitch: 68, label: '+8', color: '#eab308' },
  { pitch: 67, label: '+7 (5th)', color: '#84cc16' },
  { pitch: 66, label: '+6', color: '#22c55e' },
  { pitch: 65, label: '+5 (4th)', color: '#22c55e' },
  { pitch: 64, label: '+4 (M3)', color: '#14b8a6' },
  { pitch: 63, label: '+3 (m3)', color: '#14b8a6' },
  { pitch: 62, label: '+2', color: '#06b6d4' },
  { pitch: 61, label: '+1', color: '#06b6d4' },
  { pitch: 60, label: '0', color: '#64748b' },
  { pitch: 59, label: '-1', color: '#8b5cf6' },
  { pitch: 58, label: '-2', color: '#8b5cf6' },
  { pitch: 57, label: '-3 (m3)', color: '#a855f7' },
  { pitch: 56, label: '-4 (M3)', color: '#a855f7' },
  { pitch: 55, label: '-5 (4th)', color: '#d946ef' },
  { pitch: 54, label: '-6', color: '#d946ef' },
  { pitch: 53, label: '-7 (5th)', color: '#ec4899' },
  { pitch: 52, label: '-8', color: '#f43f5e' },
  { pitch: 51, label: '-9', color: '#f43f5e' },
  { pitch: 50, label: '-10', color: '#ef4444' },
  { pitch: 49, label: '-11', color: '#ef4444' },
  { pitch: 48, label: '-12 (Oct)', color: '#dc2626' },
];

function extractTransposeFromBlock(block: Block): MidiNote[] {
  return eventsToMidiNotes(getAllEventsFromBlock(block), 'transpose');
}

export function TransposeEditor({ block, track, beatsPerBar }: TransposeEditorProps) {
  const { updateBlock } = useProjectStore();

  const saveNotes = useCallback((notes: MidiNote[], trackId: string, blockId: string) => {
    const events = notesToEvents(notes);
    updateBlock(trackId, blockId, { streams: [{ events }] });
  }, [updateBlock]);

  const { notes, quantize, setQuantize, handleNotesChange, handleClear } = useMidiEditorState({
    block,
    track,
    extractNotes: extractTransposeFromBlock,
    saveNotes,
    defaultQuantize: DEFAULT_QUANTIZE,
  });

  const totalBeats = block.durationBars * beatsPerBar;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface/50">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-foreground">
            Transpose: {track.name}
          </span>
          <span className="text-xs text-muted-foreground">
            Block: Bar {block.startBar + 1} ({block.durationBars} bar{block.durationBars > 1 ? 's' : ''})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <QuantizeSelect value={quantize} onChange={setQuantize} />
          <button
            onClick={handleClear}
            className="px-2 py-1 text-xs bg-surface hover:bg-muted border border-border rounded"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <MidiEditor
          blockStartBeat={block.startBar * beatsPerBar}
          notes={notes}
          rows={TRANSPOSE_ROWS}
          onNotesChange={handleNotesChange}
          totalBeats={totalBeats}
          quantize={quantize}
          beatsPerBar={beatsPerBar}
        />
      </div>
    </div>
  );
}

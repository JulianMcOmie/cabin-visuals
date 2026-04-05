'use client';

import { useCallback, useEffect, useState } from 'react';
import { Block, Track } from '@daw/core/types';
import { useProjectStore } from '@daw/stores/projectStore';
import { MidiEditor, MidiNote, MidiRow } from '@daw/components/shared/MidiEditor';
import { QuantizeSelect } from '@daw/components/shared/QuantizeSelect';
import { getAllEventsFromBlock, eventsToMidiNotesFixed } from '@daw/utils/midiConverters';

interface SwingEditorProps {
  block: Block;
  track: Track;
  beatsPerBar: number;
}

// Default swing amount (0-100%)
const DEFAULT_SWING_AMOUNT = 66;
const DEFAULT_QUANTIZE = 0.5;

// Swing events use pitch 0 as a control marker
const SWING_PITCH = 0;

const SWING_ROWS: MidiRow[] = [
  { pitch: SWING_PITCH, label: 'Swing', color: '#f472b6' },
];

function extractSwingFromBlock(block: Block): { notes: MidiNote[]; swingAmount: number } {
  const allEvents = getAllEventsFromBlock(block);

  // Calculate average velocity to determine swing amount
  let swingAmount = DEFAULT_SWING_AMOUNT;
  if (allEvents.length > 0) {
    const avgVelocity = allEvents.reduce((sum, e) => sum + e.velocity, 0) / allEvents.length;
    swingAmount = Math.round((avgVelocity / 127) * 100);
  }

  const notes = eventsToMidiNotesFixed(allEvents, SWING_PITCH, 'swing');

  return { notes, swingAmount };
}

function notesToSwingEvents(notes: MidiNote[], swingAmount: number) {
  const velocity = Math.round((swingAmount / 100) * 127);
  return notes.map(n => ({
    startTimeInBeats: n.time,
    pitch: SWING_PITCH,
    velocity,
    duration: n.duration,
  }));
}

export function SwingEditor({ block, track, beatsPerBar }: SwingEditorProps) {
  const { updateBlock } = useProjectStore();
  const [quantize, setQuantize] = useState(DEFAULT_QUANTIZE);
  const [notes, setNotes] = useState<MidiNote[]>([]);
  const [swingAmount, setSwingAmount] = useState(DEFAULT_SWING_AMOUNT);

  // Update notes when block ID changes
  const blockId = block.id;
  useEffect(() => {
    const { notes: extractedNotes, swingAmount: extractedAmount } = extractSwingFromBlock(block);
    setNotes(extractedNotes);
    setSwingAmount(extractedAmount);
  }, [blockId]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalBeats = block.durationBars * beatsPerBar;

  // Handle notes change from MidiEditor
  const handleNotesChange = useCallback((newNotes: MidiNote[]) => {
    setNotes(newNotes);
  }, []);

  // Handle swing amount change
  const handleSwingAmountChange = useCallback((newAmount: number) => {
    setSwingAmount(newAmount);
    // Update all note velocities to match new swing amount
    const velocity = Math.round((newAmount / 100) * 127);
    setNotes(prev => prev.map(n => ({ ...n, velocity })));
  }, []);

  // Auto-save when notes or swing amount change
  useEffect(() => {
    const timeout = setTimeout(() => {
      const events = notesToSwingEvents(notes, swingAmount);
      updateBlock(track.id, block.id, { streams: [{ events }] });
    }, 500);
    return () => clearTimeout(timeout);
  }, [notes, swingAmount, track.id, block.id, updateBlock]);

  // Fill off-beats (classic swing pattern)
  const handleFillOffbeats = useCallback(() => {
    const newNotes: MidiNote[] = [];
    const velocity = Math.round((swingAmount / 100) * 127);
    // Place markers on all 8th note off-beats
    for (let i = 0.5; i < totalBeats; i += 1) {
      newNotes.push({
        id: `swing-${i}-${Date.now()}`,
        pitch: SWING_PITCH,
        time: i,
        duration: 0.25,
        velocity,
      });
    }
    setNotes(newNotes);
  }, [totalBeats, swingAmount]);

  // Fill all grid positions
  const handleFillAll = useCallback(() => {
    const newNotes: MidiNote[] = [];
    const velocity = Math.round((swingAmount / 100) * 127);
    for (let i = 0; i < totalBeats; i += quantize) {
      newNotes.push({
        id: `swing-${i}-${Date.now()}`,
        pitch: SWING_PITCH,
        time: i,
        duration: quantize,
        velocity,
      });
    }
    setNotes(newNotes);
  }, [totalBeats, quantize, swingAmount]);

  // Clear all
  const handleClear = useCallback(() => {
    setNotes([]);
  }, []);

  // Get swing feel description
  const getSwingDescription = (amount: number): string => {
    if (amount < 10) return 'Straight';
    if (amount < 40) return 'Light swing';
    if (amount < 60) return 'Medium swing';
    if (amount < 80) return 'Triplet feel';
    return 'Heavy swing';
  };

  return (
    <div className="flex flex-col h-full" data-editor-panel="swing">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border">
        {/* Swing amount slider */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Swing:</span>
          <input
            type="range"
            min="0"
            max="100"
            value={swingAmount}
            onChange={(e) => handleSwingAmountChange(Number(e.target.value))}
            className="w-24 h-2 bg-border rounded-lg appearance-none cursor-pointer accent-pink-500"
          />
          <span className="text-xs text-foreground w-8">{swingAmount}%</span>
          <span className="text-xs text-muted">({getSwingDescription(swingAmount)})</span>
        </div>

        <div className="w-px h-4 bg-border" />

        <QuantizeSelect value={quantize} onChange={setQuantize} />

        <button
          onClick={handleFillOffbeats}
          className="px-3 py-1.5 bg-pink-500/20 border border-pink-500/50 text-pink-300 rounded-lg text-sm font-medium hover:bg-pink-500/30 transition-colors"
        >
          Fill Off-beats
        </button>

        <button
          onClick={handleFillAll}
          className="px-3 py-1.5 bg-background border border-border text-foreground rounded-lg text-sm font-medium hover:bg-border transition-colors"
        >
          Fill All
        </button>

        <button
          onClick={handleClear}
          className="px-3 py-1.5 bg-background border border-border text-foreground rounded-lg text-sm font-medium hover:bg-border transition-colors"
        >
          Clear
        </button>

        <div className="flex-1" />

        <span className="text-xs text-muted">
          {notes.length} marker{notes.length === 1 ? '' : 's'} | Click + drag to draw
        </span>
      </div>

      {/* Midi editor with single row and larger row height */}
      <MidiEditor
        blockStartBeat={block.startBar * beatsPerBar}
        rows={SWING_ROWS}
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

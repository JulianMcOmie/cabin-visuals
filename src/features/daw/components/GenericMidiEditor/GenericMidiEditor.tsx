'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Block, Track } from '@daw/core/types';
import { useProjectStore } from '@daw/stores/projectStore';
import { MidiEditor, MidiNote, generateRows, generateAutomationRows } from '@daw/components/shared/MidiEditor';
import { QuantizeSelect } from '@daw/components/shared/QuantizeSelect';
import { useMidiEditorState } from '@daw/hooks/useMidiEditorState';
import { useUIStore } from '@daw/stores/uiStore';
import { getInstrument } from '@daw/instruments';
import { SettingsSchema } from '@daw/instruments/types';
import { getPlugin } from '@daw/plugins';
import { getAllEventsFromBlock, eventsToMidiNotes, notesToEvents } from '@daw/utils/midiConverters';
import { DEFAULT_QUANTIZE } from '@daw/core/constants';

interface GenericMidiEditorProps {
  block: Block;
  track: Track;
  beatsPerBar: number;
  instrumentId?: string;
}

function extractNotesFromBlock(block: Block): MidiNote[] {
  const allEvents = getAllEventsFromBlock(block);
  // Get all pitched events
  const pitchedEvents = allEvents.filter(e => e.pitch !== undefined);
  return eventsToMidiNotes(pitchedEvents, 'note');
}

export function GenericMidiEditor({ block, track, beatsPerBar, instrumentId }: GenericMidiEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);
  const { updateBlockEvents } = useProjectStore();

  const tracks = useProjectStore((s) => s.project.tracks);
  const instrument = getInstrument(instrumentId);
  const isAutomation = !!track.automationConfig;

  // For automation tracks, find the target schema to build value-labeled rows
  const automationData = useMemo(() => {
    if (!isAutomation || !track.automationConfig?.targetParam) return null;
    const parentTrack = track.parentId ? tracks[track.parentId] : undefined;
    const parentInstrument = parentTrack?.instrumentId ? getInstrument(parentTrack.instrumentId) : undefined;

    let schema: SettingsSchema | undefined;
    if (track.automationConfig.pluginInstanceId) {
      const pi = parentTrack?.visualPlugins?.find(p => p.id === track.automationConfig!.pluginInstanceId);
      if (pi) schema = getPlugin(pi.pluginId)?.settingsSchema as SettingsSchema | undefined;
    } else {
      schema = parentInstrument?.settingsSchema as SettingsSchema | undefined;
    }
    // "enabled" is a virtual on/off param — just 2 rows
    if (track.automationConfig.targetParam === 'enabled') {
      return {
        rows: [
          { pitch: 1, label: 'On', color: 'hsl(120, 70%, 45%)' },
          { pitch: 0, label: 'Off', color: 'hsl(0, 70%, 45%)' },
        ],
        rangeLabels: [
          { startPitch: 1, endPitch: 1, label: 'On' },
          { startPitch: 0, endPitch: 0, label: 'Off' },
        ],
      };
    }

    if (!schema) return null;

    const field = schema[track.automationConfig.targetParam];
    if (!field || field.type !== 'number') return null;
    const noteRange = parentInstrument?.noteRange ?? { min: 36, max: 96 };
    return generateAutomationRows(
      noteRange,
      field.min ?? 0,
      field.max ?? 1,
      field.label,
    );
  }, [isAutomation, track.automationConfig, track.parentId, tracks]);

  const rows = useMemo(() => {
    if (automationData) return automationData.rows;
    return generateRows(instrument?.noteRange);
  }, [automationData, instrument?.noteRange]);

  const rangeLabels = automationData ? automationData.rangeLabels : instrument?.rangeLabels;
  const [snapEnabled, setSnapEnabled] = useState(true);

  const saveNotes = useCallback((notes: MidiNote[], trackId: string, blockId: string) => {
    const events = notesToEvents(notes);
    updateBlockEvents(trackId, blockId, events);
  }, [updateBlockEvents]);

  const midiPixelsPerBeat = useUIStore((s) => s.midiPixelsPerBeat);
  const midiRowScale = useUIStore((s) => s.midiRowScale);

  const { notes, quantize, setQuantize, handleNotesChange, handleClear } = useMidiEditorState({
    block,
    track,
    extractNotes: extractNotesFromBlock,
    saveNotes,
    defaultQuantize: DEFAULT_QUANTIZE,
  });

  const totalBeats = block.durationBars * beatsPerBar;

  // Scroll to center of instrument range on mount
  useEffect(() => {
    if (hasScrolledRef.current || !containerRef.current) return;

    const scrollContainer = containerRef.current.querySelector('.overflow-auto');
    if (scrollContainer) {
      const rowHeight = Math.round(28 * midiRowScale);
      const range = instrument?.noteRange;
      const centerPitch = range ? Math.round((range.min + range.max) / 2) : 72;
      const centerIdx = rows.findIndex(r => r.pitch <= centerPitch);
      const targetIdx = centerIdx === -1 ? 0 : centerIdx;
      const visibleHeight = scrollContainer.clientHeight;
      const scrollTop = Math.max(0, targetIdx * rowHeight - visibleHeight / 2);
      scrollContainer.scrollTop = scrollTop;
      hasScrolledRef.current = true;
    }
  }, [rows, instrument?.noteRange]);

  // Reset scroll flag when block changes
  useEffect(() => {
    hasScrolledRef.current = false;
  }, [block.id]);

  // Compute word labels for text display instruments (pitch 48 = next word trigger)
  const noteLabels = useMemo(() => {
    if (instrumentId !== 'textDisplay') return undefined;
    const text = (track.instrumentSettings?.text as string) ?? '';
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return undefined;

    const labels = new Map<string, string>();
    // Sort pitch-48 notes by time to assign words in order
    const wordNotes = notes.filter(n => n.pitch === 48).sort((a, b) => a.time - b.time);
    wordNotes.forEach((note, i) => {
      labels.set(note.id, words[i % words.length]);
    });
    return labels;
  }, [instrumentId, track.instrumentSettings?.text, notes]);

  return (
    <div ref={containerRef} className="flex flex-col h-full" data-editor-panel="generic">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <QuantizeSelect value={quantize} onChange={setQuantize} />

        <button
          onClick={() => setSnapEnabled(!snapEnabled)}
          className={`px-2.5 py-1.5 border rounded-lg text-xs font-medium transition-colors ${
            snapEnabled
              ? 'bg-accent-from/20 border-accent-from text-accent-from'
              : 'bg-background border-border text-muted-foreground hover:border-muted-foreground'
          }`}
          title={snapEnabled ? 'Snap to grid (on)' : 'Snap to grid (off)'}
        >
          Snap
        </button>

        <button
          onClick={handleClear}
          className="px-3 py-1.5 bg-background border border-border text-foreground rounded-lg text-sm font-medium hover:bg-border transition-colors"
        >
          Clear All
        </button>

        <div className="flex-1" />

        {/* Zoom controls */}
        <div className="flex items-center gap-3">
          {/* Horizontal Zoom */}
          <div className="flex items-center gap-1.5" title="Horizontal zoom">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="text-muted-foreground">
              <path d="M1 7h12M1 7l2.5-2.5M1 7l2.5 2.5M13 7l-2.5-2.5M13 7l-2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <input
              type="range"
              min="5"
              max="200"
              value={midiPixelsPerBeat}
              onChange={(e) => useUIStore.getState().setMidiPixelsPerBeat(Number(e.target.value))}
              className="w-14 h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-accent-from"
            />
          </div>

          {/* Vertical Zoom */}
          <div className="flex items-center gap-1.5" title="Vertical zoom (note height)">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="text-muted-foreground">
              <path d="M7 1v12M7 1L4.5 3.5M7 1l2.5 2.5M7 13l-2.5-2.5M7 13l2.5-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={midiRowScale}
              onChange={(e) => useUIStore.getState().setMidiRowScale(Number(e.target.value))}
              className="w-14 h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-accent-from"
            />
          </div>
        </div>
      </div>

      {/* Piano roll area using MidiEditor */}
      <MidiEditor
        blockStartBeat={block.startBar * beatsPerBar}
        rows={rows}
        notes={notes}
        onNotesChange={handleNotesChange}
        totalBeats={totalBeats}
        beatsPerBar={beatsPerBar}
        quantize={quantize}
        snapEnabled={snapEnabled}
        pixelsPerBeat={midiPixelsPerBeat}
        rowHeight={Math.round(28 * midiRowScale)}
        rangeLabels={rangeLabels}
        noteLabels={noteLabels}
      />
    </div>
  );
}

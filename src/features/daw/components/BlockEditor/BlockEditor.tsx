'use client';

import { useMemo } from 'react';
import { useUIStore } from '@daw/stores/uiStore';
import { useProjectStore } from '@daw/stores/projectStore';
import { ChordEditorPanel } from '../ChordEditor';
import { DrumEditorPanel } from '../DrumEditor';
import { ArpEditorPanel } from '../ArpEditor';
import { SuppressEditorPanel } from '../SuppressEditor';
import { MuteEditorPanel } from '../MuteEditor';
import { TransposeEditorPanel } from '../TransposeEditor';
import { RhythmEditorPanel } from '../RhythmEditor';
import { SwingEditorPanel } from '../SwingEditor';
import { GenericMidiEditorPanel } from '../GenericMidiEditor';
import { WaveformEditorPanel } from '../WaveformEditor';
import { PatternCategory } from '@daw/core/types';
import { getInstrument, getInheritedMidiInstrumentId } from '@daw/instruments';

export type EditorType = 'chord' | 'drum' | 'arp' | 'suppress' | 'mute' | 'transpose' | 'rhythm' | 'swing' | 'waveform' | 'generic' | null;

/**
 * Maps pattern category to the appropriate editor type.
 */
function getEditorForCategory(category: PatternCategory): EditorType {
  switch (category) {
    case 'drums':
      return 'drum';
    case 'chords':
    case 'bass':
      return 'chord';
    case 'arp':
      return 'arp';
    case 'rhythm':
      return 'rhythm';
    case 'suppress':
      return 'suppress';
    case 'mute':
      return 'mute';
    case 'swing':
      return 'swing';
    case 'rest':
    case 'modifier':
      return null;
    default:
      return null;
  }
}

export function BlockEditor() {
  const selectedBlockIds = useUIStore((s) => s.selectedBlockIds);
  const selectedTrackId = useUIStore((s) => s.selectedTrackId);
  const { project } = useProjectStore();

  const selectedBlockId = selectedBlockIds.size === 1 ? Array.from(selectedBlockIds)[0] : null;
  const selectedTrack = selectedTrackId ? project.tracks[selectedTrackId] ?? null : null;
  const selectedBlock = selectedTrack?.blocks.find(b => b.id === selectedBlockId) ?? null;

  // Determine which editor type to show
  const editorType = useMemo((): EditorType => {
    if (!selectedBlock || !selectedTrack) return null;

    // Audio tracks with audio data use the waveform editor
    if (selectedTrack.instrumentId === 'audioPlayer' && selectedBlock.audioData) return 'waveform';

    // Automation tracks always use generic MIDI editor (with value rows)
    if (selectedTrack.automationConfig) return 'generic';

    const { patternCategory, typeId } = selectedTrack;

    if (typeId === 'rhythm') return 'rhythm';
    if (typeId === 'transpose') return 'transpose';
    if (typeId === 'swing') return 'swing';
    if (typeId === 'suppress') return 'suppress';
    if (typeId === 'mute') return 'mute';

    if (patternCategory) {
      const categoryEditor = getEditorForCategory(patternCategory);
      if (categoryEditor) return categoryEditor;
    }

    // Check instrument's editor type (inherit from parent if needed)
    const effectiveInstrumentId = getInheritedMidiInstrumentId(selectedTrack, project.tracks);
    const instrument = getInstrument(effectiveInstrumentId);
    if (instrument?.editorType) {
      return instrument.editorType;
    }

    // Default to generic MIDI editor
    return 'generic';
  }, [selectedBlock, selectedTrack, project.tracks]);

  // Render the editor content based on type
  const renderEditor = () => {
    switch (editorType) {
      case 'chord':
        return <ChordEditorPanel />;
      case 'drum':
        return <DrumEditorPanel />;
      case 'arp':
        return <ArpEditorPanel />;
      case 'suppress':
        return <SuppressEditorPanel />;
      case 'mute':
        return <MuteEditorPanel />;
      case 'transpose':
        return <TransposeEditorPanel />;
      case 'rhythm':
        return <RhythmEditorPanel />;
      case 'swing':
        return <SwingEditorPanel />;
      case 'waveform':
        return <WaveformEditorPanel />;
      case 'generic':
        return <GenericMidiEditorPanel />;
      default:
        return (
          <div className="flex-1 flex flex-col items-center justify-center text-muted gap-3 pt-8">
            {/* Block icon */}
            <svg className="w-12 h-12 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p className="text-sm">Select a block to edit</p>
          </div>
        );
    }
  };

  return (
    <div className="h-full flex flex-col bg-surface border-t border-border">
      <div className="flex-1 overflow-hidden">
        {renderEditor()}
      </div>
    </div>
  );
}

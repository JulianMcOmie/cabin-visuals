import { useCallback, useEffect, useRef, useState } from 'react';
import { Block, Track } from '@daw/core/types';
import { MidiNote } from '@daw/components/shared/MidiEditor';

interface UseMidiEditorStateOptions {
  block: Block;
  track: Track;
  extractNotes: (block: Block) => MidiNote[];
  saveNotes: (notes: MidiNote[], trackId: string, blockId: string) => void;
  defaultQuantize: number;
}

/** Cheap content fingerprint for a block's event data. */
function blockFingerprint(block: Block): string {
  let hash = block.id;
  for (const stream of block.streams) {
    hash += `:${stream.events.length}`;
    // Sample first and last events for change detection
    if (stream.events.length > 0) {
      const first = stream.events[0];
      const last = stream.events[stream.events.length - 1];
      hash += `,${first.startTimeInBeats},${first.pitch},${first.duration}`;
      if (stream.events.length > 1) {
        hash += `,${last.startTimeInBeats},${last.pitch},${last.duration}`;
      }
    }
  }
  return hash;
}

export function useMidiEditorState({
  block,
  track,
  extractNotes,
  saveNotes,
  defaultQuantize,
}: UseMidiEditorStateOptions) {
  const [quantize, setQuantize] = useState(defaultQuantize);
  const [notes, setNotes] = useState<MidiNote[]>(() => extractNotes(block));
  // Track whether the last change was from local editing (to avoid re-extracting our own saves)
  const localEditRef = useRef(false);
  const prevBlockIdRef = useRef(block.id);

  // Update notes when block content changes (handles undo/redo and block switches)
  const fingerprint = blockFingerprint(block);
  useEffect(() => {
    const blockChanged = prevBlockIdRef.current !== block.id;
    prevBlockIdRef.current = block.id;

    if (localEditRef.current && !blockChanged) {
      // This change came from our own auto-save writing back to the store — skip
      localEditRef.current = false;
      return;
    }
    localEditRef.current = false;
    setNotes(extractNotes(block));
  }, [fingerprint]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle notes change
  const handleNotesChange = useCallback((newNotes: MidiNote[]) => {
    setNotes(newNotes);
  }, []);

  // Auto-save when notes change
  useEffect(() => {
    const timeout = setTimeout(() => {
      localEditRef.current = true;
      saveNotes(notes, track.id, block.id);
    }, 500);
    return () => clearTimeout(timeout);
  }, [notes, track.id, block.id, saveNotes]);

  // Clear all
  const handleClear = useCallback(() => {
    setNotes([]);
  }, []);

  return {
    notes,
    setNotes,
    quantize,
    setQuantize,
    handleNotesChange,
    handleClear,
  };
}

'use client';

import { EditorPanel } from '@daw/components/shared/EditorPanel';
import { GenericMidiEditor } from './GenericMidiEditor';

/**
 * GenericMidiEditorPanel renders a generic MIDI piano roll editor.
 * Used as the default editor when no specific editor type matches.
 */
export function GenericMidiEditorPanel() {
  return (
    <EditorPanel>
      {({ block, track, beatsPerBar, instrumentId }) => (
        <GenericMidiEditor block={block} track={track} beatsPerBar={beatsPerBar} instrumentId={instrumentId} />
      )}
    </EditorPanel>
  );
}

'use client';

import { EditorPanel } from '@daw/components/shared/EditorPanel';
import { ChordEditor } from './ChordEditor';
import { CATEGORY_PRESETS } from '@daw/core/presets';
import { CATEGORY_COLORS } from '@daw/utils/colors';

/**
 * ChordEditorPanel renders the chord editor UI.
 * BlockEditor determines when to show this panel based on track properties.
 */
export function ChordEditorPanel() {
  return (
    <EditorPanel presets={CATEGORY_PRESETS.chords} color={CATEGORY_COLORS.chords}>
      {({ block, track, beatsPerBar, instrumentId }) => (
        <ChordEditor block={block} track={track} beatsPerBar={beatsPerBar} instrumentId={instrumentId} />
      )}
    </EditorPanel>
  );
}

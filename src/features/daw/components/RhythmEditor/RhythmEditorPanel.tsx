'use client';

import { EditorPanel } from '@daw/components/shared/EditorPanel';
import { RhythmEditor } from './RhythmEditor';
import { CATEGORY_PRESETS } from '@daw/core/presets';
import { CATEGORY_COLORS } from '@daw/utils/colors';

/**
 * RhythmEditorPanel renders the rhythm editor UI.
 * BlockEditor determines when to show this panel based on track properties.
 */
export function RhythmEditorPanel() {
  return (
    <EditorPanel presets={CATEGORY_PRESETS.rhythm} color={CATEGORY_COLORS.rhythm}>
      {({ block, track, beatsPerBar }) => (
        <RhythmEditor block={block} track={track} beatsPerBar={beatsPerBar} />
      )}
    </EditorPanel>
  );
}

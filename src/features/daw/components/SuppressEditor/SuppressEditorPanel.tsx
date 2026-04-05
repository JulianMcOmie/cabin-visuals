'use client';

import { EditorPanel } from '@daw/components/shared/EditorPanel';
import { SuppressEditor } from './SuppressEditor';
import { CATEGORY_PRESETS } from '@daw/core/presets';
import { CATEGORY_COLORS } from '@daw/utils/colors';

/**
 * SuppressEditorPanel renders the suppress editor UI.
 * BlockEditor determines when to show this panel based on track properties.
 */
export function SuppressEditorPanel() {
  return (
    <EditorPanel presets={CATEGORY_PRESETS.suppress} color={CATEGORY_COLORS.suppress}>
      {({ block, track, beatsPerBar }) => (
        <SuppressEditor block={block} track={track} beatsPerBar={beatsPerBar} />
      )}
    </EditorPanel>
  );
}

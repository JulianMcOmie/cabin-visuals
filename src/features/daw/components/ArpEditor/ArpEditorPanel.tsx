'use client';

import { EditorPanel } from '@daw/components/shared/EditorPanel';
import { ArpEditor } from './ArpEditor';
import { CATEGORY_PRESETS } from '@daw/core/presets';
import { CATEGORY_COLORS } from '@daw/utils/colors';

/**
 * ArpEditorPanel renders the arp editor UI.
 * BlockEditor determines when to show this panel based on track properties.
 */
export function ArpEditorPanel() {
  return (
    <EditorPanel presets={CATEGORY_PRESETS.arp} color={CATEGORY_COLORS.arp}>
      {({ block, track, beatsPerBar }) => (
        <ArpEditor block={block} track={track} beatsPerBar={beatsPerBar} />
      )}
    </EditorPanel>
  );
}

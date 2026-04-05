import { useEffect, useRef } from 'react';
import { useProjectStore } from '@daw/stores/projectStore';
import { useUIStore } from '@daw/stores/uiStore';
import { getVisualPlaybackEngine } from '@daw/core/visualPlayback';
import { Project } from '@daw/core/types';

/**
 * Syncs the visual playback engine with the current project.
 * Calls resolveFromProject() whenever the project changes.
 * Defers resolution during drag operations until the drag ends.
 */
export function useVisualSync() {
  const project = useProjectStore((s) => s.project);
  const dragType = useUIStore((s) => s.dragState.type);
  const prevProjectRef = useRef<Project | null>(null);
  const pendingResolveRef = useRef(false);

  useEffect(() => {
    if (project === prevProjectRef.current) return;
    prevProjectRef.current = project;

    // During drags, defer resolution until drop
    if (dragType !== null) {
      pendingResolveRef.current = true;
      return;
    }

    const engine = getVisualPlaybackEngine();
    engine.resolveFromProject(project);
    pendingResolveRef.current = false;
  }, [project, dragType]);

  // When drag ends, flush any pending resolution
  useEffect(() => {
    if (dragType === null && pendingResolveRef.current) {
      const engine = getVisualPlaybackEngine();
      engine.resolveFromProject(prevProjectRef.current!);
      pendingResolveRef.current = false;
    }
  }, [dragType]);
}

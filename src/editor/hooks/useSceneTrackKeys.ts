import { useEffect } from 'react'
import { useProjectStore } from '../store/ProjectStore'
import { useUIStore } from '../store/UIStore'
import { sceneTrackId } from '../core/sceneTrack'
import { selectNewTrack } from '../utils/selection'

// ⌘/Ctrl+Shift+S: show the active scene's SCENE INSTRUMENT (core/sceneTrack.ts)
// and select it, so its inspector is one keystroke away; press again to hide it.
// Mount once (App), beside useGroupKeys - S for scene, next to G for group.
//
// Hiding is not destructive: `setSceneTrackEnabled` keeps the transform and the
// lanes on the Scene. It does stop them RESOLVING, though, so a hidden scene
// instrument affects nothing - which is what makes the toggle safe to press
// while you are still deciding.
//
// Main is skipped. It composes the other scenes rather than holding objects, so
// there is nothing for a scene-wide mover or backdrop colorizer to act on.
export function useSceneTrackKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || (e.key !== 's' && e.key !== 'S')) return
      const store = useProjectStore.getState()
      const scene = store.scenes[store.activeSceneId]
      if (!scene || scene.isMain) return
      // Claimed only once we know we'll act on it, so ⌘⇧S still reaches the
      // browser on Main rather than silently doing nothing.
      e.preventDefault()
      const next = !scene.sceneTrackEnabled
      store.setSceneTrackEnabled(scene.id, next)
      if (next) {
        selectNewTrack(sceneTrackId(scene.id))
      } else {
        // The row it was pointing at no longer exists; leaving the selection
        // behind strands the inspector on a track the timeline cannot show.
        const ui = useUIStore.getState()
        if (ui.selectedTrackId === sceneTrackId(scene.id)) {
          useUIStore.setState({ selectedTrackId: null, selectedTrackIds: new Set() })
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

import { useEffect } from 'react'
import { useProjectStore } from '../store/ProjectStore'
import { useUIStore } from '../store/UIStore'
import { selectNewTrack } from '../utils/selection'

// ⌘/Ctrl+Shift+G: wrap the selected tracks in a group track; when the
// selection is exactly one GROUP, dissolve it instead (its members become the
// selection so a second press re-groups). Mount once (App).
export function useGroupKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || (e.key !== 'g' && e.key !== 'G')) return
      e.preventDefault()
      const ui = useUIStore.getState()
      const ids = new Set(ui.selectedTrackIds)
      if (ui.selectedTrackId) ids.add(ui.selectedTrackId)
      if (ids.size === 0) return
      const store = useProjectStore.getState()
      if (ids.size === 1) {
        const only = store.tracks[[...ids][0]]
        if (only?.type === 'group') {
          const memberIds = only.childIds.filter((cid) => {
            const c = store.tracks[cid]
            return !!c && c.type !== 'automation' && c.type !== 'ability'
          })
          store.ungroupTrack(only.id)
          useUIStore.setState({
            selectedTrackId: memberIds[0] ?? null,
            selectedTrackIds: new Set(memberIds),
          })
          return
        }
      }
      const groupId = store.groupTracks([...ids])
      if (groupId) selectNewTrack(groupId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

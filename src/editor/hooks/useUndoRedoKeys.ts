import { useEffect } from 'react'
import { useHistoryStore } from '../store/HistoryStore'

// ⌘/Ctrl+Z = undo · ⌘/Ctrl+Shift+Z = redo · Ctrl+Y = redo (Windows). Mount once.
export function useUndoRedoKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (!(e.metaKey || e.ctrlKey)) return
      const { undo, redo } = useHistoryStore.getState()
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

import { useEffect, useState } from 'react'
import * as projectStorage from '../../persistence/projectStorage'
import { hydrate } from '../../persistence/serialize'
import { startAutosave, useSaveStatus } from '../../persistence/autosave'
import { useHistoryStore } from '../store/HistoryStore'

/**
 * Binds this editor instance to its project row: reads ?project=<id> from the
 * URL, loads + hydrates the document, then arms autosave — in that order, so
 * the hydrate itself can't fire a redundant save. Without an id the editor
 * runs in-memory only (nothing persists), same as before persistence existed.
 */
export function useProjectPersistence() {
  // The editor is client-only (ssr:false), so the URL is read directly; the id
  // is fixed for the lifetime of the mount.
  const [projectId] = useState(() => new URLSearchParams(window.location.search).get('project'))

  useEffect(() => {
    if (!projectId) return
    let stop: (() => void) | undefined
    let cancelled = false

    ;(async () => {
      try {
        const { document } = await projectStorage.load(projectId)
        if (cancelled) return
        hydrate(document)
        // The hydrate setState must not be undoable — Ctrl+Z right after open
        // would otherwise restore an empty project.
        useHistoryStore.getState().reset()
        stop = startAutosave(projectId)
      } catch (err) {
        console.error('Failed to load project', err)
        if (!cancelled) useSaveStatus.setState({ status: 'error' })
      }
    })()

    return () => {
      cancelled = true
      stop?.()
    }
  }, [projectId])
}

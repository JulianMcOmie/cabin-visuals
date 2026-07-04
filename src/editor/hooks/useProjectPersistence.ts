import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import * as projectStorage from '../../persistence/projectStorage'
import { hydrate } from '../../persistence/serialize'
import { emptyDocument } from '../../persistence/types'
import { startAutosave, useSaveStatus } from '../../persistence/autosave'
import { useHistoryStore } from '../store/HistoryStore'

/**
 * Binds this editor instance to its project row: reads ?project=<id> from the
 * route, loads + hydrates the document, then arms autosave — in that order, so
 * the hydrate itself can't fire a redundant save. Without an id the editor
 * runs in-memory only (nothing persists), same as before persistence existed.
 *
 * The id comes from useSearchParams — reactive, and correct during render —
 * NOT a one-shot window.location read. That read latched the first project for
 * the component's lifetime: query-only navigations don't remount the page, and
 * even across a remount window.location can still show the previous URL at
 * first render. Either way the editor stayed bound to the first project — the
 * "every project opens the same data" bug.
 */
export function useProjectPersistence() {
  const projectId = useSearchParams().get('project')

  useEffect(() => {
    if (!projectId) return
    let stop: (() => void) | undefined
    let cancelled = false

    // Blank slate first: the stores are module singletons that survive client
    // navigation, so without this a rebind briefly shows — and on a failed
    // load, indefinitely shows — the previous project's data.
    hydrate(emptyDocument())
    useHistoryStore.getState().reset()

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

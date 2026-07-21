import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import * as projectStorage from '../../persistence/projectStorage'
import { hydrate } from '../../persistence/serialize'
import { emptyDocument } from '../../persistence/types'
import { startAutosave, useSaveStatus } from '../../persistence/autosave'
import { justAdopted } from '../../persistence/adoptionHandoff'
import { rememberLastProject } from '../../persistence/lastProject'
import { getSupabase } from '../../persistence/supabase'
import { useHistoryStore } from '../store/HistoryStore'
import { useUIStore } from '../store/UIStore'
import { getTemplate } from '../../templates'

/**
 * Binds this editor instance to its project row: reads ?project=<id> from the
 * route, loads + hydrates the document, then arms autosave - in that order, so
 * the hydrate itself can't fire a redundant save. Without an id the editor
 * runs in-memory only (nothing persists), same as before persistence existed.
 *
 * The id comes from useSearchParams - reactive, and correct during render -
 * NOT a one-shot window.location read. That read latched the first project for
 * the component's lifetime: query-only navigations don't remount the page, and
 * even across a remount window.location can still show the previous URL at
 * first render. Either way the editor stayed bound to the first project - the
 * "every project opens the same data" bug.
 */
export function useProjectPersistence() {
  const search = useSearchParams()
  const projectId = search.get('project')
  const templateId = search.get('template')

  // Template demo mode: ?template=<id> (and no project) hydrates a canned
  // document straight into the stores - no DB row, no autosave, works signed
  // out. The whole point is that a stranger can play with a full project one
  // click after landing; signing up and saving comes later.
  useEffect(() => {
    if (projectId || !templateId) return
    const tpl = getTemplate(templateId)
    if (!tpl) return
    hydrate(emptyDocument())
    hydrate(structuredClone(tpl.document))
    useUIStore.getState().setProjectName(tpl.name)
    useHistoryStore.getState().reset()
    return () => {
      useUIStore.getState().setProjectName(null)
    }
  }, [projectId, templateId])

  useEffect(() => {
    if (!projectId) return

    // Remember the bind (per user) so the landing page's "Continue creating"
    // can come straight back here. Fire-and-forget: navigation never waits on it.
    const remember = () => {
      void getSupabase().auth.getUser().then(({ data }) => {
        if (data.user) rememberLastProject(data.user.id, projectId)
      }).catch(() => {})
    }

    // Anonymous adoption just seeded this row FROM the in-memory document -
    // memory is the source of truth, so keep it and only arm autosave. The
    // normal blank-slate → reload path would wipe and re-fill the stores with
    // the same data, visibly flapping everything derived from them (the
    // first-run tutorial snaps back a step, the timeline empties for a beat).
    const handoff = justAdopted(projectId)
    if (handoff) {
      useUIStore.getState().setProjectName(handoff.name)
      remember()
      // The row was inserted moments ago and nothing has saved over it, so its
      // rev is whatever create() reported - carried through the handoff rather
      // than assumed, since assuming is how stale-rev bugs start.
      const stopAutosave = startAutosave(projectId, handoff.rev)
      return () => {
        stopAutosave()
        useUIStore.getState().setProjectName(null)
      }
    }

    let stop: (() => void) | undefined
    let cancelled = false

    // Blank slate first: the stores are module singletons that survive client
    // navigation, so without this a rebind briefly shows - and on a failed
    // load, indefinitely shows - the previous project's data.
    hydrate(emptyDocument())
    useHistoryStore.getState().reset()

    ;(async () => {
      try {
        const { name, document, rev } = await projectStorage.load(projectId)
        if (cancelled) return
        remember()
        useUIStore.getState().setProjectName(name)
        hydrate(document)
        // The hydrate setState must not be undoable - Ctrl+Z right after open
        // would otherwise restore an empty project.
        useHistoryStore.getState().reset()
        stop = startAutosave(projectId, rev)
      } catch (err) {
        console.error('Failed to load project', err)
        if (!cancelled) useSaveStatus.setState({ status: 'error' })
      }
    })()

    return () => {
      cancelled = true
      stop?.()
      useUIStore.getState().setProjectName(null)
    }
  }, [projectId])
}

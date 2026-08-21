import { useEffect, useLayoutEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import * as projectStorage from '../../persistence/projectStorage'
import { hydrate } from '../../persistence/serialize'
import { emptyDocument } from '../../persistence/types'
import { upgradeDocument } from '../../persistence/upgrade'
import { startAutosave, useSaveStatus } from '../../persistence/autosave'
import { justAdopted } from '../../persistence/adoptionHandoff'
import { rememberLastProject, forgetLastProject } from '../../persistence/lastProject'
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
  const router = useRouter()
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
    // Same upgrade walk applyTemplate does: template documents are authored
    // against an older schema (schemaVersion 8 - text params, no lyric
    // clips), and hydrating them raw left every Text Display track with no
    // clip notes, so the demo showed no words at all.
    hydrate(upgradeDocument(structuredClone(tpl.document)))
    useUIStore.getState().setProjectName(tpl.name)
    useHistoryStore.getState().reset()
    return () => {
      useUIStore.getState().setProjectName(null)
    }
  }, [projectId, templateId])

  // The loading flag goes up BEFORE first paint (layout effect): the bind
  // blanks the stores below, and without this the timeline paints the
  // empty-scene "Let's start composing" list for the whole load window - an
  // empty store while the row is on the wire is a loading state, not an
  // empty project. Cleared when hydrate lands (or the load fails) in the
  // effect below; the cleanup covers unmounts and rebinds mid-flight.
  useLayoutEffect(() => {
    if (!projectId) return
    useUIStore.getState().setDocumentLoading(true)
    return () => {
      useUIStore.getState().setDocumentLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (!projectId) return

    // Remember the bind (per user) so the landing page's "Continue creating"
    // can come straight back here. Fire-and-forget: navigation never waits on it.
    const remember = () => {
      // getSession, not getUser: the user id is in the local session, and
      // getUser would hold the auth lock across a round trip - parking the
      // project load and the audio signed-URL fetches behind it.
      void getSupabase().auth.getSession().then(({ data }) => {
        const user = data.session?.user
        if (user) rememberLastProject(user.id, projectId)
      }).catch(() => {})
    }

    // Anonymous adoption just seeded this row FROM the in-memory document -
    // memory is the source of truth, so keep it and only arm autosave. The
    // normal blank-slate → reload path would wipe and re-fill the stores with
    // the same data, visibly flapping everything derived from them (the
    // first-run tutorial snaps back a step, the timeline empties for a beat).
    const handoff = justAdopted(projectId)
    if (handoff) {
      // Memory already holds the document - nothing is loading.
      useUIStore.getState().setDocumentLoading(false)
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
        // Only now may the timeline judge emptiness: a truly blank project's
        // empty-scene list appears here, after verification, never before.
        useUIStore.getState().setDocumentLoading(false)
        stop = startAutosave(projectId, rev)
      } catch (err) {
        if (cancelled) return
        // The row is gone (deleted here, or on another device where this
        // browser's pointer never heard about it). PGRST116 is PostgREST's
        // "0 rows" from the .single() in load().
        //
        // Clearing the pointer is the important part: without it the landing
        // page's "Continue creating" aims at the same dead row on EVERY click,
        // so the failure repeats forever instead of once. Bouncing to /projects
        // then leaves them somewhere they can actually act.
        if ((err as { code?: string })?.code === 'PGRST116') {
          console.warn(`Project ${projectId} no longer exists - clearing the pointer`)
          forgetLastProject(projectId)
          router.replace('/projects')
          return
        }
        console.error('Failed to load project', err)
        useUIStore.getState().setDocumentLoading(false)
        useSaveStatus.setState({ status: 'load-failed' })
      }
    })()

    return () => {
      cancelled = true
      stop?.()
      useUIStore.getState().setProjectName(null)
    }
    // `router` is stable in the App Router, so listing it can't re-run the bind.
  }, [projectId, router])
}

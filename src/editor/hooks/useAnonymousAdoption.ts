import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useProjectStore } from '../store/ProjectStore'
import { useUIStore } from '../store/UIStore'
import * as projectStorage from '../../persistence/projectStorage'
import { serialize } from '../../persistence/serialize'
import { ensureSession, anonSessionsEnabled } from '../../persistence/anonSession'
import { markAdopted } from '../../persistence/adoptionHandoff'
import { useAuth } from '../../persistence/hooks/useAuth'

/**
 * Sign-in-to-save, phase 2 (docs/sign-in-to-save-architecture.html §4): in an
 * unbound editor (no ?project), the first structural edit lazily creates a
 * session (anonymous if needed) and a project row seeded with the current
 * document, then rebinds the URL - from there the ordinary persistence flow
 * arms autosave. Template hydration counts as a structural edit on purpose:
 * opening a template expresses intent to make something.
 *
 * Fails soft at every step: no session, at the free cap, or a create error
 * all mean the editor simply stays in-memory (exactly today's behavior).
 */
export function useAnonymousAdoption() {
  const search = useSearchParams()
  const projectId = search.get('project')
  const templateId = search.get('template')
  const router = useRouter()
  const { user, loading, isAnonymous } = useAuth()
  const startedRef = useRef(false)

  useEffect(() => {
    if (projectId || loading || !anonSessionsEnabled()) return
    // Permanent users create projects deliberately from /projects - adoption
    // is for visitors and returning anonymous users only.
    if (user && !isAnonymous) return

    const adopt = () => {
      if (startedRef.current) return
      startedRef.current = true
      void (async () => {
        try {
          const sessionUser = await ensureSession()
          if (!sessionUser) return // no session to be had - stay in-memory
          // Free cap: an anonymous account keeps at most one project.
          const existing = await projectStorage.list()
          if (existing.length >= 1) return
          const name = useUIStore.getState().projectName?.trim() || 'Untitled'
          const project = await projectStorage.create(name, serialize())
          // The row was seeded from the document already in memory - tell the
          // rebind to keep it (no blank slate, no reload) and just arm autosave.
          markAdopted(project.id, project.name, project.rev)
          router.replace(`/editor?project=${project.id}`)
        } catch (err) {
          console.error('Adoption failed (staying in-memory):', err)
          startedRef.current = false // allow a later edit to retry
        }
      })()
    }

    // Template mode usually hydrates BEFORE auth resolves, so the mutation
    // happened before we could subscribe - opening a template is intent
    // enough (architecture §4), so adopt the already-hydrated state directly.
    if (templateId && Object.keys(useProjectStore.getState().tracks).length > 0) adopt()

    const unsub = useProjectStore.subscribe((s, prev) => {
      // Structural edits only - a bpm scrub alone isn't worth a row.
      if (s.tracks === prev.tracks && s.rootTrackIds === prev.rootTrackIds) return
      if (Object.keys(s.tracks).length === 0) return
      adopt()
    })
    return unsub
  }, [projectId, templateId, user, loading, isAnonymous, router])
}

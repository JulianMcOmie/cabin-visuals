import { useCallback, useEffect, useState } from 'react'
import * as projectStorage from '../projectStorage'
import type { ProjectSummary } from '../projectStorage'
import type { ProjectDocument } from '../types'

// Module-level cache of the last-fetched list. The projects page gates its whole
// render on `loading`, and its header remounts on every navigation, so without
// this each visit re-runs the fetch and shows the full skeleton again. With it,
// a repeat visit renders the last-known list instantly and refreshes in the
// background. Cleared on sign-out (enabled -> false) so one account never flashes
// another's project names.
let cachedList: ProjectSummary[] | null = null

/**
 * The project browser's list state, backed by projectStorage. Pass
 * `enabled=false` until auth resolves - RLS returns an empty list for an
 * anonymous session, so fetching before then would just flash wrong data.
 */
export function useProjectList(enabled: boolean) {
  const [projects, setProjects] = useState<ProjectSummary[]>(cachedList ?? [])
  // Only block the page when there is nothing to show yet; a cached list renders
  // immediately while the background refresh runs.
  const [loading, setLoading] = useState(enabled && cachedList === null)

  useEffect(() => {
    if (!enabled) {
      cachedList = null
      setProjects([])
      setLoading(false)
      return
    }
    let mounted = true
    if (cachedList === null) setLoading(true)
    projectStorage
      .list()
      .then((list) => {
        cachedList = list
        if (mounted) setProjects(list)
      })
      .catch((err) => console.error('Failed to list projects', err))
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => { mounted = false }
  }, [enabled])

  const createProject = useCallback(async (name: string, document?: ProjectDocument) => {
    const project = await projectStorage.create(name, document)
    cachedList = [project, ...(cachedList ?? [])]
    setProjects((prev) => [project, ...prev])
    return project
  }, [])

  const deleteProject = useCallback(async (id: string) => {
    await projectStorage.remove(id)
    cachedList = (cachedList ?? []).filter((p) => p.id !== id)
    setProjects((prev) => prev.filter((p) => p.id !== id))
  }, [])

  return { projects, loading, createProject, deleteProject }
}

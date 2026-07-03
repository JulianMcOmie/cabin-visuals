import { useCallback, useEffect, useState } from 'react'
import * as projectStorage from '../projectStorage'
import type { ProjectSummary } from '../projectStorage'

/**
 * The project browser's list state, backed by projectStorage. Pass
 * `enabled=false` until auth resolves — RLS returns an empty list for an
 * anonymous session, so fetching before then would just flash wrong data.
 */
export function useProjectList(enabled: boolean) {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(enabled)

  useEffect(() => {
    if (!enabled) {
      setProjects([])
      setLoading(false)
      return
    }
    let mounted = true
    setLoading(true)
    projectStorage
      .list()
      .then((list) => {
        if (mounted) setProjects(list)
      })
      .catch((err) => console.error('Failed to list projects', err))
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => { mounted = false }
  }, [enabled])

  const createProject = useCallback(async (name: string) => {
    const project = await projectStorage.create(name)
    setProjects((prev) => [project, ...prev])
    return project
  }, [])

  const deleteProject = useCallback(async (id: string) => {
    await projectStorage.remove(id)
    setProjects((prev) => prev.filter((p) => p.id !== id))
  }, [])

  return { projects, loading, createProject, deleteProject }
}

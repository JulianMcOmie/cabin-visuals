"use client"

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import ProjectsDisplay from '../../src/components/ProjectsDisplay'
import { ProjectsSkeleton } from '../../src/components/ProjectsSkeleton'
import { LoadingScreen } from '../../src/components/LoadingScreen'
import { createClient } from '../../src/utils/supabase/client'
import { useAuth } from '../../src/persistence/hooks/useAuth'
import { useProjectList } from '../../src/persistence/hooks/useProjectList'
import { usePlan } from '../../src/billing/usePlan'
import { ensureSession, anonSessionsEnabled } from '../../src/persistence/anonSession'
import { takeCarryover } from '../../src/persistence/carryover'
import { forgetLastProject } from '../../src/persistence/lastProject'
import { track } from '../../src/analytics/analytics'
import type { TemplateDef } from '../../src/templates'

const FREE_PROJECT_LIMIT = 1

// The Lyric Video template opens straight into its setup pipeline (drop a
// song → transcribe → align) instead of a silent editor.
const lyricSetupParam = (templateId: string) => (templateId === 'lyricVideo' ? '&lyricSetup=1' : '')


interface ProfileData {
  first_name: string | null
  last_name: string | null
}

export default function ProjectsPage() {
  const router = useRouter()
  const { user, loading: authLoading, isAnonymous } = useAuth()
  const { projects, loading: projectsLoading, createProject, deleteProject } = useProjectList(!!user)
  const plan = usePlan()
  const [profile, setProfile] = useState<ProfileData | null>(null)

  // Free tier: one project. Client-side gate (like the export watermark) - the
  // point is a clear upgrade moment, not tamper-proofing.
  const atFreeLimit = !plan.loading && !plan.isPro && projects.length >= FREE_PROJECT_LIMIT
  const promptUpgrade = () => {
    if (window.confirm(`The free plan includes ${FREE_PROJECT_LIMIT} project. Upgrade to Pro for unlimited projects?`)) {
      router.push('/pricing')
    }
  }

  useEffect(() => {
    if (!user) {
      setProfile(null)
      return
    }
    const supabase = createClient()
    let mounted = true
    supabase
      .from('profiles')
      .select('first_name, last_name')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (mounted) setProfile(data ?? null)
      })
    return () => { mounted = false }
  }, [user])

  // Sign-in-to-save phase 4: redeem work carried over from an anonymous session
  // into this (permanent) account. takeCarryover self-cleans and returns null
  // for converted-in-place users, so this can't duplicate projects.
  const redeemedRef = useRef(false)
  useEffect(() => {
    if (redeemedRef.current || authLoading || projectsLoading || !user || isAnonymous) return
    const carried = takeCarryover(user.id)
    if (!carried) return
    redeemedRef.current = true
    void (async () => {
      try {
        if (!plan.loading && !plan.isPro && projects.length >= FREE_PROJECT_LIMIT) {
          const keep = window.confirm(
            'You have work carried over from before you logged in, but the free plan includes 1 project. Save it anyway?',
          )
          if (!keep) return
        }
        const project = await createProject(`${carried.name} (carried over)`, carried.document)
        track('project_created', { source: 'carryover' })
        router.push(`/editor?project=${project.id}`)
      } catch (err) {
        console.error('Could not save carried-over work:', err)
      }
    })()
  }, [authLoading, projectsLoading, user, isAnonymous, plan.loading, plan.isPro, projects.length, createProject, router])

  // Flipped synchronously in the click handlers so the overlay is on screen
  // BEFORE any network work - never reset on success (navigation replaces the
  // page; clearing it early would flash the grid back).
  const [creating, setCreating] = useState(false)

  const handleCreateProject = async (name: string) => {
    if (atFreeLimit) { promptUpgrade(); return }
    setCreating(true)
    try {
      const project = await createProject(name)
      track('project_created', { source: 'blank' })
      router.push(`/editor?project=${project.id}`)
    } catch {
      setCreating(false)
      alert("Failed to create project.")
    }
  }

  const handleCreateFromTemplate = async (template: TemplateDef) => {
    // Signed out: try the anonymous rails (a real saved project); fall back to
    // the in-memory ?template demo when no session can be created.
    if (!user) {
      setCreating(true)
      const sessionUser = anonSessionsEnabled() ? await ensureSession() : null
      if (!sessionUser) {
        router.push(`/editor?template=${template.id}`)
        return
      }
      try {
        const project = await createProject(template.name, structuredClone(template.document))
        track('project_created', { source: 'template', template: template.id })
        router.push(`/editor?project=${project.id}${lyricSetupParam(template.id)}`)
      } catch {
        router.push(`/editor?template=${template.id}`)
      }
      return
    }
    if (atFreeLimit) { promptUpgrade(); return }
    setCreating(true)
    try {
      // Fresh deep copy per project - template documents are shared module state.
      const project = await createProject(template.name, structuredClone(template.document))
      track('project_created', { source: 'template', template: template.id })
      router.push(`/editor?project=${project.id}${lyricSetupParam(template.id)}`)
    } catch {
      setCreating(false)
      alert("Failed to create project from template.")
    }
  }

  const handleSelectProject = (projectId: string) => {
    track('project_opened')
    setCreating(true)
    router.push(`/editor?project=${projectId}`)
  }

  const handleDeleteProject = async (projectId: string) => {
    try {
      await deleteProject(projectId)
      track('project_deleted')
      // Don't leave the landing page's "Continue creating" aimed at a dead row.
      forgetLastProject(projectId)
    } catch {
      alert("Failed to delete project.")
    }
  }

  if (authLoading || projectsLoading) {
    // Same chrome as the loaded page and the navigation boundary, so the header
    // stays put and the background never flashes a different color.
    return <ProjectsSkeleton />
  }

  return (
    <>
      {/* Covers the page the INSTANT a create/open is clicked - the project
          write and navigation happen behind the same smoking-cabin screen the
          route transition shows, so the grid never visibly reshuffles. */}
      {creating && <LoadingScreen />}
      <ProjectsDisplay
        projects={projects}
        user={user}
        profile={profile}
        onCreateProject={handleCreateProject}
        onSelectProject={handleSelectProject}
        onDeleteProject={handleDeleteProject}
        onCreateFromTemplate={handleCreateFromTemplate}
      />
    </>
  )
}

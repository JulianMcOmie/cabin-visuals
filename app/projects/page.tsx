"use client"

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import ProjectsDisplay from '../../src/components/ProjectsDisplay'
import { createClient } from '../../src/utils/supabase/client'
import { useAuth } from '../../src/persistence/hooks/useAuth'
import { useProjectList } from '../../src/persistence/hooks/useProjectList'
import { usePlan } from '../../src/billing/usePlan'
import { ensureSession, anonSessionsEnabled } from '../../src/persistence/anonSession'
import { takeCarryover } from '../../src/persistence/carryover'
import type { TemplateDef } from '../../src/templates'

const FREE_PROJECT_LIMIT = 1

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

  // Free tier: one project. Client-side gate (like the export watermark) — the
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
        router.push(`/editor?project=${project.id}`)
      } catch (err) {
        console.error('Could not save carried-over work:', err)
      }
    })()
  }, [authLoading, projectsLoading, user, isAnonymous, plan.loading, plan.isPro, projects.length, createProject, router])

  const handleCreateProject = async () => {
    if (atFreeLimit) { promptUpgrade(); return }
    const name = prompt("Enter new project name:", "Untitled Project")
    if (name === null) return
    try {
      const project = await createProject(name)
      router.push(`/editor?project=${project.id}`)
    } catch {
      alert("Failed to create project.")
    }
  }

  const handleCreateFromTemplate = async (template: TemplateDef) => {
    // Signed out: try the anonymous rails (a real saved project); fall back to
    // the in-memory ?template demo when no session can be created.
    if (!user) {
      const sessionUser = anonSessionsEnabled() ? await ensureSession() : null
      if (!sessionUser) {
        router.push(`/editor?template=${template.id}`)
        return
      }
      try {
        const project = await createProject(template.name, structuredClone(template.document))
        router.push(`/editor?project=${project.id}`)
      } catch {
        router.push(`/editor?template=${template.id}`)
      }
      return
    }
    if (atFreeLimit) { promptUpgrade(); return }
    try {
      // Fresh deep copy per project — template documents are shared module state.
      const project = await createProject(template.name, structuredClone(template.document))
      router.push(`/editor?project=${project.id}`)
    } catch {
      alert("Failed to create project from template.")
    }
  }

  const handleSelectProject = (projectId: string) => {
    router.push(`/editor?project=${projectId}`)
  }

  const handleDeleteProject = async (projectId: string) => {
    try {
      await deleteProject(projectId)
    } catch {
      alert("Failed to delete project.")
    }
  }

  if (authLoading || projectsLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#111' }}>
        <div className="w-8 h-8 border-2 border-slate-700 border-t-[#00a8ff] rounded-full animate-spin"></div>
      </div>
    )
  }

  return (
    <ProjectsDisplay
      projects={projects}
      user={user}
      profile={profile}
      onCreateProject={handleCreateProject}
      onSelectProject={handleSelectProject}
      onDeleteProject={handleDeleteProject}
      onCreateFromTemplate={handleCreateFromTemplate}
    />
  )
}

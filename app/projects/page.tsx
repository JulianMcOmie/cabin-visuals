"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import ProjectsDisplay from '../../src/components/ProjectsDisplay'
import { createClient } from '../../src/utils/supabase/client'
import { useAuth } from '../../src/persistence/hooks/useAuth'
import { useProjectList } from '../../src/persistence/hooks/useProjectList'

interface ProfileData {
  first_name: string | null
  last_name: string | null
}

export default function ProjectsPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { projects, loading: projectsLoading, createProject, deleteProject } = useProjectList(!!user)
  const [profile, setProfile] = useState<ProfileData | null>(null)

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

  const handleCreateProject = async () => {
    const name = prompt("Enter new project name:", "Untitled Project")
    if (name === null) return
    try {
      const project = await createProject(name)
      router.push(`/editor?project=${project.id}`)
    } catch {
      alert("Failed to create project.")
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
    />
  )
}

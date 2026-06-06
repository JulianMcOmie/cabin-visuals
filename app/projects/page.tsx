"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import ProjectsDisplay, { type ProjectMetadata } from '../../src/components/ProjectsDisplay'
import { createClient } from '../../src/utils/supabase/client'
import type { User } from '@supabase/supabase-js'

interface ProfileData {
  first_name: string | null
  last_name: string | null
}

export default function ProjectsPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [projects, setProjects] = useState<ProjectMetadata[]>([])
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    let isMounted = true

    const initialize = async () => {
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      if (!isMounted) return

      setUser(currentUser)

      if (currentUser) {
        const [{ data: profileData }, { data: projectsData }] = await Promise.all([
          supabase.from('profiles').select('first_name, last_name').eq('user_id', currentUser.id).single(),
          supabase.from('projects').select('id, name').eq('user_id', currentUser.id).order('created_at', { ascending: false }),
        ])
        if (isMounted) {
          setProfile(profileData ?? null)
          setProjects(projectsData ?? [])
        }
      }

      if (isMounted) setIsLoading(false)
    }

    initialize()
    return () => { isMounted = false }
  }, [])

  const handleCreateProject = async () => {
    const name = prompt("Enter new project name:", "Untitled Project")
    if (name === null) return
    const supabase = createClient()
    const { data, error } = await supabase
      .from('projects')
      .insert({ name, user_id: user?.id })
      .select('id, name')
      .single()
    if (error) { alert("Failed to create project."); return }
    setProjects((prev) => [data, ...prev])
    router.push(`/editor?project=${data.id}`)
  }

  const handleSelectProject = (projectId: string) => {
    router.push(`/editor?project=${projectId}`)
  }

  const handleDeleteProject = async (projectId: string) => {
    const supabase = createClient()
    const { error } = await supabase.from('projects').delete().eq('id', projectId)
    if (error) { alert("Failed to delete project."); return }
    setProjects((prev) => prev.filter((p) => p.id !== projectId))
  }

  if (isLoading) {
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

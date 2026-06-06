"use client"
import { useState } from "react"
import Link from "next/link"
import { LogOut, ExternalLink, Plus, FileText, X } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import styles from '../../app/projects/projects.module.css'
import type { User } from '@supabase/supabase-js'
import { logout } from "../../app/(auth)/logout/actions"
import { createClient } from "../utils/supabase/client"
import LogInButton from "./AuthButtons/LogInButton"
import SignUpButton from "./AuthButtons/SignUpButton"

export interface ProjectMetadata {
  id: string
  name: string
}

interface ProfileData {
  first_name: string | null
  last_name: string | null
}

interface ProjectsDisplayProps {
  projects: ProjectMetadata[]
  user: User | null
  profile: ProfileData | null
  onCreateProject: () => void
  onSelectProject: (projectId: string) => void
  onDeleteProject: (projectId: string) => void
}

const getInitials = (firstName: string | null | undefined, lastName: string | null | undefined): string => {
  const firstInitial = firstName?.[0]?.toUpperCase() || ''
  const lastInitial = lastName?.[0]?.toUpperCase() || ''
  return firstInitial && lastInitial ? `${firstInitial}${lastInitial}` : (firstInitial || lastInitial || '?')
}

export default function ProjectsDisplay({
  projects,
  user,
  profile,
  onCreateProject,
  onSelectProject,
  onDeleteProject,
}: ProjectsDisplayProps) {
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const userInitials = getInitials(profile?.first_name, profile?.last_name)

  const handleDeleteProject = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()
    if (window.confirm('Are you sure you want to delete this project? This action cannot be undone.')) {
      onDeleteProject(projectId)
    }
  }

  const handleLogout = async () => {
    if (isLoggingOut) return
    setIsLoggingOut(true)
    const supabase = createClient()
    try {
      const { error: clientSignOutError } = await supabase.auth.signOut()
      if (clientSignOutError) console.error("Client sign out error:", clientSignOutError.message)
      await logout()
    } catch (error) {
      console.error("Server logout action failed:", error)
      setIsLoggingOut(false)
    }
  }

  return (
    <div className={styles.pageContainer}>
      <div className={styles.blobContainer}>
        <div className={styles.blob1}></div>
        <div className={styles.blob2}></div>
        <div className={styles.blob3}></div>
      </div>

      <header className={styles.header}>
        <Link href="/" className="flex items-center gap-2 select-none">
          <img src="/logo.svg" alt="" className="h-12 w-auto" />
          <span className="text-xl text-zinc-200 translate-y-2">Cabin Visuals</span>
        </Link>
        <h1 className={`${styles.headerTitle} font-extrabold absolute left-1/2 -translate-x-1/2`}>Projects</h1>
        <nav className={styles.headerNav}>
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger className={styles.dropdownTriggerPlaceholder} disabled={isLoggingOut}>
                <span className={styles.dropdownTriggerText}>{userInitials}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-gray-900 border-gray-800">
                {(user || profile) && (
                  <div className="px-3 py-2 text-sm text-white">
                    {profile && (profile.first_name || profile.last_name) && (
                      <p className="font-medium truncate">{`${profile.first_name || ''} ${profile.last_name || ''}`.trim()}</p>
                    )}
                    {user && <p className="text-gray-300 truncate">{user.email}</p>}
                  </div>
                )}
                <DropdownMenuSeparator className="bg-gray-800" />
                <DropdownMenuItem
                  className="flex items-center cursor-pointer text-white hover:bg-gray-700"
                  onSelect={() => window.open('https://discord.gg/WhKZbH8nnV', '_blank')}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  <span>Discord Community</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-gray-800" />
                <DropdownMenuItem
                  className={`flex items-center w-full text-red-400 cursor-pointer hover:bg-gray-700 rounded-sm text-sm p-1.5 focus:bg-gray-700 focus:text-red-400 ${isLoggingOut ? 'opacity-50 cursor-not-allowed' : ''}`}
                  disabled={isLoggingOut}
                  onSelect={(event) => {
                    event.preventDefault()
                    handleLogout()
                  }}
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  <span>{isLoggingOut ? "Logging out..." : "Log out"}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center space-x-4">
              <LogInButton />
              <SignUpButton />
            </div>
          )}
        </nav>
      </header>

      <div className={styles.buttonContainer}>
        <button className={styles.createProjectButton} onClick={onCreateProject}>
          <Plus height={16} width={16} style={{ marginRight: '0.5rem' }} />
          Create Project
        </button>
      </div>

      <main className={styles.mainContent}>
        <div className={styles.projectsGrid}>
          {projects.length === 0 ? (
            <p className={styles.noProjectsText}>No projects found. Create one to get started!</p>
          ) : (
            projects.map((project) => (
              <div
                key={project.id}
                className={styles.projectCard}
                onClick={() => onSelectProject(project.id)}
              >
                <div className={styles.cardImageWrapper}>
                  <div className={styles.cardIconPlaceholder}>
                    <FileText className={styles.cardIcon} />
                  </div>
                  <button
                    className={styles.deleteButton}
                    onClick={(e) => handleDeleteProject(e, project.id)}
                    aria-label="Delete project"
                    title="Delete project"
                  >
                    <X className={styles.deleteIcon} />
                  </button>
                </div>
                <div className={styles.cardContent}>
                  <h3 className={styles.cardTitle}>{project.name}</h3>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  )
}

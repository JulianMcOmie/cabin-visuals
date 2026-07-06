"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { LogOut, ExternalLink, Plus, FileText, X, FilePlus, LayoutTemplate, ChevronLeft } from "lucide-react"
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
import { CabinLogo } from "./CabinLogo"
import SignUpButton from "./AuthButtons/SignUpButton"
import { TEMPLATES, type TemplateDef } from "../templates"

export interface ProjectMetadata {
  id: string
  name: string
  updatedAt: string
}

const formatLastEdited = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days <= 0) return 'Edited today'
  if (days === 1) return 'Edited yesterday'
  if (days < 30) return `Edited ${days} days ago`
  return `Edited ${date.toLocaleDateString()}`
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
  onCreateFromTemplate: (template: TemplateDef) => void
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
  onCreateFromTemplate,
}: ProjectsDisplayProps) {
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  // The create flow: closed, the Empty/Template choice, or the template catalog.
  const [createStep, setCreateStep] = useState<null | 'choice' | 'catalog'>(null)
  const userInitials = getInitials(profile?.first_name, profile?.last_name)

  const chooseEmpty = () => { setCreateStep(null); onCreateProject() }
  const chooseTemplate = (tpl: TemplateDef) => { setCreateStep(null); onCreateFromTemplate(tpl) }

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
          <CabinLogo className="h-12 w-auto" />
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
        <button className={styles.createProjectButton} onClick={() => setCreateStep('choice')}>
          <Plus height={16} width={16} style={{ marginRight: '0.5rem' }} />
          Create Project
        </button>
      </div>

      {createStep && (
        <CreateProjectModal
          step={createStep}
          onClose={() => setCreateStep(null)}
          onPickEmpty={chooseEmpty}
          onOpenCatalog={() => setCreateStep('catalog')}
          onBack={() => setCreateStep('choice')}
          onPickTemplate={chooseTemplate}
        />
      )}

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
                  <p className="text-xs text-zinc-500 mt-0.5">{formatLastEdited(project.updatedAt)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  )
}

// The create-project overlay: a two-step flow. 'choice' offers Empty vs
// Template; 'catalog' is a scrollable grid of every template. Click a card (or
// the Empty option) to create and close.
function CreateProjectModal({
  step,
  onClose,
  onPickEmpty,
  onOpenCatalog,
  onBack,
  onPickTemplate,
}: {
  step: 'choice' | 'catalog'
  onClose: () => void
  onPickEmpty: () => void
  onOpenCatalog: () => void
  onBack: () => void
  onPickTemplate: (tpl: TemplateDef) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-zinc-700 bg-[#161619] shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        {step === 'choice' ? (
          <div className="p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-zinc-100">New project</h2>
              <button onClick={onClose} aria-label="Close" className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <button
                onClick={onPickEmpty}
                className="group flex flex-col items-start gap-3 p-5 rounded-xl border border-zinc-700 hover:border-indigo-500 bg-zinc-900/50 hover:bg-indigo-950/20 text-left transition-colors cursor-pointer"
              >
                <FilePlus size={24} className="text-zinc-400 group-hover:text-indigo-400 transition-colors" />
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100">Empty project</h3>
                  <p className="text-xs text-zinc-500 mt-1">Start from a blank canvas.</p>
                </div>
              </button>
              <button
                onClick={onOpenCatalog}
                className="group flex flex-col items-start gap-3 p-5 rounded-xl border border-zinc-700 hover:border-indigo-500 bg-zinc-900/50 hover:bg-indigo-950/20 text-left transition-colors cursor-pointer"
              >
                <LayoutTemplate size={24} className="text-zinc-400 group-hover:text-indigo-400 transition-colors" />
                <div>
                  <h3 className="text-sm font-semibold text-zinc-100">Start from a template</h3>
                  <p className="text-xs text-zinc-500 mt-1">Pick a ready-made scene to customize.</p>
                </div>
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between p-5 border-b border-zinc-800 shrink-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={onBack}
                  aria-label="Back"
                  className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  <ChevronLeft size={18} />
                </button>
                <h2 className="text-lg font-semibold text-zinc-100">Choose a template</h2>
              </div>
              <button onClick={onClose} aria-label="Close" className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto p-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => onPickTemplate(tpl)}
                  className="group text-left rounded-xl overflow-hidden border border-zinc-800 hover:border-indigo-500 bg-zinc-900/60 transition-colors cursor-pointer"
                  title={`Create a project from “${tpl.name}”`}
                >
                  <div
                    className="h-24 relative"
                    style={{ background: `linear-gradient(135deg, ${tpl.gradient[0]}, ${tpl.gradient[1]})` }}
                  >
                    <span className="absolute bottom-2 right-2 text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-white/90">
                      {tpl.bpm} BPM
                    </span>
                  </div>
                  <div className="p-3">
                    <h3 className="text-sm font-semibold text-zinc-100 group-hover:text-white">{tpl.name}</h3>
                    <p className="text-xs text-zinc-500 mt-1 leading-snug">{tpl.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

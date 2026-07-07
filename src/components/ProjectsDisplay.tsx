"use client"
import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Plus, X, FilePlus, LayoutTemplate, ChevronLeft } from "lucide-react"
import type { User } from '@supabase/supabase-js'
import LogInButton from "./AuthButtons/LogInButton"
import { CabinLogo } from "./CabinLogo"
import { ProfileMenu } from "./ProfileMenu"
import SignUpButton from "./AuthButtons/SignUpButton"
import { TEMPLATES, type TemplateDef } from "../templates"

export interface ProjectMetadata {
  id: string
  name: string
  updatedAt: string
}

// Mono-caps edited stamp for the card footer: TODAY / 1D AGO / … / date.
const formatLastEdited = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days <= 0) return 'TODAY'
  if (days < 30) return `${days}D AGO`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()
}

const TRACK_PALETTE = ['var(--track-1)', 'var(--track-2)', 'var(--track-3)', 'var(--track-4)', 'var(--track-5)']
const TRACK_HEX = ['#35a7e6', '#4ec3c9', '#c583d6', '#8d8ff0', '#d6839e']

// The project list carries no document data, so the mini-timeline thumbnail is
// generated deterministically from the project id (placeholder until real
// per-project track data is available): hash the id into a seed, then draw a
// stable pseudo-random arrangement of rows/blocks from it.
const hashSeed = (s: string): number => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 2147483646) + 1 // 1..2147483646 (LCG needs a non-zero seed)
}

const seededRandom = (seed: number) => {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

interface ThumbBlock { left: number; width: number }
interface ThumbRow { colorIndex: number; blocks: ThumbBlock[] }

const buildThumbRows = (projectId: string): ThumbRow[] => {
  const rnd = seededRandom(hashSeed(projectId))
  const rowCount = 3 + Math.floor(rnd() * 2) // 3–4 rows
  const paletteStart = Math.floor(rnd() * TRACK_HEX.length)
  return Array.from({ length: rowCount }, (_, ri) => ({
    colorIndex: (paletteStart + ri) % TRACK_HEX.length,
    blocks: Array.from({ length: 2 + Math.floor(rnd() * 2) }, () => ({
      left: rnd() * 60,
      width: 12 + rnd() * 28,
    })),
  }))
}

// Mini timeline: rows of 14px blocks styled like editor blocks (translucent
// fill, 1px border, 2px color spine) in the track palette.
function ProjectThumbnail({ projectId }: { projectId: string }) {
  const rows = useMemo(() => buildThumbRows(projectId), [projectId])
  return (
    <div className="flex h-full flex-col justify-center gap-1.5">
      {rows.map((row, ri) => {
        const hex = TRACK_HEX[row.colorIndex]
        const varColor = TRACK_PALETTE[row.colorIndex]
        return (
          <div key={ri} className="relative h-3.5">
            {row.blocks.map((b, bi) => (
              <div
                key={bi}
                className="absolute inset-y-0 rounded-[3px]"
                style={{
                  left: `${b.left}%`,
                  width: `${b.width}%`,
                  backgroundColor: hex + '24',
                  border: `1px solid ${hex}55`,
                  borderLeft: `2px solid ${varColor}`,
                }}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
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

export default function ProjectsDisplay({
  projects,
  user,
  onCreateProject,
  onSelectProject,
  onDeleteProject,
  onCreateFromTemplate,
}: ProjectsDisplayProps) {
  // The create flow: closed, the Empty/Template choice, or the template catalog.
  const [createStep, setCreateStep] = useState<null | 'choice' | 'catalog'>(null)

  const chooseEmpty = () => { setCreateStep(null); onCreateProject() }
  const chooseTemplate = (tpl: TemplateDef) => { setCreateStep(null); onCreateFromTemplate(tpl) }

  const handleDeleteProject = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()
    if (window.confirm('Are you sure you want to delete this project? This action cannot be undone.')) {
      onDeleteProject(projectId)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] font-sans text-[var(--text)]">
      <header className="border-b border-[var(--border-subtle)]">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
          <Link href="/" className="flex select-none items-center gap-2.5">
            <CabinLogo className="h-[30px] w-auto" />
            <span className="translate-y-[5px] text-[15px] font-semibold text-[var(--text)]">Cabin Visuals</span>
          </Link>
          <nav className="flex items-center gap-5">
            <Link
              href="/pricing"
              className="text-[13px] text-[var(--text-3)] transition-colors hover:text-[var(--text)]"
            >
              Pricing
            </Link>
            {user && !user.is_anonymous ? (
              // Real account: the shared profile menu (anonymous sessions get
              // the sign-in affordances instead).
              <ProfileMenu />
            ) : (
              <div className="flex items-center gap-4">
                <LogInButton />
                <SignUpButton />
              </div>
            )}
          </nav>
        </div>
      </header>

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

      <main className="mx-auto max-w-[1200px] px-6 pb-24 pt-10">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold tracking-[-0.01em]">Projects</h1>
            <span className="font-mono text-xs text-[var(--text-muted)]">{projects.length}</span>
          </div>
          <button
            onClick={() => setCreateStep('choice')}
            className="flex h-9 cursor-pointer items-center gap-2 rounded-[5px] bg-[var(--accent)] px-4 text-[13px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)]"
          >
            <Plus size={14} strokeWidth={2.5} />
            New project
          </button>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => onSelectProject(project.id)}
              className="cursor-pointer overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] transition-colors hover:border-[rgba(53,167,230,0.6)]"
            >
              <div className="relative h-[120px] overflow-hidden border-b border-[var(--border-subtle)] bg-[var(--bg-app)]">
                <div className="absolute inset-x-3 inset-y-2.5">
                  <ProjectThumbnail projectId={project.id} />
                </div>
                <button
                  onClick={(e) => handleDeleteProject(e, project.id)}
                  aria-label="Delete project"
                  title="Delete project"
                  className="absolute right-2 top-2 flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded border border-[var(--border)] bg-[rgba(14,14,17,0.8)] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[#d68383]"
                >
                  <X size={11} />
                </button>
              </div>
              <div className="flex items-baseline justify-between gap-3 px-3.5 pb-[13px] pt-3">
                <h3 className="truncate text-[13px] font-semibold text-[var(--text)]">{project.name}</h3>
                <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">
                  {formatLastEdited(project.updatedAt)}
                </span>
              </div>
            </div>
          ))}

          <button
            onClick={() => setCreateStep('choice')}
            className="flex min-h-[168px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] bg-transparent text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-3)]"
          >
            <Plus size={18} />
            <span className="text-xs">Empty or from a template</span>
          </button>
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        {step === 'choice' ? (
          <div className="p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
                New project
              </h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="cursor-pointer rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <button
                onClick={onPickEmpty}
                className="group flex cursor-pointer flex-col items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-app)] p-5 text-left transition-colors hover:border-[rgba(53,167,230,0.6)]"
              >
                <FilePlus size={24} className="text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]" />
                <div>
                  <h3 className="text-[13px] font-semibold text-[var(--text)]">Empty project</h3>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">Start from a blank canvas.</p>
                </div>
              </button>
              <button
                onClick={onOpenCatalog}
                className="group flex cursor-pointer flex-col items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-app)] p-5 text-left transition-colors hover:border-[rgba(53,167,230,0.6)]"
              >
                <LayoutTemplate size={24} className="text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]" />
                <div>
                  <h3 className="text-[13px] font-semibold text-[var(--text)]">Start from a template</h3>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">Pick a ready-made scene to customize.</p>
                </div>
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] p-5">
              <div className="flex items-center gap-2">
                <button
                  onClick={onBack}
                  aria-label="Back"
                  className="cursor-pointer rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
                >
                  <ChevronLeft size={18} />
                </button>
                <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
                  Choose a template
                </h2>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="cursor-pointer rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid gap-4 overflow-y-auto p-5 sm:grid-cols-2 lg:grid-cols-3">
              {TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => onPickTemplate(tpl)}
                  className="group cursor-pointer overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-app)] text-left transition-colors hover:border-[rgba(53,167,230,0.6)]"
                  title={`Create a project from “${tpl.name}”`}
                >
                  <div
                    className="relative h-24"
                    style={{ background: `linear-gradient(135deg, ${tpl.gradient[0]}, ${tpl.gradient[1]})` }}
                  >
                    <span className="absolute bottom-2 right-2 rounded bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-white/90">
                      {tpl.bpm} BPM
                    </span>
                  </div>
                  <div className="p-3">
                    <h3 className="text-[13px] font-semibold text-[var(--text)] group-hover:text-white">{tpl.name}</h3>
                    <p className="mt-1 text-xs leading-snug text-[var(--text-muted)]">{tpl.description}</p>
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

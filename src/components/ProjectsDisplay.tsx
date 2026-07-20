"use client"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { motion, AnimatePresence, MotionConfig } from "framer-motion"
import { Plus, X, FilePlus, LayoutTemplate, ChevronLeft } from "lucide-react"
import type { User } from '@supabase/supabase-js'
import LogInButton from "./AuthButtons/LogInButton"
import { CabinLogo } from "./CabinLogo"
import { ProfileMenu } from "./ProfileMenu"
import SignUpButton from "./AuthButtons/SignUpButton"
import { TEMPLATES, type TemplateDef } from "../templates"
import { TemplatePreviewVideo } from "./TemplatePreviewVideo"
import { TemplateSlideshowPreview } from "./TemplateSlideshowPreview"
import { TemplateLyricPreview } from "./TemplateLyricPreview"
import type { ProjectPreview } from "../persistence/projectStorage"
import { track } from "../analytics/analytics"

export interface ProjectMetadata {
  id: string
  name: string
  updatedAt: string
  preview?: ProjectPreview
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

// Mini timeline of the project's REAL arrangement: one row per root track drawn
// in that track's own color, blocks positioned/sized as a percentage of the
// project length (derived server-side in projectStorage.documentToPreview). An
// empty project (no blocks yet) shows a muted hint instead of fake rows.
function ProjectThumbnail({ preview }: { preview?: ProjectPreview }) {
  // A real captured frame beats the row sketch whenever the project has one.
  // It spans the full container, letterboxed on black when the aspect ratio
  // differs - the bars double as a reminder of the project's aspect ratio.
  if (preview?.image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={preview.image} alt="" className="h-full w-full bg-black object-contain" />
  }
  const rows = preview?.rows ?? []
  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Empty</span>
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col justify-center gap-1.5 px-3 py-2.5">
      {rows.map((row, ri) => (
        <div key={ri} className="relative h-3.5">
          {row.blocks.map((b, bi) => (
            <div
              key={bi}
              className="absolute inset-y-0 rounded-[3px]"
              style={{
                left: `${b.left}%`,
                width: `${b.width}%`,
                backgroundColor: row.color + '24',
                border: `1px solid ${row.color}55`,
                borderLeft: `2px solid ${row.color}`,
              }}
            />
          ))}
        </div>
      ))}
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
  /** Create an empty project with the name the user typed in the modal. */
  onCreateProject: (name: string) => void
  onSelectProject: (projectId: string) => void
  onDeleteProject: (projectId: string) => void
  onCreateFromTemplate: (template: TemplateDef) => void
  /** Free-plan limit reached: the create buttons grey out and explain
   *  themselves on hover instead of opening the create flow. */
  createBlocked: boolean
}

export default function ProjectsDisplay({
  projects,
  user,
  onCreateProject,
  onSelectProject,
  onDeleteProject,
  onCreateFromTemplate,
  createBlocked,
}: ProjectsDisplayProps) {
  const openCreate = () => {
    if (createBlocked) return
    track('new_project_clicked')
    setCreateStep('choice')
  }
  // The hover explanation for a greyed-out create button - a clickable exit
  // inside (sign up for guests, upgrade for free accounts), so the dead end
  // has a way out.
  const isAnonymous = !!user?.is_anonymous
  const limitHint = (
    // The offset is PADDING on a hidden wrapper, not a margin - the pointer
    // crossing from the button to the popup never leaves the hover group, so
    // the popup stays put long enough to click the link inside.
    <div className="absolute right-0 top-full z-40 hidden pt-1.5 group-hover:block">
      <div className="w-56 rounded border border-[var(--border)] bg-[var(--bg-elevated)] p-2.5 text-left text-[11px] font-normal leading-relaxed text-[var(--text-2)] shadow-lg shadow-black/50">
      {isAnonymous ? (
        <>
          Guest sessions hold 1 project.{' '}
          <Link href="/signup" className="text-[var(--accent)] underline underline-offset-2 hover:text-[var(--accent-hover)]">
            Sign up
          </Link>{' '}
          to get 5 free projects.
        </>
      ) : (
        <>
          The free plan includes 5 projects.{' '}
          <Link href="/pricing" className="text-[var(--accent)] underline underline-offset-2 hover:text-[var(--accent-hover)]">
            Upgrade to Pro
          </Link>{' '}
          for unlimited projects.
        </>
      )}
      </div>
    </div>
  )
  // The create flow: closed, the Empty/Template choice, the name entry, or the
  // template catalog.
  const [createStep, setCreateStep] = useState<null | 'choice' | 'name' | 'catalog'>(null)
  // The project pending an in-UI delete confirmation, with the click position
  // to anchor the popover near (null = no popover).
  const [deleteTarget, setDeleteTarget] = useState<{ project: ProjectMetadata; x: number; y: number } | null>(null)
  // Set the instant a create begins: the new card gets prepended and starts its
  // entrance right before we navigate to the editor, and that half-played slide
  // reads as a glitch. While navigating, new cards skip the entrance.
  const [navigating, setNavigating] = useState(false)

  const chooseEmpty = (name: string) => { setCreateStep(null); setNavigating(true); onCreateProject(name) }
  const chooseTemplate = (tpl: TemplateDef) => { setCreateStep(null); setNavigating(true); onCreateFromTemplate(tpl) }

  const confirmDelete = () => {
    if (deleteTarget) onDeleteProject(deleteTarget.project.id)
    setDeleteTarget(null)
  }

  return (
    <MotionConfig reducedMotion="user">
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

      <AnimatePresence>
        {createStep && (
          <CreateProjectModal
            step={createStep}
            onClose={() => setCreateStep(null)}
            onOpenName={() => setCreateStep('name')}
            onPickEmpty={chooseEmpty}
            onOpenCatalog={() => setCreateStep('catalog')}
            onBack={() => setCreateStep('choice')}
            onPickTemplate={chooseTemplate}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteTarget && (
          <ConfirmDeletePopover
            x={deleteTarget.x}
            y={deleteTarget.y}
            name={deleteTarget.project.name}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={confirmDelete}
          />
        )}
      </AnimatePresence>

      <main className="mx-auto max-w-[1200px] px-6 pb-24 pt-10">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold tracking-[-0.01em]">Projects</h1>
            <span className="font-mono text-xs text-[var(--text-muted)]">{projects.length}</span>
          </div>
          <div className="group relative">
            <button
              onClick={openCreate}
              disabled={createBlocked}
              className="flex h-9 cursor-pointer items-center gap-2 rounded-[5px] bg-[var(--accent)] px-4 text-[13px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-[var(--accent)]"
            >
              <Plus size={14} strokeWidth={2.5} />
              New project
            </button>
            {createBlocked && limitHint}
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          <AnimatePresence mode="popLayout" initial={false}>
          {projects.map((project) => (
            <motion.div
              key={project.id}
              layout
              initial={navigating ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              whileHover={{ scale: 1.012, transition: { duration: 0.06 } }}
              whileTap={{ scale: 0.99, transition: { duration: 0.06 } }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              onClick={() => onSelectProject(project.id)}
              className="cursor-pointer overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] transition-colors hover:border-[rgba(53,167,230,0.6)]"
            >
              <div className="relative h-[120px] overflow-hidden border-b border-[var(--border-subtle)] bg-[var(--bg-app)]">
                <div className="absolute inset-0">
                  <ProjectThumbnail preview={project.preview} />
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget({ project, x: e.clientX, y: e.clientY }) }}
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
            </motion.div>
          ))}
          </AnimatePresence>

          <div className="group relative">
            <motion.button
              layout
              whileHover={createBlocked ? undefined : { scale: 1.012, transition: { duration: 0.06 } }}
              whileTap={createBlocked ? undefined : { scale: 0.99, transition: { duration: 0.06 } }}
              onClick={openCreate}
              disabled={createBlocked}
              className="flex min-h-[168px] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] bg-transparent text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-3)] disabled:cursor-default disabled:opacity-40 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--text-muted)]"
            >
              <Plus size={18} />
              <span className="text-xs">Empty or from a template</span>
            </motion.button>
            {createBlocked && limitHint}
          </div>
        </div>
      </main>
    </div>
    </MotionConfig>
  )
}

// The create-project overlay. 'choice' offers Empty vs Template; 'name' is the
// in-UI name field for an empty project; 'catalog' is a scrollable grid of every
// template. Replaces the old window.prompt for naming.
function CreateProjectModal({
  step,
  onClose,
  onOpenName,
  onPickEmpty,
  onOpenCatalog,
  onBack,
  onPickTemplate,
}: {
  step: 'choice' | 'name' | 'catalog'
  onClose: () => void
  onOpenName: () => void
  onPickEmpty: (name: string) => void
  onOpenCatalog: () => void
  onBack: () => void
  onPickTemplate: (tpl: TemplateDef) => void
}) {
  const [name, setName] = useState('Untitled Project')
  const nameInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // Focus + select the name the moment the name step opens.
  useEffect(() => {
    if (step === 'name') { nameInputRef.current?.focus(); nameInputRef.current?.select() }
  }, [step])

  const submitName = () => {
    const trimmed = name.trim()
    if (trimmed) onPickEmpty(trimmed)
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <motion.div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
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
                onClick={onOpenName}
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
        ) : step === 'name' ? (
          <div className="p-6">
            <div className="mb-5 flex items-center gap-2">
              <button
                onClick={onBack}
                aria-label="Back"
                className="cursor-pointer rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
              >
                <ChevronLeft size={18} />
              </button>
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
                Name your project
              </h2>
            </div>
            <input
              ref={nameInputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitName() }
              }}
              placeholder="Untitled Project"
              className="block h-[38px] w-full rounded-[5px] border border-[var(--border)] bg-[var(--bg-app)] px-3 text-[13px] text-[var(--text)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
            />
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                onClick={onBack}
                className="flex h-[36px] cursor-pointer items-center rounded-[5px] border border-[var(--border)] px-4 text-[13px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)]"
              >
                Back
              </button>
              <button
                onClick={submitName}
                disabled={!name.trim()}
                className="flex h-[36px] cursor-pointer items-center rounded-[5px] bg-[var(--accent)] px-4 text-[13px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-default disabled:opacity-50"
              >
                Create project
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
                  {/* No coloured backdrop: the video/canvas always covers the
                      preview, so a gradient here only leaked its colour past the
                      clipped corners/edges (the "pink/green corners"). Dark base
                      instead - any subpixel gap now reads as the card, not a hue. */}
                  {/* True 16:9 box: capture clips are 640×360, so they fit
                      exactly - never stretched, never cropped. */}
                  <div className="relative aspect-video bg-[var(--bg-app)]">
                    {tpl.cardPreview === 'animatedSlideshow'
                      ? <TemplateSlideshowPreview />
                      : tpl.cardPreview === 'animatedLyric'
                        ? <TemplateLyricPreview templateId={tpl.id} />
                        : <TemplatePreviewVideo id={tpl.id} />}
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
      </motion.div>
    </motion.div>
  )
}

// In-UI delete confirmation (replaces window.confirm): a small popover anchored
// near the click, no screen dim. A transparent full-screen catcher closes it on
// an outside click (and stops that click from opening the card behind).
function ConfirmDeletePopover({
  x,
  y,
  name,
  onCancel,
  onConfirm,
}: {
  x: number
  y: number
  name: string
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, onConfirm])

  // Anchor below-left of the click (the delete button sits at the card's top
  // right), clamped inside the viewport.
  const W = 236
  const left = Math.max(8, Math.min(x - W + 20, window.innerWidth - W - 8))
  const top = Math.min(y + 10, window.innerHeight - 104)

  return (
    <>
      <div className="fixed inset-0 z-50" onMouseDown={onCancel} />
      <motion.div
        className="fixed z-50 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-3 shadow-xl shadow-black/50"
        style={{ left, top, width: W }}
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.94, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.12, ease: 'easeOut' }}
      >
        <p className="text-[12px] leading-snug text-[var(--text-2)]">
          Delete <span className="font-semibold text-[var(--text)]">{name}</span>? This can&apos;t be undone.
        </p>
        <div className="mt-2.5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="flex h-7 cursor-pointer items-center rounded-[5px] border border-[var(--border)] px-2.5 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex h-7 cursor-pointer items-center rounded-[5px] bg-[#d0433f] px-2.5 text-[12px] font-bold text-white transition-colors hover:bg-[#e04b47]"
          >
            Delete
          </button>
        </div>
      </motion.div>
    </>
  )
}

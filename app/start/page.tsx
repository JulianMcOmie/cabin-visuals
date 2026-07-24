'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { CabinLogo } from '@/components/CabinLogo'
import { LoadingScreen } from '@/components/LoadingScreen'
import { TemplatePreviewVideo } from '@/components/TemplatePreviewVideo'
import { TemplateSlideshowPreview } from '@/components/TemplateSlideshowPreview'
import { TemplateLyricPreview } from '@/components/TemplateLyricPreview'
import { GALLERY_TEMPLATES, LYRIC_STYLES, type TemplateDef } from '@/templates'
import { projectDestination } from '@/templates/destination'
import { ensureSession, anonSessionsEnabled } from '@/persistence/anonSession'
import * as projectStorage from '@/persistence/projectStorage'
import { track } from '@/analytics/analytics'
import { useIsMobile } from '@/components/useIsMobile'

// First-run template picker: where "Start creating" sends a signed-out visitor,
// instead of dropping them into an empty editor.
//
// It creates a REAL project row (on an anonymous session) rather than using the
// in-memory ?template demo, because the Lyric Video pipeline can't work without
// one: audio bytes live at {userId}/{projectId}/{clipId}, and transcription
// refuses a clip that only exists as a blob in the tab. No row means no upload
// means no lyric video - which is the whole point of this screen.
export default function StartPage() {
  const router = useRouter()
  const [chosen, setChosen] = useState<string | null>(null)
  // Phones skip the template gallery: the mobile flow is style → song →
  // editor, so this page IS the style step there.
  const isMobile = useIsMobile()

  const choose = async (template: TemplateDef) => {
    if (chosen) return
    setChosen(template.id)
    // No session to be had (flag off, or anonymous sign-in refused): fall back
    // to the in-memory demo, same as the projects page does. Lyric setup will
    // tell them to sign in when it needs the upload.
    const sessionUser = anonSessionsEnabled() ? await ensureSession() : null
    if (!sessionUser) {
      router.push(`/editor?template=${template.id}`)
      return
    }
    try {
      // Fresh deep copy - template documents are shared module state.
      const project = await projectStorage.create(template.name, structuredClone(template.document))
      track('project_created', { source: 'template', template: template.id })
      router.push(projectDestination(template.id, project.id))
    } catch (err) {
      console.error('Create from template failed:', err)
      router.push(`/editor?template=${template.id}`)
    }
  }

  // Mobile: the style is chosen FIRST, so the project is created directly on
  // the chosen style's document - lyric setup then only needs the song, and
  // no style is applied at the end (`styled=1` tells it so).
  const chooseStyle = async (style: TemplateDef) => {
    if (chosen) return
    setChosen(style.id)
    const sessionUser = anonSessionsEnabled() ? await ensureSession() : null
    if (!sessionUser) {
      router.push(`/editor?template=${style.id}`)
      return
    }
    try {
      const project = await projectStorage.create(style.name, structuredClone(style.document))
      track('project_created', { source: 'template', template: style.id })
      router.push(`/lyric-setup?project=${project.id}&styled=1`)
    } catch (err) {
      console.error('Create from style failed:', err)
      router.push(`/editor?template=${style.id}`)
    }
  }

  // The no-template door: same session/row dance as choose(), just with an
  // empty document - and the same in-memory fallback when there is no session.
  const startEmpty = async () => {
    if (chosen) return
    setChosen('__empty__')
    const sessionUser = anonSessionsEnabled() ? await ensureSession() : null
    if (!sessionUser) {
      router.push('/editor')
      return
    }
    try {
      const project = await projectStorage.create('Untitled')
      track('project_created', { source: 'empty' })
      router.push(`/editor?project=${project.id}`)
    } catch (err) {
      console.error('Create empty project failed:', err)
      router.push('/editor')
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] font-sans text-[var(--text)]">
      {chosen && <LoadingScreen />}
      <header className="border-b border-[var(--border-subtle)]">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center px-4 sm:px-6">
          <Link href="/" className="flex select-none items-center gap-2.5">
            <CabinLogo className="h-[30px] w-auto flex-shrink-0" />
            <span className="translate-y-[5px] text-[15px] font-semibold text-[var(--text)]">Cabin Visuals</span>
          </Link>
        </div>
      </header>

      {isMobile ? (
        // The phone flow's first step: pick a look, then add the song. The
        // template gallery (slideshow etc.) stays a desktop doorway.
        <main className="mx-auto max-w-[900px] px-4 pb-16 pt-10 text-center">
          <h1 className="m-0 text-[22px] font-bold tracking-[-0.02em]">Pick a look</h1>
          <p className="mx-auto mt-2 mb-6 max-w-[420px] text-[13px] leading-relaxed text-[var(--text-3)]">
            Your lyric video starts from a style - you can change it any time.
          </p>
          <div className="grid grid-cols-2 gap-3 text-left">
            {LYRIC_STYLES.map((style) => {
              const picked = chosen === style.id
              return (
                <button
                  key={style.id}
                  onClick={() => void chooseStyle(style)}
                  disabled={!!chosen}
                  aria-busy={picked}
                  className={`group overflow-hidden rounded-lg border bg-[var(--bg-app)] text-left transition-all duration-150 ${
                    picked
                      ? 'scale-[1.03] border-[var(--accent)] ring-2 ring-[var(--accent)]'
                      : chosen
                        ? 'border-[var(--border)] opacity-40'
                        : 'border-[var(--border)]'
                  }`}
                >
                  <div className="relative aspect-video bg-[var(--bg-app)]">
                    <TemplateLyricPreview templateId={style.id} />
                  </div>
                  <div className="p-2.5">
                    <h3 className="m-0 truncate text-[13px] font-semibold text-[var(--text)]">
                      {style.styleName ?? style.name}
                    </h3>
                  </div>
                </button>
              )
            })}
          </div>
        </main>
      ) : (
      <main className="mx-auto max-w-[900px] px-6 pb-24 pt-14 text-center">
        <h1 className="m-0 text-[22px] font-bold tracking-[-0.02em]">Pick a template</h1>
        <p className="mx-auto mt-2 mb-8 max-w-[420px] text-[13px] leading-relaxed text-[var(--text-3)]">
          Start from a ready-made scene - you can change everything once you&apos;re in.
        </p>

        <div className="grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
          {GALLERY_TEMPLATES.map((tpl) => {
            const picked = chosen === tpl.id
            return (
              <button
                key={tpl.id}
                onClick={() => void choose(tpl)}
                disabled={!!chosen}
                aria-busy={picked}
                title={tpl.description}
                // Same picked/dimmed treatment as the lyric style picker, so
                // the choice stays legible for the beat before the next screen.
                className={`group overflow-hidden rounded-lg border bg-[var(--bg-app)] text-left transition-all duration-150 ${
                  picked
                    ? 'scale-[1.03] cursor-default border-[var(--accent)] ring-2 ring-[var(--accent)]'
                    : chosen
                      ? 'cursor-default border-[var(--border)] opacity-40'
                      : 'cursor-pointer border-[var(--border)] hover:border-[var(--accent)]'
                }`}
              >
                <div className="relative aspect-video bg-[var(--bg-app)]">
                  {tpl.cardPreview === 'animatedSlideshow'
                    ? <TemplateSlideshowPreview />
                    : tpl.cardPreview === 'animatedLyric'
                      ? <TemplateLyricPreview templateId={tpl.id} />
                      : <TemplatePreviewVideo id={tpl.id} />}
                </div>
                <div className="p-3">
                  <h3 className="m-0 text-[13px] font-semibold text-[var(--text)] group-hover:text-white">{tpl.name}</h3>
                  <p className="mt-1 mb-0 text-xs leading-snug text-[var(--text-muted)]">{tpl.description}</p>
                </div>
              </button>
            )
          })}
        </div>

        <button
          onClick={() => void startEmpty()}
          disabled={!!chosen}
          className="mt-8 inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-[var(--text-3)] transition-colors hover:text-[var(--text)] disabled:cursor-default disabled:opacity-40"
        >
          Create an empty project <ArrowRight size={14} />
        </button>
      </main>
      )}
    </div>
  )
}

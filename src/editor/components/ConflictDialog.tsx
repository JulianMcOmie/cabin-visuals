'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useSaveStatus } from '../../persistence/autosave'
import * as projectStorage from '../../persistence/projectStorage'
import { serialize } from '../../persistence/serialize'
import { useUIStore } from '../store/UIStore'

/**
 * Shown when autosave discovers the project row moved on underneath this tab -
 * another tab or device saved since we loaded (see projectStorage.save).
 *
 * The one rule here: never pick a winner on the user's behalf. This tab may be
 * holding a stale copy worth discarding, or it may be holding an hour of work
 * the other tab never had, and nothing in the app can tell which. So both
 * versions get a door, and neither door destroys anything - "keep my copy"
 * writes a NEW row rather than fighting for the old one. Worst case the user
 * ends up with two projects to compare; that's recoverable, and losing hours
 * of work is not.
 *
 * Deliberately blocking (no dismiss, no Escape): autosave has parked, so a
 * dismissable version would leave the user editing a project that silently
 * isn't saving - the exact failure this whole change exists to end.
 */
export function ConflictDialog() {
  const status = useSaveStatus((s) => s.status)
  const projectName = useUIStore((s) => s.projectName)
  const router = useRouter()
  const [busy, setBusy] = useState<'reload' | 'fork' | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (status !== 'conflict') return null

  const reload = () => {
    setBusy('reload')
    // A full reload rather than a re-hydrate: the stores are module singletons
    // shared with undo history, and this is the one path where throwing away
    // every last trace of the stale document is the entire point.
    window.location.reload()
  }

  const fork = async () => {
    setBusy('fork')
    setError(null)
    try {
      const name = `${projectName?.trim() || 'Untitled'} copy`
      const copy = await projectStorage.create(name, serialize())
      router.replace(`/editor?project=${copy.id}`)
    } catch (err) {
      console.error('Failed to save conflicted copy', err)
      setError('Could not save the copy. Check your connection and try again.')
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
      <div className="w-[min(30rem,calc(100vw-2rem))] rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-[var(--warn)]" />
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-[var(--text)]">This project changed somewhere else</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-2)]">
              Another tab or device saved this project after you opened it here, so this
              tab has stopped saving to avoid overwriting that newer version.
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-2)]">
              Your edits in this tab are still here, and nothing has been lost on either
              side. Choose which version to keep going with.
            </p>
          </div>
        </div>

        {error && <p className="mt-3 text-[12px] text-red-400">{error}</p>}

        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={reload}
            disabled={busy !== null}
            className="flex items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-60"
          >
            {busy === 'reload' && <Loader2 size={13} className="animate-spin" />}
            Load the newer version
          </button>
          <button
            onClick={() => void fork()}
            disabled={busy !== null}
            className="flex items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-[13px] text-[var(--text-2)] transition-colors hover:text-[var(--text)] disabled:opacity-60"
          >
            {busy === 'fork' && <Loader2 size={13} className="animate-spin" />}
            Keep this tab&apos;s version as a new project
          </button>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
          Discarding this tab&apos;s edits is the only thing &ldquo;Load the newer
          version&rdquo; throws away — the other version is untouched either way.
        </p>
      </div>
    </div>
  )
}

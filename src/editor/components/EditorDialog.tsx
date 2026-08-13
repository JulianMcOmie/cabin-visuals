'use client'

import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { MotionConfig, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useUIStore } from '../store/UIStore'

/**
 * The editor's modal shell - one voice for every dialog that floats over the
 * workspace (Export, the signup gate inside it, Save to cloud).
 *
 * The look is the "DAW Console 1a" dialog: a scrim, a #0f1118 card behind a
 * white-alpha hairline at radius 14, and an Archivo 700 uppercase title with
 * a 30px close square. The motion is Radix/shadcn's dialog voice - fade + zoom
 * from 95%, 200ms in, 150ms out, because dismissal should feel obedient.
 * Callers supply only the title and the body.
 *
 * Mount it under an `<AnimatePresence>` so the exit animation gets to play;
 * unmounting it directly cuts the fade.
 *
 * NESTING (the export gate floats over the export settings) is why two of the
 * props exist:
 * - Only the TOPMOST dialog reacts to the keyboard. Both dialogs are portaled
 *   siblings, so an outer dialog's panel does NOT contain an inner dialog's
 *   fields; without the stack the outer one would treat typing in the inner
 *   one as a background keystroke and swallow Space/Enter (and Escape would
 *   close both at once).
 * - `claimModal` marks the app as modal exactly once. An inner dialog passes
 *   false so its unmount doesn't clear the flag while the outer is still open.
 */

/** Mount order of the open dialogs; the last one owns the keyboard. */
const dialogStack: string[] = []

export function EditorDialog({
  title,
  onClose,
  children,
  width = 'w-[420px]',
  variant = 'chrome',
  scrim = 'page',
  dismissOnScrimClick = true,
  claimModal = true,
  animated = true,
  closeLabel = 'Close',
  panelRef: panelRefProp,
}: {
  /** `chrome` renders it uppercase; `prompt` renders it exactly as written. */
  title: string
  onClose: () => void
  children: ReactNode
  /** Tailwind width class for the card. */
  width?: string
  /**
   * Two looks, and they are not interchangeable:
   * - `chrome` - a tool window (Export). Archivo 700 / 14px / uppercase at
   *   0.12em tracking, asymmetric padding.
   * - `prompt` - a card that asks you something (the signup surfaces). Plain
   *   UI sans, 15px semibold, sentence case, even 26px padding.
   */
  variant?: 'chrome' | 'prompt'
  /** `page` sits over the workspace; `nested` sits over another dialog (lighter, blurrier, higher). */
  scrim?: 'page' | 'nested'
  /** False while a run is in flight, so a stray click can't abandon it. */
  dismissOnScrimClick?: boolean
  /** False for a dialog opened INSIDE another one - the outer already claimed it. */
  claimModal?: boolean
  /** False to appear instantly - a nested card over an already-open dialog doesn't re-announce itself. */
  animated?: boolean
  /** Announced on the close square; say where it goes when it isn't "close". */
  closeLabel?: string
  /** Supply one if the caller needs to hit-test the panel itself. */
  panelRef?: RefObject<HTMLDivElement | null>
}) {
  const ownRef = useRef<HTMLDivElement>(null)
  const panelRef = panelRefProp ?? ownRef
  const id = useId()

  useEffect(() => {
    if (!claimModal) return
    useUIStore.getState().setModalOpen(true)
    return () => useUIStore.getState().setModalOpen(false)
  }, [claimModal])

  // Kill background shortcuts while a dialog is up; the dialog's own fields
  // pass through. Only the topmost dialog runs at all - see the note above.
  useEffect(() => {
    dialogStack.push(id)
    const block = (e: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== id) return
      const t = e.target as HTMLElement | null
      if (t && panelRef.current?.contains(t)) {
        if (e.key === 'Escape') onClose()
        return
      }
      if (e.key === 'Escape') { onClose(); return }
      e.stopPropagation()
      if (e.code === 'Space' || e.code === 'Enter') e.preventDefault()
    }
    window.addEventListener('keydown', block, { capture: true })
    return () => {
      window.removeEventListener('keydown', block, { capture: true })
      const i = dialogStack.indexOf(id)
      if (i >= 0) dialogStack.splice(i, 1)
    }
  }, [id, onClose, panelRef])

  const nested = scrim === 'nested'
  const chrome = variant === 'chrome'
  // The two looks, kept byte-for-byte as they shipped.
  const pad = chrome ? 'px-[26px] pb-[22px] pt-5' : 'p-[26px]'
  const headRow = chrome ? 'mb-4' : 'mb-5'
  const titleClass = chrome
    ? 'text-[14px] font-bold uppercase tracking-[0.12em] text-[var(--text)] [font-family:var(--font-archivo)]'
    : 'text-[15px] font-semibold text-[var(--text)]'

  const scrimStyle = nested
    ? { background: 'rgba(8,9,13,0.45)', backdropFilter: 'blur(6px)' }
    : { background: 'rgba(8,9,13,0.72)', backdropFilter: 'blur(2px)' }
  const scrimClass = `fixed inset-0 flex items-center justify-center ${nested ? 'z-[110]' : 'z-[100]'}`
  // --gsi-surface travels with the card colour it has to match: Google's
  // personalized sign-in button falls back to a white base, and globals.css
  // repaints it onto this value (see the .gsi-host rules there).
  const panelClass = `relative ${width} max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-[14px] border border-[rgba(255,255,255,0.1)] bg-[#0f1118] [--gsi-surface:#0f1118] ${pad} shadow-[0_30px_80px_rgba(0,0,0,0.6)]`
  const onScrimDown = (e: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
    if (dismissOnScrimClick && e.target === e.currentTarget) onClose()
  }

  const head = (
    <div className={`${headRow} flex items-center justify-between gap-3`}>
      <span className={titleClass}>{title}</span>
      <button
        onClick={onClose}
        aria-label={closeLabel}
        className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[8px] text-[var(--text-3)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] hover:text-[var(--text)] cursor-pointer"
      >
        <X size={14} />
      </button>
    </div>
  )

  return createPortal(
    animated ? (
      <MotionConfig reducedMotion="user">
        <motion.div
          className={scrimClass}
          style={scrimStyle}
          onPointerDown={onScrimDown}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.15, ease: 'easeIn' } }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={panelClass}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15, ease: 'easeIn' } }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            {head}
            {children}
          </motion.div>
        </motion.div>
      </MotionConfig>
    ) : (
      <div className={scrimClass} style={scrimStyle} onPointerDown={onScrimDown}>
        <div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} className={panelClass}>
          {head}
          {children}
        </div>
      </div>
    ),
    document.body,
  )
}

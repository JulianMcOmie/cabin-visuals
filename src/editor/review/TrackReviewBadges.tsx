'use client'

import { useSyncExternalStore } from 'react'
import { codeErrorForTrack, codeErrorsVersion, subscribeCodeErrors } from '../instruments/code/errors'
import { useCommentsStore, isLive } from './commentsStore'
import { useReviewStore } from './ReviewBar'

// Small marks on a timeline row's label: a code-instrument error (hover for the
// message), "made by a script" (re-running it keeps your hand edits), the row
// Claude just changed (Show on the review bar), and open comments pinned to it.
// Each subscribes per track, so a row re-renders only for its own marks.

export function TrackReviewBadges({ trackId, createdBy }: { trackId: string; createdBy?: string }) {
  useSyncExternalStore(subscribeCodeErrors, codeErrorsVersion, codeErrorsVersion)
  const error = codeErrorForTrack(trackId)
  const changed = useReviewStore((s) => s.highlight && s.changed.has(trackId))
  const comments = useCommentsStore((s) => (s.doc?.comments ?? []).filter((c) => c.trackId === trackId && isLive(c)).length)
  const firstComment = () => useCommentsStore.getState().doc?.comments.find((c) => c.trackId === trackId && isLive(c))
  if (!error && !createdBy && !changed && !comments) return null
  return (
    <span className="relative flex flex-shrink-0 items-center gap-1" data-strip-control="">
      {error && (
        <button
          className="flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-red-500/90 px-[3px] text-[9px] font-bold leading-none text-white"
          title={`${error.id} ${error.phase} failed at beat ${error.beat.toFixed(2)}: ${error.message}`}
          onClick={(e) => { e.stopPropagation(); console.error(error.stack ?? error.message) }}
        >!</button>
      )}
      {comments > 0 && (
        <button
          className="flex h-[14px] min-w-[14px] items-center justify-center rounded-[3px] bg-amber-500/90 px-[3px] text-[9px] font-bold leading-none text-black"
          title={`${comments} open comment${comments > 1 ? 's' : ''} on this track`}
          onClick={(e) => { e.stopPropagation(); const c = firstComment(); if (c) useCommentsStore.getState().focus(c.id) }}
        >{comments}</button>
      )}
      {changed && <span className="h-[7px] w-[7px] rounded-full bg-violet-400 shadow-[0_0_6px_rgba(167,139,250,0.9)]" title="Changed in Claude's last edit" />}
      {createdBy && (
        <span className="text-[9px] leading-none text-violet-300/70" title={`Made by ${createdBy} - re-running it keeps notes you edited by hand`}>{'</>'}</span>
      )}
    </span>
  )
}

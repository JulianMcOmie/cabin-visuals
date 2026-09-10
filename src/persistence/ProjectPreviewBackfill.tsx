'use client'

import { useEffect } from 'react'
import { useAuth } from './hooks/useAuth'
import { PreviewBackfillQueue } from './previewBackfillQueue'
import { previewBackfillBlockedInEditor, subscribePreviewBackfillActivity } from './previewBackfillActivity'
import { knownThumbnailProjects, publishThumbnailProjects, restoreProjectThumbnails, subscribeThumbnailProjects, withCachedThumbnail } from './projectThumbnailCache'
import type { ProjectSummary } from './projectStorage'

/** Root-layout lifetime: switching into another project leaves the queue alive.
 * Browsers without idle callbacks, workers or cross-tab locks opt out. */
export function ProjectPreviewBackfill() {
  const { user } = useAuth()
  const owner = user?.id
  useEffect(() => {
    if (!owner || !window.requestIdleCallback || !window.Worker || !window.OffscreenCanvas || !navigator.locks) return
    let stopped = false
    let idle: number | undefined
    let lastActivity = Date.now()
    let pointerDown = false
    const restored = restoreProjectThumbnails(owner)
    const seen = new Set<string>()
    const allowed = () => {
      const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
      const path = location.pathname
      return document.visibilityState === 'visible' && document.hasFocus() && navigator.onLine && !pointerDown &&
        !connection?.saveData && !['slow-2g', '2g'].includes(connection?.effectiveType ?? '') &&
        Date.now() - lastActivity >= 15_000 &&
        (path === '/projects' || (path === '/editor' && !previewBackfillBlockedInEditor()))
    }
    const add = (list: ProjectSummary[]) => {
      for (const project of list) {
        const key = `${project.id}:${project.rev}`
        if (!withCachedThumbnail(owner, project).preview?.image && !seen.has(key)) {
          seen.add(key)
          queue.enqueue(project)
        }
      }
    }
    const queue = new PreviewBackfillQueue<ProjectSummary | 'discover'>(['discover'], Date.now(), async (item, signal) => {
      // ifAvailable avoids a deferred callback starting work after its idle
      // opportunity has passed. The lock covers document fetch + worker + cache.
      await navigator.locks.request('cabin-project-thumbnail', { ifAvailable: true, mode: 'exclusive' }, async lock => {
        if (!lock) { queue.enqueue(item); return }
        if (!allowed() || signal.aborted) { queue.interrupt(Date.now()); return }
        if (item === 'discover') {
          await restored
          if (signal.aborted) return
          const known = knownThumbnailProjects(owner)
          if (known) add(known)
          else {
            const { list } = await import('./projectStorage')
            if (signal.aborted) return
            const projects = await list(AbortSignal.any([signal, AbortSignal.timeout(10_000)]))
            if (!signal.aborted) publishThumbnailProjects(owner, projects)
          }
        } else {
          if (item.id === new URLSearchParams(location.search).get('project')) {
            queue.enqueue(item)
            return
          }
          const { populateProjectThumbnail } = await import('./renderProjectThumbnail')
          if (!signal.aborted && allowed()) await populateProjectThumbnail(owner, item, signal)
        }
      })
    })
    const unsubscribeList = subscribeThumbnailProjects((account, list) => { if (account === owner) add(list) })
    const interrupt = () => {
      lastActivity = Date.now()
      queue.interrupt(lastActivity)
    }
    const down = () => { pointerDown = true; interrupt() }
    const up = () => { pointerDown = false; interrupt() }
    const blur = () => { pointerDown = false; interrupt() }
    const events = ['pointermove', 'keydown', 'keyup', 'wheel', 'touchmove', 'scroll', 'visibilitychange', 'offline', 'popstate', 'focus'] as const
    for (const event of events) window.addEventListener(event, interrupt, { passive: true, capture: true })
    window.addEventListener('pointerdown', down, { passive: true, capture: true })
    window.addEventListener('pointerup', up, { passive: true, capture: true })
    window.addEventListener('pointercancel', up, { passive: true, capture: true })
    window.addEventListener('blur', blur)
    const unsubscribeActivity = subscribePreviewBackfillActivity(interrupt)
    // Main-thread congestion can come from rendering or imports with no input.
    // Pause on that signal as well; observer delivery is itself asynchronous.
    let longTasks: PerformanceObserver | undefined
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      longTasks = new PerformanceObserver(interrupt)
      longTasks.observe({ type: 'longtask' })
    }
    // A cheap timer requests at most one idle callback. There is deliberately
    // no timeout option forcing the browser to run work on a saturated thread.
    const timer = window.setInterval(() => {
      if (!allowed() || idle !== undefined) return
      idle = window.requestIdleCallback(deadline => {
        idle = undefined
        if (!stopped) void queue.tick(Date.now(), allowed(), deadline.timeRemaining())
      })
    }, 5_000)
    return () => {
      stopped = true
      queue.stop()
      clearInterval(timer)
      if (idle !== undefined) window.cancelIdleCallback(idle)
      unsubscribeList(); unsubscribeActivity(); longTasks?.disconnect()
      for (const event of events) window.removeEventListener(event, interrupt, true)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      window.removeEventListener('blur', blur)
    }
  }, [owner])
  return null
}

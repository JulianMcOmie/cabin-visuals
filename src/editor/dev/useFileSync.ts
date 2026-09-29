import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { hydrate, serialize } from '../../persistence/serialize'
import { upgradeDocument } from '../../persistence/upgrade'
import { useProjectStore } from '../store/ProjectStore'
import { useAudioStore } from '../store/AudioStore'
import { useTimeStore } from '../store/TimeStore'
import { useUIStore } from '../store/UIStore'
import { useHistoryStore } from '../store/HistoryStore'
import { whenInstrumentsSettled } from '../instruments/lazyInstrument'
import { RESUME_KEY } from './hmrReload'
import { diffDocs, isEmptyDiff } from '../../devtools/docDiff'
import { useReviewStore } from '../review/ReviewBar'

// DEV-ONLY file sync: `/editor?file=<name>` binds the editor to the on-disk
// project `projects/<name>/project.json` (app/api/dev/projects). The file is
// the shared source of truth between you and the `cabin` CLI:
//
//   - the editor polls the file's version and re-hydrates when it changes
//     (the CLI wrote it), keeping the playhead and scroll where they were;
//   - edits made in the editor are serialized and PUT back (debounced), with
//     the version they were based on - a 409 means the file moved under us, and
//     the file wins (reload) rather than a silent clobber.
//
// `window.__cabinFileSync` exposes { file, version, reload(), whenSettled() }
// so tools can wait for a specific version before capturing frames.

declare global {
  interface Window {
    __cabinFileSync?: {
      file: string
      version: string | null
      loads: number
      reload: () => Promise<void>
      /** Resolves once lazy instrument chunks are in and the resolve has run. */
      whenSettled: () => Promise<void>
    }
  }
}

const POLL_MS = 500
const PUSH_DEBOUNCE_MS = 400

export function useFileSync() {
  const file = useSearchParams().get('file')

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || !file) return
    const base = `/api/dev/projects/${encodeURIComponent(file)}`
    let version: string | null = null
    let lastJson = ''
    let applying = false
    let stopped = false
    let busy = false
    let loads = 0
    let pushTimer: ReturnType<typeof setTimeout> | undefined

    const load = async () => {
      const r = await fetch(base, { cache: 'no-store' })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        console.error(`[file sync] could not load ${file}: ${body.error ?? r.status}`)
        return
      }
      const beat = useTimeStore.getState().currentBeat
      const { tracksScrollLeft, tracksScrollTop } = useUIStore.getState()
      const firstLoad = loads === 0
      // An external edit (the CLI) becomes exactly ONE undo step: seal whatever
      // the user was mid-way through, load, then seal the load.
      const history = useHistoryStore.getState()
      const before = firstLoad ? null : serialize()
      if (!firstLoad) history.checkpoint()
      applying = true
      try {
        hydrate(upgradeDocument(body.document))
        useUIStore.getState().setProjectName(file)
        if (!firstLoad) {
          // An external edit is not a project switch: stay where you were.
          useTimeStore.setState({ currentBeat: beat })
          useUIStore.setState({ tracksScrollLeft, tracksScrollTop })
        } else {
          // Back from a hot-reload reload (dev/hmrReload.ts): same playhead, same view.
          try {
            const resume = sessionStorage.getItem(RESUME_KEY)
            if (resume) {
              sessionStorage.removeItem(RESUME_KEY)
              const r = JSON.parse(resume) as { beat?: number; view?: 'main' | 'scene' }
              if (typeof r.beat === 'number') useTimeStore.getState().setCurrentBeat(r.beat)
              if (r.view) useUIStore.getState().setCanvasView(r.view)
            }
          } catch { /* storage blocked */ }
        }
        if (firstLoad) {
          history.reset()
        } else {
          const diff = diffDocs(before!, serialize())
          if (isEmptyDiff(diff)) history.discardPending()
          else {
            history.checkpoint()
            useReviewStore.getState().show(diff)
          }
        }
      } finally {
        applying = false
      }
      version = body.version
      lastJson = JSON.stringify(serialize())
      loads++
      if (window.__cabinFileSync) {
        window.__cabinFileSync.version = version
        window.__cabinFileSync.loads = loads
      }
    }

    const push = async () => {
      if (stopped || applying) return
      const doc = serialize()
      const json = JSON.stringify(doc)
      if (json === lastJson) return
      busy = true
      try {
        const r = await fetch(base, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ document: doc, baseVersion: version }),
        })
        if (r.status === 409) {
          console.warn('[file sync] the file changed under the editor - reloading it (the file wins)')
          await load()
          return
        }
        const body = await r.json()
        version = body.version
        lastJson = json
        if (window.__cabinFileSync) window.__cabinFileSync.version = version
      } finally {
        busy = false
      }
    }

    const poll = setInterval(async () => {
      if (stopped || busy || applying) return
      try {
        const r = await fetch(`${base}?versionOnly=1`, { cache: 'no-store' })
        if (!r.ok) return
        const { version: v } = await r.json()
        if (v && v !== version) {
          busy = true
          try { await load() } finally { busy = false }
        }
      } catch { /* dev server restarting */ }
    }, POLL_MS)

    const schedule = () => {
      if (applying) return
      clearTimeout(pushTimer)
      pushTimer = setTimeout(() => { void push() }, PUSH_DEBOUNCE_MS)
    }
    const unsubProject = useProjectStore.subscribe(schedule)
    const unsubAudio = useAudioStore.subscribe(schedule)

    window.__cabinFileSync = {
      file,
      version,
      loads,
      reload: async () => {
        busy = true
        try { await load() } finally { busy = false }
      },
      whenSettled: async () => {
        // The structural resolve is debounced (~80ms, up to ~1s in a hidden
        // tab); give it a beat, then wait out any lazy instrument chunk.
        await new Promise((r) => setTimeout(r, 250))
        await whenInstrumentsSettled()
      },
    }
    void load()

    return () => {
      stopped = true
      clearInterval(poll)
      clearTimeout(pushTimer)
      unsubProject()
      unsubAudio()
      delete window.__cabinFileSync
    }
  }, [file])
}

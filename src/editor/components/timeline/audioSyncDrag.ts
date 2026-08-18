import { getPlaybackEngine } from '../../core/playback'
import { getAudioEngine } from '../../core/audio/AudioEngine'
import { useProjectStore } from '../../store/ProjectStore'
import { useTimeStore } from '../../store/TimeStore'
import { useUIStore } from '../../store/UIStore'
import type { LoopRegion } from '../../core/loopRegion'
import type { Track } from '../../types'

// Sync mode: dragging an audio block keeps playback SOUNDING, looping a short
// section, so the alignment is tuned by ear and eye (the visualizer runs the
// same loop) instead of silently and blind. The classic drag mutes because
// per-pointermove re-arms stack into a runaway gain sum; this mode routes fresh
// audio through two bounded channels instead - the loop wrap's own seek() each
// pass, and a debounced re-arm once the pointer settles - while the store
// subscription's per-move re-arm stays suppressed (beginSyncDrag).

// Settle time before the moved audio is re-armed mid-loop. Short enough to feel
// live, long enough that a continuous drag never stacks re-arms.
const REARM_DEBOUNCE_MS = 140

/** The looped section: the user's enabled loop region if there is one,
 *  otherwise the bar the playhead sits in (move the playhead to pick a spot). */
function resolveLoop(): LoopRegion {
  const { loopRegion, currentBeat } = useTimeStore.getState()
  if (loopRegion?.enabled) return loopRegion
  const { beatsPerBar, totalBars } = useProjectStore.getState()
  const maxStart = Math.max(0, (totalBars - 1) * beatsPerBar)
  const startBeat = Math.min(maxStart, Math.floor(currentBeat / beatsPerBar) * beatsPerBar)
  return { startBeat, endBeat: startBeat + beatsPerBar, enabled: true }
}

interface SyncDragSession {
  /** Playback was started by the drag itself - restore the paused state on release. */
  autoStarted: boolean
  priorBeat: number
  rearmTimer: ReturnType<typeof setTimeout> | null
}

let session: SyncDragSession | null = null

/** First pointermove of an audio-block move: enter sync mode. */
export function beginAudioSyncDrag(trackId: string, blockId: string) {
  if (session) return
  const time = useTimeStore.getState()
  const loop = resolveLoop()
  session = { autoStarted: !time.isPlaying, priorBeat: time.currentBeat, rearmTimer: null }
  // Set BEFORE play(): usePlayback's getLoopRegion reads this override, so the
  // transport loops the sync section from its very first tick.
  useUIStore.getState().setAudioSyncDrag({ trackId, blockId, loop })
  const engine = getPlaybackEngine()
  engine.beginSyncDrag()
  if (session.autoStarted) {
    const audio = getAudioEngine()
    audio.setBlocks(Object.values(useProjectStore.getState().tracks).filter((t: Track) => t.type === 'audio'))
    time.setCurrentBeat(loop.startBeat)
    time.setIsPlaying(true)
    void audio.loadClips().then(() => engine.play(loop.startBeat))
  }
}

/** Every pointermove: schedule one re-arm for when the pointer settles. */
export function moveAudioSyncDrag() {
  if (!session) return
  if (session.rearmTimer) clearTimeout(session.rearmTimer)
  session.rearmTimer = setTimeout(() => {
    if (session) session.rearmTimer = null
    getPlaybackEngine().forceRearm()
  }, REARM_DEBOUNCE_MS)
}

/** Release: leave sync mode; if the drag auto-started playback, restore the
 *  paused state (kept playing when the transport was already running). */
export function endAudioSyncDrag() {
  if (!session) return
  const { autoStarted, priorBeat, rearmTimer } = session
  session = null
  if (rearmTimer) clearTimeout(rearmTimer)
  useUIStore.getState().setAudioSyncDrag(null)
  const engine = getPlaybackEngine()
  if (autoStarted) {
    engine.pause()
    const time = useTimeStore.getState()
    time.setIsPlaying(false)
    time.setCurrentBeat(priorBeat)
    engine.endBlockDrag() // clears the suppression; re-arm no-ops while paused
  } else {
    engine.endBlockDrag() // one re-arm at the final position, back on the user's loop
  }
}

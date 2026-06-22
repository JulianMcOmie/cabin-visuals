import { useEffect } from 'react'
import { useTimeStore } from '../store/TimeStore'

// Global transport keyboard shortcuts. Lives on a window listener so it works
// regardless of focus, but bails while typing in a field. Reads isPlaying via
// getState() (no re-subscribe), and play/pause are stable callbacks from usePlayback.
export function useTransportKeys({ play, pause, reset }: { play: () => void; pause: () => void; reset: () => void }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return

      if (e.code === 'Space') {
        // Stops the page from scrolling AND stops a focused button (e.g. Play) from
        // also activating on Space, which would double-toggle.
        e.preventDefault()
        if (useTimeStore.getState().isPlaying) pause()
        else play()
      } else if (e.code === 'Enter') {
        e.preventDefault()
        reset()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [play, pause, reset])
}

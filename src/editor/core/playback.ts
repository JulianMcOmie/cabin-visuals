import * as Tone from 'tone'

type BeatChangeCallback = (beat: number) => void

interface EngineCallbacks {
  onBeatChange: BeatChangeCallback
  getBpm: () => number
  getMaxBeat: () => number
  onEnd: () => void
}

class PlaybackEngine {
  private rafId: number | null = null
  private startBeat = 0
  private callbacks: EngineCallbacks | null = null

  init(callbacks: EngineCallbacks) {
    this.callbacks = callbacks
  }

  async play(startBeat: number) {
    if (!this.callbacks) return
    await Tone.start()
    const transport = Tone.getTransport()
    transport.stop()
    this.startBeat = startBeat
    transport.start()
    this.cancelBeatTracking()
    this.startBeatTracking()
  }

  pause() {
    Tone.getTransport().pause()
    this.cancelBeatTracking()
  }

  /** Jump the playing transport to a new beat without stopping it. */
  seek(beat: number) {
    this.startBeat = beat
    Tone.getTransport().seconds = 0
  }

  stop() {
    Tone.getTransport().stop()
    this.cancelBeatTracking()
    this.callbacks?.onBeatChange(0)
  }

  private startBeatTracking() {
    const tick = () => {
      if (!this.callbacks) return
      const { onBeatChange, getBpm, getMaxBeat, onEnd } = this.callbacks
      const elapsed = Tone.getTransport().seconds
      const beat = this.startBeat + elapsed * (getBpm() / 60)
      const maxBeat = getMaxBeat()

      if (beat >= maxBeat) {
        onBeatChange(maxBeat)
        onEnd()
        return
      }

      onBeatChange(beat)
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  private cancelBeatTracking() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }
}

let _engine: PlaybackEngine | null = null

export function getPlaybackEngine(): PlaybackEngine {
  if (!_engine) _engine = new PlaybackEngine()
  return _engine
}

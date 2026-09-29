import { useEffect, useRef } from 'react'
import { getAudioEngine } from '../../core/audio/AudioEngine'
import { useProjectStore } from '../../store/ProjectStore'
import { useTimeStore } from '../../store/TimeStore'

const SAMPLE_COUNT = 320
const VIEWBOX_HEIGHT = 100
const MIDLINE = VIEWBOX_HEIGHT / 2
const AMPLITUDE = 43

/** Live waveform for one audio track, stretched across its timeline lane. */
export function AudioTrackOscilloscope({ trackId, color }: { trackId: string; color: string }) {
  const traceRef = useRef<SVGPathElement>(null)

  useEffect(() => {
    let frame = 0
    const draw = () => {
      const trace = traceRef.current
      if (!trace) return

      const { currentBeat, isPlaying } = useTimeStore.getState()
      const { bpm, beatsPerBar } = useProjectStore.getState()
      const samples = getAudioEngine().getWaveformAtBeat(
        currentBeat,
        bpm,
        beatsPerBar,
        SAMPLE_COUNT,
        trackId,
      )

      let path = ''
      for (let i = 0; i < samples.length; i++) {
        const x = (i / (samples.length - 1)) * 1000
        const y = MIDLINE - Math.max(-1, Math.min(1, samples[i])) * AMPLITUDE
        path += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
      }
      trace.setAttribute('d', path)
      if (isPlaying) frame = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(frame)
  }, [trackId])

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 1000 ${VIEWBOX_HEIGHT}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
    >
      <path
        ref={traceRef}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

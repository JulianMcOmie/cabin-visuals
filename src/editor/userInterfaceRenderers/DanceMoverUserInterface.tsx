'use client'

import { useMemo, useRef } from 'react'
import { danceMover } from '../core/visualCopies/dance'
import { identityVisualCopy } from '../core/visualCopies/identityVisualCopy'
import { DANCE_COLOR } from '../core/visualCopies/identityColors'
import { prepareDanceCurves, sampleDanceAxis } from '../core/visualCopies/danceCurve'
import { consolePanel, PreviewWindow, usePreviewLoop } from './console'
import type { PanelPreviewProps } from './console/spec'

// An uneven phrase, including simultaneous X/Y events. Its home-pose margins
// make the independent demo loop smooth across its own wrap.
const DEMO_NOTES = [
  ...[1, 2, 2.5, 4].map(beat => ({ beat, pitch: 60 })),
  ...[1, 2.5, 4].map(beat => ({ beat, pitch: 62 })),
  ...[2, 4].map(beat => ({ beat, pitch: 64 })),
].map(note => ({ ...note, blockStartBeat: 0, blockEndBeat: 6, velocity: 1, durationBeats: 0.1 }))
const DEMO_CURVE = prepareDanceCurves(DEMO_NOTES)[0]
const PATH = Array.from({ length: 301 }, (_, i) => {
  const beat = i / 50
  return `${i ? 'L' : 'M'}${10 + beat * 50},${28 - sampleDanceAxis(DEMO_CURVE, beat) * 19}`
}).join(' ')

function DancePreview({ values }: PanelPreviewProps) {
  const subject = useRef<HTMLDivElement>(null)
  const cursor = useRef<SVGLineElement>(null)
  const resolved = useMemo(() => danceMover.resolve({
    notes: DEMO_NOTES,
    settings: { distanceX: values.distanceX ?? 1, distanceY: values.distanceY ?? 1, distanceZ: values.distanceZ ?? 1 },
  }), [values.distanceX, values.distanceY, values.distanceZ])
  const host = usePreviewLoop<HTMLDivElement>((seconds) => {
    const beat = (seconds * 2) % 6
    const [copy] = resolved.apply(identityVisualCopy(), { beat, index: 0, count: 1 })
    const e = copy.transform.elements
    // Compress large settings into this illustrative field, preserving zeros
    // and direction. The curve below shows the exact normalized X motion.
    const px = (v: number) => 30 * v / (1 + Math.abs(v) * 0.4)
    if (subject.current) subject.current.style.transform = `translate3d(${px(e[12])}px,${-px(e[13])}px,${px(e[14])}px)`
    cursor.current?.setAttribute('x1', String(10 + beat * 50))
    cursor.current?.setAttribute('x2', String(10 + beat * 50))
  })
  return <div ref={host}>
    <PreviewWindow height={112} title="Demo at 120 BPM. Dots mark fast center crossings on the X curve; the square follows all three axes. Note length and velocity are ignored. Dance anticipates the first note and settles after the last, across clip edges.">
      <div className="relative h-[64px] overflow-hidden" style={{ perspective: 240 }}>
        <div className="absolute left-1/2 top-1/2 h-px w-20 -translate-x-1/2 bg-white/10" />
        <div className="absolute left-1/2 top-1/2 h-12 w-px -translate-y-1/2 bg-white/10" />
        <div className="absolute left-1/2 top-1/2 -ml-2 -mt-2">
          <div ref={subject} className="h-4 w-4 rounded-sm" style={{ background: DANCE_COLOR, boxShadow: `0 0 16px ${DANCE_COLOR}88` }} />
        </div>
        <span className="absolute right-2 top-2 text-[8px] tracking-widest text-[var(--text-muted)]">DEMO · 120 BPM</span>
      </div>
      <svg viewBox="0 0 320 56" className="h-[48px] w-full" role="img" aria-label="X motion crosses center at each beat dot, turning between beats">
        <path d="M10 28H310" stroke="currentColor" opacity="0.15" />
        <path d={PATH} fill="none" stroke={DANCE_COLOR} strokeWidth="1.5" />
        {DEMO_CURVE.beats.map(beat => <circle key={beat} cx={10 + beat * 50} cy={28} r={3} fill={DANCE_COLOR} />)}
        <line ref={cursor} x1={10} x2={10} y1={3} y2={53} stroke="currentColor" opacity="0.4" />
      </svg>
    </PreviewWindow>
    <p className="px-3 py-2 text-[10px] leading-relaxed text-[var(--text-muted)]">
      Notes mark fast center crossings. Direction alternates automatically. Swing sets maximum travel; uneven beats can make smaller swings.
    </p>
  </div>
}

export const DanceMoverUserInterfaceRenderer = consolePanel({
  accent: DANCE_COLOR,
  testId: 'dance-console',
  preview: DancePreview,
  rows: [{ row: ['distanceX:X', 'distanceY:Y', 'distanceZ:Z'] }],
})

'use client'

import { useMemo, useRef } from 'react'
import { Matrix4, Vector3 } from 'three'
import { pathPoint, pathSplitter, type PathSettings } from '../core/visualCopies/path'
import { mergeDefinitionSettings } from '../core/visualCopies/definitions'
import { resolveVisualCopies } from '../core/visualCopies/resolveVisualCopies'
import { PATH_COLOR } from '../core/visualCopies/identityColors'
import { consolePanel, usePreviewLoop, type PanelPreviewProps } from './console'
import type { UserInterfaceRendererDefinition } from './types'

function PathPreview({ values, strings }: PanelPreviewProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const settings = useMemo(() => mergeDefinitionSettings(pathSplitter, values, strings) as unknown as PathSettings, [values, strings])
  const entry = useMemo(() => pathSplitter.resolve({ settings, notes: [
    { pitch: 60, beat: 0, durationBeats: 4, velocity: 1, blockStartBeat: 0, blockEndBeat: 8 },
    { pitch: 61, beat: 4, durationBeats: 4, velocity: 1, blockStartBeat: 0, blockEndBeat: 8 },
  ] }), [settings])
  const host = usePreviewLoop<HTMLDivElement>(seconds => {
    const el = canvas.current, ctx = el?.getContext('2d')
    if (!el || !ctx || !host.current) return
    const width = host.current.clientWidth, height = 155
    if (!width) return
    const dpr = window.devicePixelRatio || 1
    if (el.width !== width * dpr || el.height !== height * dpr) {
      el.width = width * dpr; el.height = height * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const beat = seconds % 8
    const orientation = new Matrix4().makeRotationZ(settings.angle * Math.PI / 180)
      .multiply(new Matrix4().makeRotationX(settings.tilt * Math.PI / 180))
    const guide = Array.from({ length: 193 }, (_, i) =>
      new Vector3(...pathPoint(settings, i / 192, beat)).applyMatrix4(orientation))
    const reach = Math.max(1, settings.length / 2, settings.loopHeight / 2,
      Math.abs(settings.bend) + settings.amplitude) + Math.max(settings.startSize, settings.endSize) * settings.size * 0.25
    const scale = Math.min(width * 0.44, height * 0.4) / reach
    const project = (p: Vector3) => [width / 2 + (p.x + p.z * 0.3) * scale, height / 2 - (p.y + p.z * 0.25) * scale]
    ctx.strokeStyle = '#ffffff30'; ctx.lineWidth = 1
    ctx.beginPath()
    guide.forEach((p, i) => {
      const [x, y] = project(p)
      if (i) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
    })
    ctx.stroke()
    const copies = resolveVisualCopies([entry], beat)
    for (const copy of copies) {
      const e = copy.transform.elements
      const [x, y] = project(new Vector3(e[12], e[13], e[14]))
      const radius = Math.max(0.5, Math.hypot(e[0], e[1], e[2]) * scale * 0.23)
      ctx.globalAlpha = copy.opacity
      ctx.fillStyle = copy.colorShift.tint ?? PATH_COLOR
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
  })
  return <>
    <div ref={host} className="relative h-[155px] overflow-hidden bg-[#05070c]" data-testid="path-preview">
      <canvas ref={canvas} className="h-full w-full" aria-label="Preview of copies moving along the path" />
      <span className="absolute bottom-2 left-3 text-[8px] tracking-wider text-[var(--text-muted)]">{settings.motion === 0 ? 'DEMO · FORWARD / REVERSE' : 'MOTION PREVIEW'}</span>
    </div>
    <p className="px-4 pt-2 text-[10px] text-[var(--text-muted)]">
      {settings.pathMode === 1 ? 'Loop: size and color reach their end values halfway around, then return smoothly.' : 'Size and color follow position. Copies disappear beyond either end.'}
      {' '}MIDI: hold a row for 1×, 2×, or 4× travel in either direction; release to stop.
    </p>
  </>
}

const PathConsole = consolePanel({
  accent: PATH_COLOR,
  testId: 'path-user-interface',
  preview: PathPreview,
  rows: [
    { segmented: 'pathMode', name: 'Path' },
    { row: ['copies', 'length*:WIDTH', 'size'], spill: true },
    { row: [{ param: 'bend', bipolar: true, optional: true }, 'loopHeight?:HEIGHT', 'amplitude:WAVE', 'frequency:CYCLES'] },
    { segmented: 'motion', name: 'Motion' },
    { row: ['speed*', { param: 'waveRate', label: 'WAVE RATE', bipolar: true }] },
    { row: ['startSize:SIZE', { pill: 'startColor', label: 'START' }], gutter: 'Start' },
    { row: ['endSize:SIZE', { pill: 'endColor', label: 'END' }], gutter: 'End' },
    { row: ['fadeStart?:FADE IN', 'fadeEnd?:FADE OUT', 'colorAmount:COLOR MIX'] },
  ],
  moreLabel: 'ORIENTATION',
})

// Splitter panels receive the full schema (unlike instrument panels, which
// are filtered by TrackEditor). Keep open-only controls out of loop mode.
export const PathSplitterUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ targetId, parameters }) => {
  const mode = parameters.find(p => p.definition.key === 'pathMode')?.value ?? 0
  const visible = parameters.filter(p => !p.definition.showIf
    || p.definition.showIf === `pathMode=${mode}`)
  return <PathConsole targetId={targetId} parameters={visible} />
}

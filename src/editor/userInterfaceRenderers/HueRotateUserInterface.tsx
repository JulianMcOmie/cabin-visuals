'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Color } from 'three'
import { applyColorShiftToColor } from '../core/visual/colorShift'
import { hueRotateColorizer, type HueRotateSettings, HUE_MAP_INDEX } from '../core/visualCopies/hueRotate'
import { identityVisualCopy } from '../core/visualCopies/identityVisualCopy'
import { mergeDefinitionSettings } from '../core/visualCopies/definitions'
import { HUE_ROTATE_COLOR } from '../core/visualCopies/identityColors'
import { bindPanel, Console, ControlRow, Knob, LaserKnob, More, ParameterList, PreviewWindow, Segmented, usePreviewLoop } from './console'
import type { UserInterfaceRendererDefinition } from './types'

const MAP_OPTIONS = [
  { value: 0, label: 'X' }, { value: 1, label: 'Y' },
  { value: 2, label: 'Radial' }, { value: 3, label: 'Sphere' },
  { value: 4, label: 'Depth' }, { value: 5, label: 'Index' },
]
const turns = (v: number) => `${Math.round(v * 360)}°`
const rate = (v: number) => `${Number(v.toFixed(3))}`

/** An illustrative ring of copies, evaluated by the actual colorizer. The inner
 * ring retains the source palette; the outer ring shows the resulting colors.
 * This is a demo clock at 120 BPM, independent of the composition transport. */
function HuePreview({ settings }: { settings: HueRotateSettings }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const resolved = useMemo(() => hueRotateColorizer.resolve({ settings, notes: [] }), [settings])
  const draw = (seconds: number) => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const width = el.clientWidth
    const height = el.clientHeight
    if (!width || !height) return
    const dpr = window.devicePixelRatio || 1
    if (el.width !== Math.round(width * dpr) || el.height !== Math.round(height * dpr)) {
      el.width = Math.round(width * dpr)
      el.height = Math.round(height * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const cx = width / 2, cy = height / 2
    const color = new Color(), tint = new Color()
    for (let i = 0; i < 48; i++) {
      const angle = i / 48 * Math.PI * 2 - Math.PI / 2
      const input = identityVisualCopy()
      // A tilted ring gives each spatial map meaningful demo coordinates.
      input.transform.makeTranslation(3 * Math.cos(angle), 2 * Math.sin(angle), 2 * Math.cos(angle))
      const [output] = resolved.apply(input, { beat: seconds * 2, index: i, count: 48 })
      const source = new Color().setHSL(i / 48, 0.65, 0.55)
      for (const radius of [32, 46]) {
        color.copy(source)
        if (radius === 46) applyColorShiftToColor(color, output.colorShift, tint)
        ctx.beginPath()
        ctx.arc(cx, cy, radius, angle, angle + Math.PI * 2 / 48 - 0.018)
        ctx.strokeStyle = `#${color.getHexString()}`
        ctx.lineWidth = radius === 46 ? 9 : 3
        ctx.stroke()
      }
    }
    ctx.textAlign = 'center'
    ctx.font = '9px monospace'
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.fillText(settings.continuous >= 0.5 ? 'CYCLING' : 'FIXED', cx, cy + 3)
  }
  const host = usePreviewLoop<HTMLDivElement>(draw)
  // Paint immediately on edits, even before the first animation callback.
  useEffect(() => { draw(0) })
  return <PreviewWindow height={116} title="Demo palette: inner ring is the source, outer ring is the result. Continuous preview runs at 120 BPM.">
    <div ref={host} className="relative h-full">
      <canvas ref={canvas} className="h-full w-full" role="img" aria-label="Hue rotation preview: source palette inside, rotated palette outside" />
      <div className="pointer-events-none absolute bottom-2 left-3 text-[8px] tracking-[0.12em] text-white/30">IN → OUT</div>
      <div className="pointer-events-none absolute bottom-2 right-3 text-[8px] tracking-[0.12em] text-white/30">DEMO · 120 BPM</div>
    </div>
  </PreviewWindow>
}

export const HueRotateUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const pool = bindPanel(parameters)
  const rotate = pool.num('rotate')
  const continuous = pool.boolean('continuous')
  const speed = pool.num('speed', { optional: true })
  const spread = pool.num('spread')
  const mode = pool.select('mode')
  const circle = pool.select('hueMode')
  const span = pool.num('span')
  const offset = pool.num('offset')
  const saturation = pool.num('saturation')
  const lightness = pool.num('lightness')
  const settings = useMemo(() => ({
    ...mergeDefinitionSettings(hueRotateColorizer, undefined),
    ...Object.fromEntries(parameters.map(p => [p.definition.key, p.value])),
  }) as unknown as HueRotateSettings, [parameters])
  if (pool.missing || !continuous) return <ParameterList parameters={parameters} />
  const running = continuous.value >= 0.5
  return <Console accent={HUE_ROTATE_COLOR} testId="hue-rotate-user-interface">
    <HuePreview settings={settings} />
    <div className="px-3 pt-2">
      <Segmented name="Rotation mode" value={continuous.value} onChange={continuous.set}
        options={[{ value: 0, label: 'Fixed' }, { value: 1, label: 'Continuous' }]} />
    </div>
    <ControlRow spill className="justify-around gap-2 px-3 pb-2 pt-2">
      <Knob b={rotate} label="ROTATE" ariaLabel="Hue rotation" large format={turns} />
      <Knob b={spread} label="SPREAD" ariaLabel="Hue spread" bipolar format={turns} />
      <LaserKnob value={speed?.value ?? 0.125} min={-2} max={2} step={0.005} defaultValue={0.125}
        onChange={v => speed?.set(v)} label="RATE" ariaLabel="Hue rotation rate in turns per beat"
        accent={HUE_ROTATE_COLOR} bipolar disabled={!running || !speed} format={rate} suffix="/b" />
    </ControlRow>
    <details className="border-t border-white/[0.06] px-3 py-2">
      <summary className="cursor-pointer text-[8px] font-bold tracking-[0.14em] text-white/40 hover:text-white/70">MAPPING & COLOR</summary>
      <div className="mt-3 space-y-3">
        <div><div className="mb-1 text-[9px] tracking-widest text-white/40">MAP</div><Segmented b={mode} options={MAP_OPTIONS} name="Hue spread mapping" /></div>
        {mode?.value !== HUE_MAP_INDEX && <ControlRow className="justify-around gap-2">
          <Knob b={span} label="SPAN" suffix="u" />
          <Knob b={offset} label="OFFSET" bipolar suffix="u" />
        </ControlRow>}
        <div><div className="mb-1 text-[9px] tracking-widest text-white/40">COLOR SPACE</div><Segmented b={circle} name="Hue color space" /></div>
        <ControlRow className="justify-around gap-2 pb-1">
          <Knob b={saturation} label="SATURATION" bipolar format={v => `${Math.round(v * 100)}%`} />
          <Knob b={lightness} label="LIGHTNESS" bipolar format={v => `${Math.round(v * 100)}%`} />
        </ControlRow>
      </div>
    </details>
    <More parameters={pool.rest()} />
  </Console>
}

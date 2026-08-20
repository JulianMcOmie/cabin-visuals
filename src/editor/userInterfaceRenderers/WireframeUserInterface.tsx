'use client'

// Wireframe's console: a tabbed SHELF of live shape previews (3 rows,
// 5 columns visible, horizontal scroll - the picked layout from the
// 2026-08-13 mock round) over the knob rows. The previews draw the
// instrument's real polylines from wireframeCore on a 2D canvas, so the
// shelf cannot drift from what renders; rAF-driven rotation is panel
// chrome, not the visual (the pause rule governs the rendered scene only).

import { useEffect, useRef, useState } from 'react'
import { bindPanel } from './console/bindings'
import { Console, ControlRow } from './console/Console'
import { Knob } from './console/Knob'
import { Segmented } from './console/Segmented'
import { More } from './console/More'
import { usePreviewLoop } from './console/previewLoop'
import { ParameterList } from './ParametersUserInterface'
import { ColorWheelPopover, hexToHsv, hsvToHex } from './colorWheel'
import {
  WIREFRAME_SHAPES,
  wireframeGeometry,
  wireframeIsFlat,
  type WireframePolyline,
} from '../instruments/wireframeCore'
import type { UserInterfaceRendererDefinition } from './types'

const CATEGORIES = [
  { value: 0, label: 'All' },
  { value: 1, label: '2D' },
  { value: 2, label: '3D' },
  { value: 3, label: 'Cool' },
] as const
const CATEGORY_KEYS = [undefined, '2d', '3d', 'cool'] as const

// One detail step for every preview: mid-smooth, cheap to draw at 56px.
const PREVIEW_DETAIL_STEP = 4
const SOLID_TILT = 0.45

const previewGeometry: WireframePolyline[][] = WIREFRAME_SHAPES.map((_, index) =>
  wireframeGeometry(index, PREVIEW_DETAIL_STEP))

/** The mock's projection verbatim: idle spin (in-plane for flat shapes, tilted
 *  Y-tumble for solids) through a mild perspective divide. */
function drawShapePreview(
  canvas: HTMLCanvasElement, shapeIndex: number, now: number, color: string, emphasized: boolean,
) {
  const dpr = window.devicePixelRatio || 1
  const width = canvas.clientWidth
  if (!width) return
  const target = Math.round(width * dpr)
  if (canvas.width !== target) { canvas.width = target; canvas.height = target }
  const g = canvas.getContext('2d')
  if (!g) return
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, width, width)
  g.strokeStyle = color
  g.globalAlpha = emphasized ? 1 : 0.62
  g.lineWidth = 1
  g.lineJoin = g.lineCap = 'round'
  const flat = wireframeIsFlat(shapeIndex)
  const angle = now * 0.0005 + shapeIndex * 0.7
  const cosY = Math.cos(angle), sinY = Math.sin(angle)
  const cosX = Math.cos(SOLID_TILT), sinX = Math.sin(SOLID_TILT)
  const radius = width * 0.36
  const center = width / 2
  for (const line of previewGeometry[shapeIndex]) {
    g.beginPath()
    for (let i = 0; i < line.length; i++) {
      let [x, y, z] = line[i]
      if (flat) {
        const c = Math.cos(angle * 0.5), s = Math.sin(angle * 0.5)
        ;[x, y] = [x * c - y * s, x * s + y * c]
      } else {
        ;[x, z] = [x * cosY + z * sinY, -x * sinY + z * cosY]
        ;[y, z] = [y * cosX - z * sinX, y * sinX + z * cosX]
      }
      const f = 2.8 / (2.8 - z)
      const px = center + x * radius * f
      const py = center - y * radius * f
      if (i === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.stroke()
  }
  g.globalAlpha = 1
}

/** Quick hue ring around the current color; the center swatch opens the full
 *  standard editor (the shared wheel + brightness popover). */
function HueRing({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const hsv = hexToHsv(value)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    window.addEventListener('pointerdown', (event) => {
      if (!hostRef.current?.contains(event.target as Node)) setOpen(false)
    }, { signal: controller.signal, capture: true })
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setOpen(false)
    }, { signal: controller.signal })
    return () => controller.abort()
  }, [open])

  const hueFromPointer = (clientX: number, clientY: number) => {
    const rect = ringRef.current?.getBoundingClientRect()
    if (!rect) return
    const dx = clientX - (rect.left + rect.width / 2)
    const dy = clientY - (rect.top + rect.height / 2)
    const hue = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360
    // A drag on the ring must visibly recolor: revive a near-grey to a
    // saturated voice instead of spinning an invisible hue.
    onChange(hsvToHex(hue, Math.max(hsv.s, 0.55), Math.max(hsv.v, 0.5)))
  }

  const markerAngle = (hsv.h - 90) * Math.PI / 180

  return (
    <div ref={hostRef} className="relative ml-auto flex min-w-0 flex-col items-center">
      <div
        ref={ringRef}
        role="slider"
        aria-label="Hue"
        aria-valuenow={Math.round(hsv.h)}
        className="relative h-9 w-9 cursor-crosshair touch-none rounded-full"
        style={{
          background: 'conic-gradient(#f00, #ff0 60deg, #0f0 120deg, #0ff 180deg, #00f 240deg, #f0f 300deg, #f00 360deg)',
          // Punch the disc into a ring; the center stays clickable via the button.
          WebkitMask: 'radial-gradient(circle closest-side, transparent 62%, #000 66%)',
          mask: 'radial-gradient(circle closest-side, transparent 62%, #000 66%)',
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          hueFromPointer(event.clientX, event.clientY)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) hueFromPointer(event.clientX, event.clientY)
        }}
      >
        <span
          className="pointer-events-none absolute h-2 w-2 rounded-full border border-white/80"
          style={{
            left: `calc(50% + ${Math.cos(markerAngle) * 16}px - 4px)`,
            top: `calc(50% + ${Math.sin(markerAngle) * 16}px - 4px)`,
            background: value,
          }}
        />
      </div>
      <button
        type="button"
        aria-label="Open color editor"
        aria-expanded={open}
        title={`Color ${value}`}
        onClick={() => setOpen((o) => !o)}
        className="absolute top-[7px] left-1/2 h-[22px] w-[22px] -translate-x-1/2 cursor-pointer rounded-full border border-white/15 transition-transform active:scale-95"
        style={{ background: value }}
      />
      <span className="mt-1 text-[8px] font-semibold tracking-[0.12em] text-white/40">COLOR</span>
      <span className="font-mono text-[9px] uppercase text-white/70">{value}</span>
      {open && <ColorWheelPopover value={value} onChange={onChange} align="right" edge="bottom" />}
    </div>
  )
}

export const WireframeUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const shape = b.select('shape')
  const color = b.color('color')
  const sizeKnob = b.num('size')
  const glow = b.num('glow')
  const weight = b.num('weight')
  const detail = b.num('detail')
  const spin = b.num('spin')

  const [category, setCategory] = useState(0)
  const cellCanvases = useRef(new Map<number, HTMLCanvasElement>())
  const selected = Math.round(shape?.value ?? 0)
  const accent = color?.value ?? '#7dd3fc'
  const accentRef = useRef(accent)
  accentRef.current = accent
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  // One shared loop tick for every visible cell - panel chrome, exempt from
  // the pause rule. The shelf div is the loop's visibility host.
  const shelfRef = usePreviewLoop((tSec) => {
    for (const [index, canvas] of cellCanvases.current) {
      drawShapePreview(canvas, index, tSec * 1000, accentRef.current, index === selectedRef.current)
    }
  })

  // Land the shelf on the current shape when the panel opens.
  useEffect(() => {
    cellCanvases.current.get(selectedRef.current)?.closest('button')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [])

  if (b.missing) return <ParameterList parameters={parameters} />

  const categoryKey = CATEGORY_KEYS[category]
  const shown = WIREFRAME_SHAPES
    .map((def, index) => ({ def, index }))
    .filter(({ def }) => !categoryKey || def.category === categoryKey)

  return (
    <Console accent={accent} testId="wireframe-user-interface">
      <div className="px-4 pt-2">
        <Segmented options={CATEGORIES} value={category} onChange={setCategory} name="Shape category" />
      </div>
      <div
        ref={shelfRef}
        className="mx-3 mt-2 grid snap-x snap-proximity gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]"
        style={{ gridAutoFlow: 'column', gridTemplateRows: 'repeat(3, auto)', gridAutoColumns: 'calc((100% - 24px) / 5)' }}
      >
        {shown.map(({ def, index }) => (
          <button
            key={def.id}
            type="button"
            title={def.name}
            aria-pressed={index === selected}
            onClick={() => shape?.set(index)}
            className={`snap-start rounded-[7px] border p-[3px] text-center transition-colors ${
              index === selected ? 'bg-white/[0.05]' : 'border-white/[0.07] bg-white/[0.015] hover:border-white/30'
            }`}
            style={index === selected ? { borderColor: accent } : undefined}
          >
            <canvas
              className="block aspect-square w-full"
              ref={(canvas) => {
                if (canvas) cellCanvases.current.set(index, canvas)
                else cellCanvases.current.delete(index)
              }}
            />
            <div className="truncate pb-[2px] text-[9px] leading-tight text-white/50">{def.name}</div>
          </button>
        ))}
      </div>
      <ControlRow spill>
        <Knob b={sizeKnob} large />
        <Knob b={glow} />
        <Knob b={weight} />
        {color && <HueRing value={color.value} onChange={color.set} />}
      </ControlRow>
      <ControlRow className="gap-5 px-4 pb-4 pt-0">
        <Knob b={detail} />
        <Knob b={spin} bipolar />
      </ControlRow>
      <More parameters={b.rest()} />
    </Console>
  )
}

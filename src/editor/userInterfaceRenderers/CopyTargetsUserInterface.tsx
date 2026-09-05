'use client'

// The COPIES console of the inspector's Targets tab: which of the copies
// reaching this mover/splitter row it acts on.
//
// The panel is one decision (ALL, or a pattern) over one window, and the window
// carries the whole readout - there is deliberately no caption line and no
// n-of-m tally. It draws the REAL incoming formation (the prefix chain from
// resolve.ts, resolved per frame at the live beat), lit for targeted and hollow
// for skipped, so the pattern is read rather than described. That matters most
// where the words can't say it: emission order is raster order, so "every other
// copy" on an even-width grid comes out as stripes rather than a checkerboard,
// and the picture shows that before you would think to ask.
//
// A plain 2D canvas rather than r3f, for the reason the Grid panel documents: a
// panel <Canvas> stays black until the transport plays, and a selection is
// exactly what you dial in while paused.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Track } from '../types'
import { useProjectStore } from '../store/ProjectStore'
import { useTimeStore } from '../store/TimeStore'
import { getPriorChainPrefix } from '../core/visual/resolve'
import { resolveVisualCopies } from '../core/visualCopies/resolveVisualCopies'
import {
  COPY_TARGET_MAX_SLICES,
  COPY_TARGET_MIN_SLICES,
  copyTargetMask,
  copyTargetSliceOf,
  copyTargetSlices,
  normalizeCopyTargets,
  type CopyTargetRule,
} from '../core/visualCopies/copyTargets'
import { resolveTrackIdentityColor } from '../utils/trackDisplayColor'
import { Console, PreviewWindow, Segmented, GutterRow, usePreviewLoop } from './console'
import { hexToHsv, hsvToHex, towardWhite, withAlpha } from './colorWheel'
import type { CopyTargets } from '../types'
import { clamp } from '../utils/math'
import { hexToRgb } from '../utils/colors'

/** Each slice gets its own hue off the accent, so a chip and the copies it owns
 *  are the same colour and the picture needs no legend. The spread is kept
 *  narrow (±26°) - these are members of one family, not separate devices. */
function sliceColor(accent: string, index: number, count: number): string {
  if (count <= 1) return accent
  const { h, s, v } = hexToHsv(accent)
  const spread = 52
  const shift = -spread / 2 + (spread * index) / (count - 1)
  return hsvToHex((h + shift + 360) % 360, s, v)
}

const RULE_OPTIONS: { value: number; rule: CopyTargetRule }[] = [
  { value: 0, rule: 'every' },
  { value: 1, rule: 'runs' },
]

/** The two rules as pictures: three dots with the acted-on ones filled. */
function RuleGlyph({ rule }: { rule: CopyTargetRule }) {
  const filled = rule === 'every' ? [true, false, true] : [true, true, false]
  return (
    <svg width="17" height="11" viewBox="0 0 17 11" aria-hidden="true">
      {filled.map((on, i) => (
        <circle
          key={i}
          cx={2.9 + i * 5.6}
          cy={5.5}
          r={1.7}
          fill={on ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth={on ? 0 : 1.1}
          opacity={on ? 1 : 0.75}
        />
      ))}
    </svg>
  )
}

// ── the window ───────────────────────────────────────────────────────────────

const PREVIEW_HEIGHT = 146
const DOT_BUDGET = 400

function FormationWindow({
  trackId, accent, targets, onCount, onPickCopy,
}: {
  trackId: string
  accent: string
  targets: CopyTargets | undefined
  /** The real copy count, reported up from the painted frame - the only place
   *  that knows it, and what sizes the stepper's ceiling and the chip row. */
  onCount: (count: number) => void
  onPickCopy: (index: number, count: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef({ yaw: -0.5, pitch: 0.32, auto: true })
  const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number; moved: boolean } | null>(null)
  // Screen positions of the last painted frame, so a click can hit-test copies
  // without re-deriving the projection.
  const hitsRef = useRef<{ x: number; y: number; index: number }[]>([])

  // The prefix walks the subtree, so it is memoized on the document rather than
  // rebuilt per frame; only `resolveVisualCopies` runs in the draw loop.
  const tracksVersion = useProjectStore((s) => s.tracks)
  const prefix = useMemo(
    () => getPriorChainPrefix(trackId, useProjectStore.getState()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackId, tracksVersion],
  )

  const live = useRef({ prefix, targets, accent, onCount })
  live.current = { prefix, targets, accent, onCount }

  // The draw closes over the 2D context built in the effect; the shared loop
  // (~30fps, offscreen-gated) calls whatever the current mount stashed here.
  const drawImpl = useRef<((tSec: number) => void) | null>(null)
  const hostRef = usePreviewLoop<HTMLDivElement>((tSec) => drawImpl.current?.(tSec))

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    // The auto-orbit advances by elapsed TIME, not by frame count, so the
    // shared loop's frame rate is not also the orbit's speed.
    let lastT = 0

    drawImpl.current = (tSec: number) => {
      const dt = tSec - lastT
      lastT = tSec
      const host = hostRef.current
      if (!host) return
      const w = host.clientWidth
      const h = host.clientHeight
      if (w === 0 || h === 0) return
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      // The live beat, read imperatively: subscribing would re-render this panel
      // on every frame of playback.
      const beat = useTimeStore.getState().currentBeat
      const current = live.current
      const copies = resolveVisualCopies(current.prefix, beat)
      const total = copies.length
      current.onCount(total)
      if (total === 0) return
      const mask = copyTargetMask(total, current.targets)
      const slices = current.targets ? copyTargetSlices(current.targets, total) : 1

      const view = viewRef.current
      if (view.auto) view.yaw += 0.132 * dt // 0.0022/frame at the old 60fps
      const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw)
      const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch)

      let reach = 0.001
      const points: [number, number, number][] = []
      for (const copy of copies) {
        const e = copy.transform.elements
        const x = e[12], y = e[13], z = e[14]
        points.push([x, y, z])
        reach = Math.max(reach, Math.hypot(x, y, z) + Math.hypot(e[0], e[1], e[2]) * 0.5)
      }
      const pxScale = (Math.min(w, h) * 0.40) / reach
      const camera = reach * 3.6
      const cx = w / 2, cyPx = h / 2

      const rotate = (x: number, y: number, z: number): [number, number, number] => {
        const x1 = cy * x + sy * z
        const z1 = -sy * x + cy * z
        return [x1, cp * y - sp * z1, sp * y + cp * z1]
      }

      const drawn: { x: number; y: number; index: number; depth: number; f: number }[] = []
      for (let i = 0; i < total; i++) {
        const [rx, ry, rz] = rotate(points[i][0], points[i][1], points[i][2])
        const f = camera / Math.max(camera - rz, camera * 0.2)
        drawn.push({ x: cx + rx * pxScale * f, y: cyPx - ry * pxScale * f, index: i, depth: rz, f })
      }
      hitsRef.current = drawn.map((d) => ({ x: d.x, y: d.y, index: d.index }))
      drawn.sort((a, b) => a.depth - b.depth)

      const dot = clamp(Math.min(w, h) * 0.033, 2.2, total > DOT_BUDGET ? 2.6 : 5.2)
      for (const d of drawn) {
        const on = mask[d.index]
        const r = dot * clamp(d.f, 0.6, 1.5)
        if (on) {
          // A targeted copy wears its SLICE's colour, so the chips below need no
          // legend - the picture and the chip are the same hue.
          const hue = current.targets
            ? sliceColor(current.accent, copyTargetSliceOf(d.index, total, current.targets), slices)
            : current.accent
          const [rr, gg, bb] = hexToRgb(hue)
          const glow = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, r * 3.2)
          glow.addColorStop(0, `rgba(${rr},${gg},${bb},0.42)`)
          glow.addColorStop(1, `rgba(${rr},${gg},${bb},0)`)
          ctx.fillStyle = glow
          ctx.beginPath()
          ctx.arc(d.x, d.y, r * 3.2, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = towardWhite(hue, 0.45)
          ctx.beginPath()
          ctx.arc(d.x, d.y, r, 0, Math.PI * 2)
          ctx.fill()
        } else {
          // Skipped copies stay visible as hollow rings: they are still in the
          // formation, they just pass through this device untouched.
          ctx.strokeStyle = 'rgba(255,255,255,0.22)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(d.x, d.y, r * 0.78, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
    }

    return () => { drawImpl.current = null }
    // hostRef is the loop hook's stable ref - listed only to satisfy the lint.
  }, [hostRef])

  return (
    <PreviewWindow height={PREVIEW_HEIGHT} className="cursor-grab active:cursor-grabbing">
      <div
        ref={hostRef}
        className="absolute inset-0"
        onPointerDown={(e) => {
          const view = viewRef.current
          dragRef.current = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch, moved: false }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current
          if (!drag) return
          const dx = e.clientX - drag.x, dy = e.clientY - drag.y
          if (Math.hypot(dx, dy) > 3) drag.moved = true
          viewRef.current.auto = false
          viewRef.current.yaw = drag.yaw + dx * 0.01
          viewRef.current.pitch = clamp(drag.pitch + dy * 0.008, -1.3, 1.3)
        }}
        onPointerUp={(e) => {
          const drag = dragRef.current
          dragRef.current = null
          // A drag orbits; a tap picks the copy under it (and, from ALL, is the
          // fastest way into a selection at all).
          if (!drag || drag.moved) return
          const rect = e.currentTarget.getBoundingClientRect()
          const px = e.clientX - rect.left, py = e.clientY - rect.top
          let best = -1, bestDist = 24
          for (const hit of hitsRef.current) {
            const d = Math.hypot(hit.x - px, hit.y - py)
            if (d < bestDist) { bestDist = d; best = hit.index }
          }
          if (best >= 0) onPickCopy(best, hitsRef.current.length)
        }}
      >
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>
    </PreviewWindow>
  )
}

// ── the panel ────────────────────────────────────────────────────────────────

export function CopyTargetsUserInterface({ track }: { track: Track }) {
  const setTrackCopyTargets = useProjectStore((s) => s.setTrackCopyTargets)
  const accent = resolveTrackIdentityColor(track)
  const targets = track.copyTargets
  // How many copies the last painted frame held - the stepper's ceiling and the
  // chip count both follow the real formation, so a 4-copy ring never offers 12
  // slices that can only ever be empty.
  const [count, setCount] = useState(2)

  const slices = copyTargetSlices(targets ?? { rule: 'every', slices: 2, on: [0] }, count)
  const rule: CopyTargetRule = targets?.rule ?? 'every'

  const commit = (next: CopyTargets | undefined) => {
    setTrackCopyTargets(track.id, next ? normalizeCopyTargets(next, count) : undefined)
  }

  const setSlices = (next: number) => {
    const clamped = clamp(Math.round(next), COPY_TARGET_MIN_SLICES, Math.min(COPY_TARGET_MAX_SLICES, Math.max(COPY_TARGET_MIN_SLICES, count)))
    const on = (targets?.on ?? [0]).filter((i) => i < clamped)
    commit({ rule, slices: clamped, on: on.length ? on : [0] })
  }

  const toggleSlice = (index: number) => {
    const on = new Set(targets?.on ?? [])
    if (on.has(index)) on.delete(index)
    else on.add(index)
    commit({ rule, slices, on: [...on].sort((a, b) => a - b) })
  }

  // "Every other" / "Every 3rd" - the segment wears its own stride so the number
  // is never said twice (the caption that used to say it is gone).
  const ordinal = slices === 2 ? 'OTHER' : slices === 3 ? '3RD' : `${slices}TH`

  return (
    <Console accent={accent}>
      <FormationWindow
        trackId={track.id}
        accent={accent}
        targets={targets}
        onCount={(total) => { if (total !== count) setCount(total) }}
        onPickCopy={(index, total) => {
          // From ALL this is the fastest way in: the tapped copy's slice, alone.
          if (!targets) {
            commit({ rule: 'every', slices: copyTargetSlices({ rule: 'every', slices: 2, on: [] }, total), on: [copyTargetSliceOf(index, total, { rule: 'every', slices: 2, on: [] })] })
            return
          }
          toggleSlice(copyTargetSliceOf(index, total, targets))
        }}
      />

      {count <= 1 ? (
        <p className="px-4 py-3 text-[11px] leading-[1.5] text-[var(--text-muted)]">
          Nothing above this device makes copies, so there is nothing to choose between.
          Add a splitter above it and this window fills up.
        </p>
      ) : (
        <>
          <div className="px-3 pt-2">
            <Segmented
              name="Which copies"
              options={[{ value: 0, label: 'All copies' }, { value: 1, label: 'Some copies' }]}
              value={targets ? 1 : 0}
              onChange={(v) => {
                if (v === 0) commit(undefined)
                // Entering selection lands on every other copy - the state the
                // segment is named after, and never empty on any formation.
                else commit({ rule: 'every', slices: copyTargetSlices({ rule: 'every', slices: 2, on: [] }, count), on: [0] })
              }}
              className="w-full [&>button]:flex-1"
            />
          </div>

          {targets && (
            <>
              <div className="px-3 pt-1.5">
                <Segmented
                  name="Pattern"
                  options={[
                    { value: 0, label: `Every ${ordinal.toLowerCase()}`, glyph: <span className="flex items-center gap-1.5"><RuleGlyph rule="every" /><span>EVERY {ordinal}</span></span> },
                    { value: 1, label: 'Runs', glyph: <span className="flex items-center gap-1.5"><RuleGlyph rule="runs" /><span>RUNS</span></span> },
                  ]}
                  value={RULE_OPTIONS.findIndex((o) => o.rule === rule)}
                  onChange={(v) => commit({ rule: RULE_OPTIONS[v].rule, slices, on: targets.on })}
                  className="w-full [&>button]:flex-1"
                />
              </div>

              <GutterRow label={rule === 'every' ? 'STRIDE' : 'SLICES'}>
                <div className="flex flex-1 flex-wrap items-center gap-2 pb-3 pt-2">
                  <div className="flex items-center gap-px rounded-[6px] border border-white/[0.07] bg-black/30 p-px">
                    <StepButton label="Fewer slices" disabled={slices <= COPY_TARGET_MIN_SLICES} onClick={() => setSlices(slices - 1)}>−</StepButton>
                    <span className="min-w-[20px] text-center text-[11px] tabular-nums text-[var(--text-2)]">{slices}</span>
                    <StepButton label="More slices" disabled={slices >= Math.min(COPY_TARGET_MAX_SLICES, count)} onClick={() => setSlices(slices + 1)}>+</StepButton>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {Array.from({ length: slices }, (_, i) => {
                      const on = targets.on.includes(i)
                      const hue = sliceColor(accent, i, slices)
                      return (
                        <button
                          key={i}
                          type="button"
                          aria-pressed={on}
                          title={`Slice ${i + 1} of ${slices}`}
                          onClick={() => toggleSlice(i)}
                          className="flex h-[22px] cursor-pointer items-center gap-1 rounded-[5px] border px-1.5 text-[10px] tabular-nums "
                          style={on
                            ? { background: withAlpha(hue, 0.22), color: towardWhite(hue, 0.65), borderColor: withAlpha(hue, 0.35) }
                            : { background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)', borderColor: 'rgba(255,255,255,0.07)' }}
                        >
                          <i className="h-[7px] w-[7px] rounded-full" style={{ background: on ? hue : 'rgba(255,255,255,0.18)' }} />
                          {i + 1}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </GutterRow>
            </>
          )}
        </>
      )}
    </Console>
  )
}

function StepButton({ label, disabled, onClick, children }: {
  label: string; disabled: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="h-[20px] w-[20px] cursor-pointer rounded-[5px] text-[12px] leading-none text-[var(--text-2)] hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-30"
    >
      {children}
    </button>
  )
}

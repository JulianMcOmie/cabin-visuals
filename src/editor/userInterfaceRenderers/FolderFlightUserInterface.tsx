'use client'

import { isNumberParam } from '../instruments/types'
import { ParamControl, ParamSlider } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Folder Flight settings: a perspective "runway" diagram - folders shrinking
// toward a vanishing point tagged with the max depth, tumbling by the tumble
// amount, spread vertically by Y spread, with speed streaks trailing the nearest
// one. Controls group into FLIGHT (speed/depth), FORMATION (spread/drift) and
// LOOK (scale/opacity/tumble), each sitting under a thin depth-fade rule.

function find(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((p) => p.definition.key === key)
}

function num(bound: UserInterfaceParameter | undefined, fallback: number): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

function SliderRow({ bound, label }: { bound?: UserInterfaceParameter; label?: string }) {
  if (!bound || !isNumberParam(bound.definition) || typeof bound.value !== 'number') return null
  const d = bound.definition
  return <ParamSlider label={label ?? d.label} value={bound.value} min={d.min} max={d.max} step={d.step} onChange={bound.setValue} />
}

/** Simple manila-folder glyph, drawn around (0,0) so it can scale and rotate. */
function FolderGlyph({ scale, rotate, opacity }: { scale: number; rotate: number; opacity: number }) {
  return (
    <g transform={`scale(${scale}) rotate(${rotate})`} opacity={opacity}>
      <path d="M-9 -5 h6.5 l2 2.5 h9.5 v10 h-18 z" fill="#caa54b" stroke="#8a6f2e" strokeWidth="0.8" />
      <path d="M-9 -5 h6.5 l2 2.5 h-8.5 z" fill="#e0bd63" />
    </g>
  )
}

function RunwayDiagram({
  speed, maxDepth, ySpread, drift, tumble, iconScale, opacity,
}: { speed: number; maxDepth: number; ySpread: number; drift: number; tumble: number; iconScale: number; opacity: number }) {
  const vw = 220
  const vh = 110
  const vp = { x: vw * 0.72, y: vh * 0.42 } // vanishing point
  const spreadPx = Math.min(26, 4 + ySpread * 2.2)
  const driftDeg = drift * 6

  // Four folders along the flight path, nearest first.
  const stops = [0.12, 0.38, 0.6, 0.8]
  const folders = stops.map((t, i) => {
    const x = 30 + (vp.x - 30) * t
    const alt = i % 2 === 0 ? 1 : -1
    const y = vh * 0.55 + (vp.y - vh * 0.55) * t + alt * spreadPx * (1 - t)
    const scale = Math.max(0.14, (1 - t) * 1.05) * Math.min(1.6, 0.55 + iconScale * 0.3)
    const rotate = alt * tumble * 14 + driftDeg
    const alpha = opacity * (1 - t * 0.75)
    return { x, y, scale, rotate, alpha }
  })
  const streakLen = 6 + (speed / 60) * 40

  return (
    <svg
      viewBox={`0 0 ${vw} ${vh}`}
      role="img"
      aria-label="Flight depth preview"
      className="mb-2 w-full rounded-[3px] border border-[var(--border)] bg-[var(--bg-canvas)]"
    >
      {/* perspective guides converging on the vanishing point */}
      {[[0, 0], [0, vh], [vw * 0.3, 0], [vw * 0.3, vh]].map(([x, y], i) => (
        <line key={i} x1={x} y1={y} x2={vp.x} y2={vp.y} stroke="var(--border-strong)" strokeWidth="0.6" opacity="0.5" />
      ))}
      <line x1={0} y1={vp.y} x2={vw} y2={vp.y} stroke="var(--border)" strokeWidth="0.6" strokeDasharray="2 3" />
      {/* vanishing point + max-depth tag */}
      <circle cx={vp.x} cy={vp.y} r="1.6" fill="var(--accent-muted)" />
      <text x={vp.x + 6} y={vp.y - 4} fontSize="7" fontFamily="monospace" fill="var(--text-muted)">
        z −{Math.round(maxDepth)}
      </text>
      {/* speed streaks behind the nearest folder */}
      {[-4, 0, 4].map((dy) => (
        <line
          key={dy}
          x1={folders[0].x - 14 - streakLen}
          y1={folders[0].y + dy}
          x2={folders[0].x - 12}
          y2={folders[0].y + dy}
          stroke="var(--accent-muted)"
          strokeWidth="1"
          strokeLinecap="round"
          opacity={0.55 - Math.abs(dy) * 0.06}
        />
      ))}
      {/* folders, far to near so the near one draws on top */}
      {[...folders].reverse().map((f, i) => (
        <g key={i} transform={`translate(${f.x}, ${f.y})`}>
          <FolderGlyph scale={f.scale} rotate={f.rotate} opacity={f.alpha} />
        </g>
      ))}
    </svg>
  )
}

/** Section header: label over a rule that fades out like the flight path. */
function SectionLabel({ children }: { children: string }) {
  return (
    <div className="mb-1.5 mt-3 first:mt-0">
      <p className="text-[9px] font-semibold tracking-[0.1em] text-[var(--text-muted)] select-none">{children}</p>
      <div className="mt-1 h-px" style={{ background: 'linear-gradient(90deg, var(--border-strong), transparent 85%)' }} />
    </div>
  )
}

function Leftovers({ parameters, placed }: { parameters: readonly UserInterfaceParameter[]; placed: readonly string[] }) {
  const placedSet = new Set(placed)
  const rest = parameters.filter((p) => !placedSet.has(p.definition.key))
  if (rest.length === 0) return null
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      {rest.map((p) => {
        const numeric = typeof p.value === 'number'
        return (
          <ParamControl
            key={p.definition.key}
            param={p.definition}
            numValue={numeric ? (p.value as number) : undefined}
            strValue={numeric ? undefined : (p.value as string)}
            onNum={p.setValue}
            onStr={p.setValue}
          />
        )
      })}
    </div>
  )
}

export const FolderFlightUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const speed = find(parameters, 'speed')
  const iconScale = find(parameters, 'iconScale')
  const opacity = find(parameters, 'opacity')
  const maxDepth = find(parameters, 'maxDepth')
  const ySpread = find(parameters, 'ySpread')
  const drift = find(parameters, 'drift')
  const tumble = find(parameters, 'tumble')
  const placed = ['speed', 'iconScale', 'opacity', 'maxDepth', 'ySpread', 'drift', 'tumble']

  return (
    <section data-testid="folderflight-user-interface">
      <RunwayDiagram
        speed={num(speed, 15)}
        maxDepth={num(maxDepth, 50)}
        ySpread={num(ySpread, 4)}
        drift={num(drift, 0.5)}
        tumble={num(tumble, 1)}
        iconScale={num(iconScale, 2)}
        opacity={num(opacity, 1)}
      />

      <SectionLabel>FLIGHT</SectionLabel>
      <SliderRow bound={speed} label="Speed" />
      <SliderRow bound={maxDepth} label="Max Depth" />

      <SectionLabel>FORMATION</SectionLabel>
      <SliderRow bound={ySpread} label="Y Spread" />
      <SliderRow bound={drift} label="Drift" />

      <SectionLabel>LOOK</SectionLabel>
      <SliderRow bound={tumble} label="Tumble" />
      <SliderRow bound={iconScale} label="Icon Scale" />
      <SliderRow bound={opacity} label="Opacity" />

      <Leftovers parameters={parameters} placed={placed} />
    </section>
  )
}

'use client'

// Bespoke settings for the Symmetric Motion mover, migrated to
// docs/instrument-panel-design-guide.md on the console kit (./console). The
// layout IS the pitch: two segmented mode switches (which symmetry the motion
// respects, which time shape every row shares) under a window that restates
// the current mode as arrows, a small knob row, and the mover's tiny MIDI
// grammar spelled out per mode. Params the current mode doesn't read are
// simply absent, not disabled - the mover path hands every param over
// regardless of `showIf`, so the gating lives here.

import {
  SYMMETRIC_MOTION_MIRROR_ROWS,
  SYMMETRIC_MOTION_RADIAL_ROWS,
} from '../core/visualCopies/symmetricMotion'
import { SYMMETRIC_MOTION_COLOR } from '../core/visualCopies/identityColors'
import { ParamControl } from './ParameterControl'
import {
  bindPanel,
  Console,
  ControlRow,
  Knob,
  More,
  ParameterList,
  PreviewWindow,
  Segmented,
  withAlpha,
} from './console'
import type { UserInterfaceRendererDefinition } from './types'

// The accent comes FROM THE DEFINITION - the same hue this mover's timeline
// blocks and piano-roll notes wear.
const ACCENT = SYMMETRIC_MOTION_COLOR

const VB_W = 240
const VB_H = 84
const DCX = VB_W / 2
const DCY = VB_H / 2

/** An arrowed segment from (x1,y1) toward (x2,y2). */
function Arrow({ x1, y1, x2, y2, dim }: { x1: number; y1: number; x2: number; y2: number; dim?: boolean }) {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const head = (spread: number) =>
    `${x2 - 5 * Math.cos(angle - spread)} ${y2 - 5 * Math.sin(angle - spread)}`
  return (
    <g stroke={ACCENT} opacity={dim ? 0.35 : 0.9} strokeWidth="1.3" fill="none" strokeLinecap="round">
      <path d={`M${x1} ${y1} L${x2} ${y2}`} />
      <path d={`M${head(0.5)} L${x2} ${y2} L${head(-0.5)}`} />
    </g>
  )
}

/** The current mode restated as arrows: outward spokes and a turn hint for
 *  Radial, equal-and-opposite pairs across a dashed axis for Mirror. Static on
 *  purpose - the subject is the DIRECTION grammar, and notes drive the motion. */
function ModeWindow({ mirror, planeLabel }: { mirror: boolean; planeLabel: string | null }) {
  const dots: { x: number; y: number }[] = mirror
    ? [-52, -26, 26, 52].map((x) => ({ x: DCX + x, y: DCY }))
    : [45, 135, 225, 315].map((deg) => ({
      x: DCX + 26 * Math.sin((deg * Math.PI) / 180),
      y: DCY - 26 * Math.cos((deg * Math.PI) / 180),
    }))
  return (
    <PreviewWindow height={92} testId="symmetric-motion-window">
      <svg aria-hidden="true" viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
        {mirror ? (
          <line x1={DCX} y1={8} x2={DCX} y2={VB_H - 8} stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="4 3" />
        ) : (
          <>
            <circle cx={DCX} cy={DCY} r={26} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
            {/* the turn rows, hinted as one arc around the ring */}
            <g stroke={ACCENT} opacity="0.35" strokeWidth="1.3" fill="none" strokeLinecap="round">
              <path d={`M${DCX - 38} ${DCY - 10} A 39 39 0 0 1 ${DCX - 10} ${DCY - 38}`} />
              <path d={`M${DCX - 10} ${DCY - 38} L${DCX - 15.5} ${DCY - 38.5} M${DCX - 10} ${DCY - 38} L${DCX - 9.5} ${DCY - 33}`} />
            </g>
          </>
        )}
        <path d={`M${DCX - 3.5} ${DCY}H${DCX + 3.5}M${DCX} ${DCY - 3.5}V${DCY + 3.5}`} stroke="rgba(255,255,255,0.25)" strokeWidth="1" fill="none" />
        {dots.map((dot, i) => {
          // Each copy's arrow points along ITS OWN outward/apart direction.
          const dx = dot.x - DCX
          const dy = dot.y - DCY
          const reach = Math.hypot(dx, dy)
          return (
            <g key={i}>
              <circle cx={dot.x} cy={dot.y} r="3.2" fill={ACCENT} opacity={0.85} />
              <Arrow
                x1={dot.x + (dx / reach) * 7}
                y1={dot.y + (dy / reach) * 7}
                x2={dot.x + (dx / reach) * 20}
                y2={dot.y + (dy / reach) * 20}
              />
            </g>
          )
        })}
      </svg>
      <span className="pointer-events-none absolute right-1.5 top-1 font-mono text-[8px] text-white/30">
        {mirror ? 'PER AXIS' : planeLabel}
      </span>
      <span className="pointer-events-none absolute bottom-1 left-1.5 font-mono text-[8px] text-white/40">
        {mirror ? 'APART / TOGETHER · SIDE PICKS THE SIGN' : 'OUT / IN / TURN · ABOUT THE CENTER'}
      </span>
    </PreviewWindow>
  )
}

/** The mover's whole MIDI grammar for the current mode - few enough rows to
 *  spell out in full, which is the point of the design. */
function NoteMap({ mirror }: { mirror: boolean }) {
  const rows = mirror ? SYMMETRIC_MOTION_MIRROR_ROWS : SYMMETRIC_MOTION_RADIAL_ROWS
  return (
    <div className="rounded-md border border-white/[0.06] bg-black/25 p-1.5">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[8px] font-semibold tracking-[0.12em] text-white/40 select-none">NOTE MAP</span>
        <span className="text-[7px] text-white/25 select-none">one note moves every copy</span>
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-[3px]">
        {rows.map((row) => (
          <div key={row.pitch} className="flex items-center gap-1.5">
            <span className="w-6 flex-shrink-0 rounded-[3px] border border-white/10 py-[2px] text-center font-mono text-[8px] leading-none tabular-nums text-white/40">
              {row.pitch}
            </span>
            <span className="truncate text-[9px] text-white/60">{row.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** A captioned segmented switch: the kit control with the guide's quiet caps
 *  caption above it. */
function CaptionedSegments({ b, caption }: { b: NonNullable<ReturnType<ReturnType<typeof bindPanel>['select']>>; caption?: string }) {
  return (
    <div>
      <span className="mb-1 block text-[8px] font-semibold tracking-[0.12em] text-white/40 select-none">
        {(caption ?? b.def.label).toUpperCase()}
      </span>
      <Segmented b={b} />
    </div>
  )
}

export const SymmetricMotionMoverUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const symmetry = b.select('symmetry')
  const motion = b.select('motion')
  const plane = b.select('plane', { optional: true })
  const distance = b.num('distance')
  const angle = b.num('angle', { optional: true })
  const beats = b.num('beats')
  const easing = b.select('easing', { optional: true })

  if (!symmetry || !motion || !distance || !beats) return <ParameterList parameters={parameters} />

  const mirror = symmetry.value === 1
  const burst = motion.value === 0
  const planeLabel = plane?.def.options.find((o) => o.value === plane.value)?.label.toUpperCase() ?? null

  return (
    <Console accent={ACCENT} testId="symmetric-motion-user-interface">
      <ModeWindow mirror={mirror} planeLabel={planeLabel} />
      <div
        className="flex flex-col gap-2 px-3 pb-3 pt-2"
        style={{ background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(ACCENT, 0.14)}, transparent)` }}
      >
        <CaptionedSegments b={symmetry} />
        <CaptionedSegments b={motion} />
        {!mirror && plane && <CaptionedSegments b={plane} caption="About" />}

        <ControlRow className="justify-around gap-5 pt-1">
          <Knob b={distance} label="DIST" large />
          {!mirror && angle && <Knob b={angle} label="TURN" suffix="°" format={(v) => `${Math.round(v)}`} />}
          <Knob b={beats} label="BEATS" suffix="b" />
        </ControlRow>

        {burst && easing && (
          <ParamControl
            param={easing.def}
            numValue={easing.value}
            strValue={undefined}
            onNum={(v) => easing.set(v)}
          />
        )}

        <NoteMap mirror={mirror} />
        <More parameters={b.rest()} label="MORE" className="" />
      </div>
    </Console>
  )
}

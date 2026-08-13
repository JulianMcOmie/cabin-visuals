'use client'

// Bespoke settings for HopfFibration, migrated to
// docs/instrument-panel-design-guide.md on the console kit (./console): the
// nested-tori emblem (ellipse count, fan-out and stroke weights read from the
// live params) is now the panel's window, and the LAYERS / MOTION / RENDER
// groups are gutter-labelled knob rows - one control vocabulary, per the
// guide (the old vertical faders went with the card chrome).

import type { ReactNode } from 'react'
import {
  bindPanel,
  Console,
  GutterRow,
  Knob,
  More,
  ParameterList,
  PreviewWindow,
} from './console'
import type { UserInterfaceRendererDefinition } from './types'

/** The instrument's declared identity (HopfFibration.tsx `identityColor`). */
const ACCENT = '#2dd4bf'

function ToriWindow({ fibers, spread, coreWidth, glowWidth }: {
  fibers: number
  spread: number
  coreWidth: number
  glowWidth: number
}) {
  const count = Math.max(3, Math.min(9, Math.round(fibers * 0.5)))
  const rings: ReactNode[] = []
  for (let i = 0; i < count; i++) {
    const t = count <= 1 ? 0 : i / (count - 1) - 0.5
    const angle = t * spread * 70
    const hue = 200 + t * 90
    rings.push(
      <g key={i} transform={`rotate(${angle.toFixed(1)} 70 40)`}>
        <ellipse cx="70" cy="40" rx="46" ry="15" fill="none" stroke={`hsl(${hue}, 65%, 60%)`} strokeWidth={Math.max(1, glowWidth * 0.28)} opacity="0.12" />
        <ellipse cx="70" cy="40" rx="46" ry="15" fill="none" stroke={`hsl(${hue}, 65%, 62%)`} strokeWidth={Math.max(0.5, coreWidth * 0.35)} opacity="0.75" />
      </g>,
    )
  }
  return (
    <PreviewWindow height={96} testId="hopf-tori-window">
      <svg aria-hidden="true" viewBox="0 0 140 80" className="block h-full w-full">{rings}</svg>
    </PreviewWindow>
  )
}

export const HopfFibrationUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const coreWidth = b.num('coreWidth')
  const glowWidth = b.num('glowWidth')
  const projScale = b.num('projScale')
  const maxDist = b.num('maxDist')
  const driftSpeed = b.num('driftSpeed')
  const rotationSpeed = b.num('rotationSpeed')
  const pointsPerFiber = b.num('pointsPerFiber')
  const fibersPerLayer = b.num('fibersPerLayer')
  const flowSpeed = b.num('flowSpeed')
  const thetaSpread = b.num('thetaSpread')

  if (!fibersPerLayer || !coreWidth) return <ParameterList parameters={parameters} />

  return (
    <Console accent={ACCENT} testId="hopf-fibration-user-interface">
      <ToriWindow
        fibers={fibersPerLayer.value}
        spread={thetaSpread?.value ?? 0.9}
        coreWidth={coreWidth.value}
        glowWidth={glowWidth?.value ?? 8}
      />
      <div className="flex flex-col gap-2 pb-3 pt-2">
        <GutterRow label="LAYERS">
          <Knob b={fibersPerLayer} label="FIBERS" large />
          <Knob b={pointsPerFiber} label="POINTS" />
          <Knob b={thetaSpread} label="FAN" />
          <Knob b={maxDist} label="REACH" />
        </GutterRow>
        <GutterRow label="MOTION">
          <Knob b={rotationSpeed} label="TWIST" />
          <Knob b={driftSpeed} label="DRIFT" />
          <Knob b={flowSpeed} label="FLOW" />
          <span className="flex-1" aria-hidden="true" />
        </GutterRow>
        <GutterRow label="RENDER">
          <Knob b={coreWidth} label="CORE" />
          <Knob b={glowWidth} label="GLOW" />
          <Knob b={projScale} label="ZOOM" />
          <span className="flex-1" aria-hidden="true" />
        </GutterRow>
        <More parameters={b.rest()} label="MORE" className="px-3" />
      </div>
    </Console>
  )
}

import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LaserKnob } from '../../src/editor/userInterfaceRenderers/laserKnob'
import { Knob } from '../../src/editor/userInterfaceRenderers/console/Knob'
import { consolePanel } from '../../src/editor/userInterfaceRenderers/console/spec'
import { percentEntry, turnsEntry, growthEntry, periodEntry, noteRateEntry } from '../../src/editor/userInterfaceRenderers/knobValueParsing'
import { ImpactScatterMoverUserInterfaceRenderer } from '../../src/editor/userInterfaceRenderers/ImpactScatterMoverUserInterface'
import { impactScatterMover } from '../../src/editor/core/visualCopies/impactScatter'
import { RadialMotionMoverUserInterfaceRenderer } from '../../src/editor/userInterfaceRenderers/RadialMotionMoverUserInterface'
import { radialMotionMover } from '../../src/editor/core/visualCopies/radialMotion'
import { TunnelSplitterUserInterfaceRenderer } from '../../src/editor/userInterfaceRenderers/TunnelSplitterUserInterface'
import { tunnelSplitter } from '../../src/editor/core/visualCopies/tunnel'
import { PixelBlastUserInterfaceRenderer } from '../../src/editor/userInterfaceRenderers/PixelBlastUserInterface'
import { pixelBlastInstrument } from '../../src/editor/instruments/PixelBlast'
import { CameraControlUserInterfaceRenderer } from '../../src/editor/userInterfaceRenderers/CameraControlUserInterface'
import { cameraControlInstrument } from '../../src/editor/instruments/CameraControl'
import { CameraOrbitUserInterfaceRenderer } from '../../src/editor/userInterfaceRenderers/CameraOrbitUserInterface'
import { cameraOrbitInstrument } from '../../src/editor/instruments/CameraOrbit'
import { SymmetrySplitterUserInterfaceRenderer } from '../../src/editor/userInterfaceRenderers/SymmetrySplitterUserInterface'
import { symmetrySplitter } from '../../src/editor/core/visualCopies/symmetry'
import { RotateEffectUserInterfaceRenderer } from '../../src/editor/userInterfaceRenderers/RotateEffectUserInterface'
import { KaleidoscopeEffectUserInterfaceRenderer } from '../../src/editor/userInterfaceRenderers/KaleidoscopeEffectUserInterface'
import { SCENE_FX_USER_INTERFACES } from '../../src/editor/userInterfaceRenderers/SceneFxUserInterface'
import { grainScenePlugin } from '../../src/editor/effects/scene/grain'
import { ColorFiltersUserInterfaceRenderer } from '../../src/editor/userInterfaceRenderers/ColorFiltersUserInterface'
import type { ParamDef } from '../../src/editor/instruments/types'
import type { UserInterfaceRendererDefinition } from '../../src/editor/userInterfaceRenderers/types'

const numeric = (key: string, min = 0, max = 1, step = 0.01, value = 0) => ({ key, label: key, min, max, step, default: value })
const panels: Record<string, { component: UserInterfaceRendererDefinition; params: readonly ParamDef[]; overrides?: Record<string, number> }> = {
  shock: { component: ImpactScatterMoverUserInterfaceRenderer, params: impactScatterMover.params },
  radial: { component: RadialMotionMoverUserInterfaceRenderer, params: radialMotionMover.params },
  tunnel: { component: TunnelSplitterUserInterfaceRenderer, params: tunnelSplitter.params, overrides: { speedMode: 1 } },
  pixel: { component: PixelBlastUserInterfaceRenderer, params: pixelBlastInstrument.params },
  camera: { component: CameraControlUserInterfaceRenderer, params: cameraControlInstrument.params },
  orbit: { component: CameraOrbitUserInterfaceRenderer, params: cameraOrbitInstrument.params },
  symmetry: { component: SymmetrySplitterUserInterfaceRenderer, params: symmetrySplitter.params },
  rotate: { component: RotateEffectUserInterfaceRenderer, params: ['X', 'Y', 'Z'].flatMap(axis => [numeric(`speed${axis}`, -5, 5, 0.1), numeric(`offset${axis}`, -180, 180, 5)]) },
  kaleidoscope: { component: KaleidoscopeEffectUserInterfaceRenderer, params: [numeric('segments', 2, 16, 1, 6), numeric('rotation', 0, Math.PI * 2, 0.01), numeric('zoom', 0.1, 10, 0.01, 1), numeric('spinSpeed', -5, 5), numeric('hueShift', 0, Math.PI * 2)] },
  grain: { component: SCENE_FX_USER_INTERFACES[grainScenePlugin.id], params: grainScenePlugin.params },
  filters: { component: ColorFiltersUserInterfaceRenderer, params: [numeric('amount', 0, 1, 0.01, 0.5)] },
  spec: { component: consolePanel({ accent: '#99ddff', rows: [{ row: [{ param: 'amount', format: v => `${v * 100}%`, entry: percentEntry }] }] }), params: [numeric('amount', 0, 1, 0.01, 0.5)] },
}

declare global {
  interface Window {
    mountKnobs: (name: string) => void
    knobValues: Record<string, number | string>
    knobChanges: number
  }
}
function Panel({ name }: { name: string }) {
  const panel = panels[name]
  const [values, setValues] = useState<Record<string, number | string>>(() => Object.fromEntries(panel.params.map(def => [def.key, panel.overrides?.[def.key] ?? def.default])))
  window.knobValues = values
  const Component = panel.component
  return <Component targetId="knob-test" parameters={panel.params.map(definition => ({ definition, value: values[definition.key], setValue: value => { window.knobChanges++; setValues(old => ({ ...old, [definition.key]: value })) } }))} />
}
function Primitive({ name }: { name: string }) {
  const [value, setValue] = useState(name === 'percent' ? 0.5 : name === 'notes' ? 4 : name === 'period' ? 45 : 0)
  window.knobValues = { value }
  const onChange = (next: number) => { window.knobChanges++; setValue(next) }
  const props = { value, onChange, min: -10, max: 10, step: 0.01, defaultValue: 1, label: 'VALUE', accent: '#55bbff' }
  if (name === 'bound') return <Knob b={{ def: numeric('value', -10, 10), value, set: onChange }} />
  return <LaserKnob {...props}
    {...(name === 'curved' ? { min: 0, max: 10000, curve: 4, step: 1 } : {})}
    {...(name === 'percent' ? { min: 0, max: 1.1, format: (v: number) => `${Math.round(v * 100)}%`, entry: percentEntry } : {})}
    {...(name === 'degrees' ? { min: -2, max: 2, format: (v: number) => `${Math.round(v * 360)}°`, entry: turnsEntry } : {})}
    {...(name === 'growth' ? { format: (v: number) => `×${(2 ** v).toFixed(2)}`, entry: growthEntry } : {})}
    {...(name === 'period' ? { min: -180, max: 180, step: 11.25, detents: [-180, -45, 0, 45, 180], format: (v: number) => `${v === 0 ? 0 : 360 / v}b`, entry: periodEntry(360, true, '°') } : {})}
    {...(name === 'notes' ? { min: 0.25, max: 16, step: 0.25, detents: [0.25, 0.5, 1, 2, 4, 8, 16], format: (v: number) => `1/${4 * v}`, entry: noteRateEntry } : {})}
    {...(name === 'disabled' ? { disabled: true } : {})}
    {...(name === 'bipolar' ? { bipolar: true, large: true, label: '', ariaLabel: 'Signed rate' } : {})}
  />
}
const root = createRoot(document.getElementById('root')!)
window.mountKnobs = name => {
  window.knobChanges = 0
  root.render(<React.StrictMode><div key={name} style={{ width: 420, margin: '40px auto' }}>{panels[name] ? <Panel name={name} /> : <Primitive name={name} />}<button id="outside">Outside</button></div></React.StrictMode>)
}
window.mountKnobs('plain')

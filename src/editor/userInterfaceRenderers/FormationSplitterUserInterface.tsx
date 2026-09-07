'use client'

import { Matrix4, Vector3 } from 'three'
import { consolePanel, type PanelPreviewProps } from './console/spec'
import { fractalSplitter } from '../core/visualCopies/fractal'
import { wallpaperSplitter } from '../core/visualCopies/wallpaper'
import { parametricPatternSplitter } from '../core/visualCopies/parametricPattern'
import { ParamControl } from './ParameterControl'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'
import { scatterSplitter } from '../core/visualCopies/scatter'
import { bindPanel, Knob, ControlRow } from './console'
import { FRACTAL_COLOR, WALLPAPER_COLOR, PARAMETRIC_PATTERN_COLOR, SCATTER_COLOR } from '../core/visualCopies/identityColors'
import { mergeDefinitionSettings, type MoverOrSplitterDefinition } from '../core/visualCopies/definitions'
import { resolveVisualCopies } from '../core/visualCopies/resolveVisualCopies'

/** Draw the real matrices with an asymmetric seed, so reflection and rotation
 * remain legible even when the instrument happens to be a round Particle. */
function formationPreview<S>(definition: MoverOrSplitterDefinition<S>) {
  return function FormationPreview({ values, accent }: PanelPreviewProps) {
    const settings = mergeDefinitionSettings(definition, values) as S
    const copies = resolveVisualCopies([definition.resolve({ settings, notes: [] })], 0)
    const axes = values.plane === 1 ? [0, 2] : values.plane === 2 ? [1, 2] : [0, 1]
    const project = (matrix: Matrix4, x: number, y: number) => {
      const v = new Vector3().setComponent(axes[0], x).setComponent(axes[1], y).applyMatrix4(matrix)
      return [v.getComponent(axes[0]), -v.getComponent(axes[1])]
    }
    const seeds = copies.map(copy => [[-.12, -.12], [.12, -.12], [.12, -.035], [-.035, -.035], [-.035, .12], [-.12, .12]].map(([x, y]) => project(copy.transform, x, y)))
    const points = seeds.flat()
    const xs = points.map(p => p[0]), ys = points.map(p => p[1])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
    const scale = Math.min(210 / Math.max(.5, Math.max(...xs) - Math.min(...xs)), 92 / Math.max(.5, Math.max(...ys) - Math.min(...ys)))
    return <div className="relative border-b border-white/[0.06] bg-black/40">
      <svg viewBox="0 0 240 116" className="h-28 w-full" role="img" aria-label={`${definition.label} layout: ${copies.length} copies`}>
        {seeds.map((seed, i) => <polygon key={i} fill={accent} fillOpacity={.8} points={seed.map(([x, y]) => `${120 + (x - cx) * scale},${58 + (y - cy) * scale}`).join(' ')} />)}
      </svg>
      <span className="absolute bottom-1 right-2 font-mono text-[8px] text-white/45">{copies.length} COPIES</span>
    </div>
  }
}

export const FractalSplitterUserInterfaceRenderer = consolePanel({
  accent: FRACTAL_COLOR, testId: 'fractal-user-interface', preview: formationPreview(fractalSplitter),
  rows: [
    { segmented: 'pattern' },
    { row: ['depth:DEPTH', 'branches:BRANCHES', 'shrink:SHRINK'] },
    { row: ['spread:SPREAD', { param: 'angle', label: 'ANGLE', bipolar: true }, 'size?:SIZE'] },
    { segmented: 'plane' },
  ],
})

export const WallpaperSplitterUserInterfaceRenderer = consolePanel({
  accent: WALLPAPER_COLOR, testId: 'wallpaper-user-interface', preview: formationPreview(wallpaperSplitter),
  rows: [
    { segmented: 'mode' },
    { row: ['rows:ROWS', 'columns:COLS', 'spacing:CELL'] },
    { row: [{ param: 'offsetX', label: 'MOTIF X', bipolar: true }, { param: 'offsetY', label: 'MOTIF Y', bipolar: true }, { param: 'angle', label: 'ANGLE', bipolar: true }] },
    { row: ['size?:SIZE'] },
    { segmented: 'plane' },
  ],
})

function PatternChoice({ parameters }: { parameters: readonly UserInterfaceParameter[] }) {
  const p = parameters.find(p => p.definition.key === 'pattern')
  return p ? <div className="px-4 pt-2"><ParamControl param={p.definition} numValue={Number(p.value)} strValue={undefined} onNum={p.setValue} onStr={p.setValue} /></div> : null
}
function LissajousPresets({ parameters }: { parameters: readonly UserInterfaceParameter[] }) {
  const set = (key: string, value: number) => parameters.find(p => p.definition.key === key)?.setValue(value)
  return <div className="flex gap-1 px-4 pt-2">
    {[{ name: 'Figure eight', a: 1, b: 2, phase: 0 }, { name: 'Weave', a: 3, b: 2, phase: 0 }, { name: 'Dense weave', a: 5, b: 4, phase: 0 }].map(p =>
      <button key={p.name} className="flex-1 rounded border border-white/10 py-1 text-[9px] text-white/60"
        onClick={() => { set('frequencyA', p.a); set('frequencyB', p.b); set('phaseDegrees', p.phase) }}>{p.name}</button>)}
  </div>
}
const LissajousPanel = consolePanel({
  accent: PARAMETRIC_PATTERN_COLOR, testId: 'lissajous-user-interface', preview: formationPreview(parametricPatternSplitter),
  rows: [
    { custom: PatternChoice, claims: ['pattern'] },
    { custom: LissajousPresets },
    { row: ['frequencyA:X FREQ', 'frequencyB:Y FREQ', { param: 'phaseDegrees', label: 'PHASE', bipolar: true }] },
    { row: ['copies:COPIES', 'radius:RADIUS', 'amount:ASPECT'] },
    { row: ['size?:SIZE'] },
    { segmented: 'plane' },
  ],
})
// Preserve the established generic controls for the six existing functions.
export const ParametricPatternUserInterfaceRenderer: UserInterfaceRendererDefinition = props =>
  props.parameters.find(p => p.definition.key === 'pattern')?.value === 6
    ? <LissajousPanel {...props} parameters={props.parameters.filter(p => p.definition.key !== 'shape')} /> : <ParameterList parameters={props.parameters} />

function ScatterExtras({ parameters }: { parameters: readonly UserInterfaceParameter[] }) {
  const pool = bindPanel(parameters)
  const distribution = pool.select('distribution')
  const clusters = pool.num('clusters', { optional: true })
  const size = pool.num('size', { optional: true })
  return <ControlRow><Knob b={size} label="SIZE" />{distribution?.value === 1 && <Knob b={clusters} label="CLUSTERS" />}</ControlRow>
}
export const ScatterSplitterUserInterfaceRenderer = consolePanel({
  accent: SCATTER_COLOR, testId: 'scatter-user-interface', preview: formationPreview(scatterSplitter),
  rows: [
    { segmented: 'distribution' },
    { row: ['copies:COPIES', 'spread:SPREAD', 'seed:SEED'] },
    { custom: ScatterExtras, claims: ['size', 'clusters'] },
    { segmented: 'plane' },
  ],
})

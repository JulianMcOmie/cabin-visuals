import { Matrix4, Vector3 } from 'three'
import type { VisualCopy } from './types'
import type { MoverOrSplitterDefinition } from './definitions'
import { WALLPAPER_COLOR } from './identityColors'
import { applySplitterSize, splitterSize, SPLITTER_SIZE_PARAM } from './splitterSize'
import { countLaneRows, resolveCountLane } from './countLane'

export interface WallpaperSettings {
  mode: number
  rows: number
  columns: number
  spacing: number
  offsetX: number
  offsetY: number
  angle: number
  size: number
  plane: number
}
const bounded = (n: number, min: number, max: number, fallback: number) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback))
export const WALLPAPER_MAX_COPIES = 576

/** Representatives of p1, pm, p2 and p4, then square-lattice translations.
 * Conjugating the whole cell operation puts its mirror/rotation in the chosen
 * plane without rotating the seed in Repeat mode. Composition is LOCAL. */
export function wallpaperTransforms(settings: WallpaperSettings): Matrix4[] {
  const rows = Math.round(bounded(settings.rows, 1, 12, 3))
  const columns = Math.round(bounded(settings.columns, 1, 12, 3))
  const spacing = bounded(settings.spacing, 0, 40, 2)
  const mode = Math.round(bounded(settings.mode, 0, 3, 3))
  const basis = settings.plane === 1 ? new Matrix4().makeRotationX(Math.PI / 2)
    : settings.plane === 2 ? new Matrix4().makeRotationAxis(new Vector3(1, 1, 1).normalize(), Math.PI * 2 / 3) : new Matrix4()
  const inverse = basis.clone().invert()
  const motif = new Matrix4().makeTranslation(
    bounded(settings.offsetX, -.5, .5, .22) * spacing,
    bounded(settings.offsetY, -.5, .5, .12) * spacing, 0,
  ).multiply(new Matrix4().makeRotationZ(bounded(settings.angle, -180, 180, 0) * Math.PI / 180))
  const symmetries = mode === 1 ? [new Matrix4(), new Matrix4().makeScale(-1, 1, 1)]
    : Array.from({ length: mode === 3 ? 4 : mode === 2 ? 2 : 1 }, (_, i) => new Matrix4().makeRotationZ(i * Math.PI * 2 / (mode === 3 ? 4 : 2)))
  const result: Matrix4[] = []
  // Cell-major slot order: each cell's orbit is contiguous for copy targeting.
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const cell = new Matrix4().makeTranslation((col - (columns - 1) / 2) * spacing, ((rows - 1) / 2 - row) * spacing, 0)
    for (const symmetry of symmetries) result.push(applySplitterSize(
      basis.clone().multiply(cell).multiply(symmetry).multiply(motif).multiply(inverse), splitterSize(settings.size),
    ))
  }
  return result
}
function resolveWallpaper(settings: WallpaperSettings) {
  const transforms = wallpaperTransforms(settings)
  return {    
apply(copy: VisualCopy) {
      return transforms.map(transform => ({ ...copy, transform: copy.transform.clone().multiply(transform), colorShift: { ...copy.colorShift } }))
    }  
}
}
export const wallpaperSplitter: MoverOrSplitterDefinition<WallpaperSettings> = {
  id: 'wallpaper', label: 'Wallpaper', kind: 'splitter', identityColor: WALLPAPER_COLOR,
  params: [
    { key: 'mode', label: 'Symmetry', type: 'select', options: [{ value: 0, label: 'Repeat' }, { value: 1, label: 'Mirror' }, { value: 2, label: 'Half-turn' }, { value: 3, label: 'Quarter-turn' }], default: 3 },
    { key: 'rows', label: 'Rows', min: 1, max: 12, step: 1, integer: true, default: 3 },
    { key: 'columns', label: 'Columns', min: 1, max: 12, step: 1, integer: true, default: 3 },
    { key: 'spacing', label: 'Cell spacing', min: 0, max: 40, step: .1, default: 2 },
    { key: 'offsetX', label: 'Motif X (cell)', min: -.5, max: .5, step: .01, default: .22 },
    { key: 'offsetY', label: 'Motif Y (cell)', min: -.5, max: .5, step: .01, default: .12 },
    { key: 'angle', label: 'Motif angle (°)', min: -180, max: 180, step: 1, default: 0 },
    SPLITTER_SIZE_PARAM,
    { key: 'plane', label: 'Plane', type: 'select', options: [{ value: 0, label: 'XY' }, { value: 1, label: 'XZ' }, { value: 2, label: 'YZ' }], default: 0 },
  ],
  midiRows: () => countLaneRows(1, 12, 'row', 'rows'), strictMidiRows: true,
  resolve({ settings, notes }) { return resolveCountLane({ settings, notes, key: 'rows', min: 1, max: 12, resolveAt: resolveWallpaper }) },
}

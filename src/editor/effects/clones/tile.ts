import { Matrix4, Vector3, Quaternion } from 'three'
import type { VisualEffect } from '../types'

const IDENT_Q = new Quaternion()

/** A 2D grid of copies on a chosen plane, optionally centered and row-staggered. */
export const tilePlugin: VisualEffect = {
  id: 'tile',
  name: 'Tile',
  category: 'clone',
  params: [
    { key: 'tilesX', label: 'Tiles X', min: 1, max: 10, step: 1, default: 3 },
    { key: 'tilesY', label: 'Tiles Y', min: 1, max: 10, step: 1, default: 3 },
    { key: 'spacingX', label: 'Spacing X', min: 0.5, max: 3, step: 0.05, default: 1.2 },
    { key: 'spacingY', label: 'Spacing Y', min: 0.5, max: 3, step: 0.05, default: 1.2 },
    { key: 'scale', label: 'Tile Scale', min: 0.1, max: 2, step: 0.05, default: 0.5 },
    { key: 'plane', label: 'Plane · 0XY 1XZ 2YZ', min: 0, max: 2, step: 1, default: 0 },
    { key: 'centerGrid', label: 'Center · 0/1', min: 0, max: 1, step: 1, default: 1 },
    { key: 'stagger', label: 'Row Stagger', min: -1, max: 1, step: 0.05, default: 0 },
  ],
  getClones: (s) => {
    const nx = Math.max(1, Math.round(s.tilesX ?? 3))
    const ny = Math.max(1, Math.round(s.tilesY ?? 3))
    return {
      count: nx * ny,
      getTransform: (i, s) => {
        const cols = Math.max(1, Math.round(s.tilesX ?? 3))
        const rows = Math.max(1, Math.round(s.tilesY ?? 3))
        const scale = s.scale ?? 0.5
        const sx = (s.spacingX ?? 1.2) * scale
        const sy = (s.spacingY ?? 1.2) * scale
        const col = i % cols
        const row = Math.floor(i / cols)
        let px = col * sx * 2
        let py = row * sy * 2
        if ((s.stagger ?? 0) !== 0 && row % 2 === 1) px += (s.stagger ?? 0) * sx
        if ((s.centerGrid ?? 1) >= 0.5) {
          px -= (cols - 1) * sx
          py -= (rows - 1) * sy
        }
        const plane = Math.round(s.plane ?? 0)
        const pos = plane === 0 ? new Vector3(px, py, 0)
          : plane === 1 ? new Vector3(px, 0, py)
          : new Vector3(0, px, py)
        return new Matrix4().compose(pos, IDENT_Q, new Vector3(scale, scale, scale))
      },
    }
  },
}

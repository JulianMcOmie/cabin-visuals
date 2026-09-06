import type { MeshPhysicalMaterial } from 'three'
import type { ObjectState } from '../core/visual/types'
import type { LocalTransform, TransformCtx } from './types'

export const BASIC_SHAPE_COLOR = '#5757db'
export type BasicShape = 'circle' | 'triangle'

export const BASIC_SHAPE_MATERIALS = {
  circle: {
    metalness: 0.62,
    roughness: 0.13,
    clearcoat: 0.72,
    clearcoatRoughness: 0.08,
    iridescence: 0.72,
    iridescenceIOR: 1.45,
    envMapIntensity: 1.55,
    flatShading: false,
  },
  triangle: {
    metalness: 0.04,
    roughness: 0.58,
    clearcoat: 0.08,
    clearcoatRoughness: 0.5,
    iridescence: 0,
    iridescenceIOR: 1.3,
    envMapIntensity: 0.82,
    flatShading: true,
  },
}

// Placement belongs to the track transform. The former expression's port.scale
// was never supplied, so only note energy contributes to this local scale.
export function basicShapeTransform({ energy }: TransformCtx): LocalTransform {
  const scale = 1 + energy * 0.35
  return { position: [0, 0, 0], rotation: [0, 0, 0], scale: [scale, scale, scale] }
}

export function applyBasicShapeAppearance(
  material: Pick<MeshPhysicalMaterial, 'color' | 'emissiveIntensity'>,
  state: Pick<ObjectState, 'params' | 'stringParams' | 'energy'>,
): void {
  const directColor = state.stringParams.baseColor
  const legacyHue = state.params.baseHue
  if (directColor) material.color.set(directColor)
  else if (legacyHue !== undefined) material.color.setHSL(((legacyHue % 360) + 360) % 360 / 360, 0.65, 0.6)
  else material.color.set(BASIC_SHAPE_COLOR)
  material.emissiveIntensity = 0.2 + state.energy * 2.4
}

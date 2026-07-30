import { KALEIDO_FIELD_GLSL } from './kaleidoField'
import type { VisualEffect } from '../types'

/**
 * Kaleido Skin: turns ANY instrument's surface into a live kaleidoscope.
 *
 * A `material` effect, not a `shader` one - it is injected into the target's own
 * materials and evaluated in the mesh's object space, so the pattern is bolted to
 * the surface and turns and travels with the object. A screen-space pass would
 * anchor the pattern to the frame and let it slide across a moving mesh.
 *
 * Nothing is preset or baked: the shards continuously grow and shrink on their own
 * cycles, drift within their cells, morph between 3 and 7 sides, and each cycles
 * its own hue, so the surface never settles into a fixed texture.
 *
 * Caveat worth knowing before reaching for it: injection keys off three's built-in
 * material shaders, so instruments that draw with their own raw ShaderMaterial
 * (LaserSphere, FractalTunnel, Stars, Wormhole, DotField…) are left untouched.
 */
export const kaleidoSkinPlugin: VisualEffect = {
  id: 'kaleidoSkin',
  name: 'Kaleido Skin',
  category: 'material',
  params: [
    // Floored in the shader: automation lanes interpolate continuously and a
    // fractional wedge count tears the fold at the wrap seam.
    { key: 'facets', label: 'Facets', min: 2, max: 16, step: 1, default: 6 },
    { key: 'scale', label: 'Scale', min: 0.3, max: 3, step: 0.05, default: 1 },
    { key: 'drift', label: 'Drift', min: 0, max: 2, step: 0.05, default: 0.6 },
    { key: 'hue', label: 'Hue', min: 0, max: 6.28, step: 0.05, default: 0 },
  ],
  materialField: KALEIDO_FIELD_GLSL,
}

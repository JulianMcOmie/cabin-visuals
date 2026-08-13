import { Color, DoubleSide, FrontSide, ShaderMaterial } from 'three'

// The "poster" look, extracted from Overlap Solid so the 3D Shape's Matte
// finish and the overlap instruments render the SAME surface by construction:
// a flat base color mixed with a fixed-direction lambert term (never scene
// lights), tone-map-free so the picked color is the rendered color, with a
// gentle lift toward white as the note-pulse energy - present but never
// glaring, and nothing bright enough to trip the scene bloom.

export const POSTER_SHADE_DEFAULT = 0.3

/** `posterShade(color, normal, shade)`: the one lighting formula. `shade` 0 is
 *  the 2D instrument's poster-flat fill; 1 is the full lambert model. */
export const POSTER_SHADING_GLSL = /* glsl */ `
vec3 posterShade(vec3 color, vec3 normal, float shade) {
  vec3 light = normalize(vec3(0.55, 0.8, 0.6));
  float lambert = clamp(dot(normalize(normal), light), 0.0, 1.0);
  return color * mix(1.0, 0.3 + 0.7 * lambert, shade);
}
`

const POSTER_VERTEX = /* glsl */ `
varying vec3 vNormal;
void main() {
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const POSTER_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uShade;
uniform float uEnergy;
uniform float uOpacity;
varying vec3 vNormal;
${POSTER_SHADING_GLSL}
void main() {
  vec3 col = posterShade(uColor, vNormal, uShade);
  // The note pulse: a modest lift toward white, not an emissive bloom.
  col = mix(col, vec3(1.0), clamp(uEnergy, 0.0, 1.0) * 0.25);
  gl_FragColor = vec4(col * uOpacity, uOpacity);
}
`

/** One poster material; the caller owns disposal and mutates the uniforms per
 *  frame (uColor / uShade / uEnergy - uOpacity is written by the placement
 *  wrapper's applyMaterialOpacity, which targets any `uOpacity` uniform). */
export function createPosterMaterial(options?: { doubleSide?: boolean }): ShaderMaterial {
  const material = new ShaderMaterial({
    vertexShader: POSTER_VERTEX,
    fragmentShader: POSTER_FRAGMENT,
    uniforms: {
      uColor: { value: new Color('#ffffff') },
      uShade: { value: POSTER_SHADE_DEFAULT },
      uEnergy: { value: 0 },
      uOpacity: { value: 1 },
    },
  })
  material.side = options?.doubleSide ? DoubleSide : FrontSide
  return material
}

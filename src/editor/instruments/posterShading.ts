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

// The instanced variant: same poster formula, but placement comes from
// InstancedMesh2's matrices texture and the color comes from its RGBA colors
// texture - rgb is the (already colorShifted) base color per copy, alpha is
// that copy's fade. The `<instanced_*>` includes are the chunks
// @three.ez/instanced-mesh registers on three's ShaderChunk at import; the
// USE_INSTANCING_* defines are injected by the mesh's onBeforeCompile hook,
// so this material renders plain (uColor, full alpha) if ever mounted on a
// non-instanced mesh.
const POSTER_INSTANCED_VERTEX = /* glsl */ `
#include <instanced_pars_vertex>
#include <instanced_color_pars_vertex>
varying vec3 vNormal;
varying vec4 vInstanceColor;
void main() {
  mat4 placed = mat4(1.0);
  vInstanceColor = vec4(1.0);
  #ifdef USE_INSTANCING_INDIRECT
    placed = getInstancedMatrix();
  #endif
  #ifdef USE_INSTANCING_COLOR_INDIRECT
    vInstanceColor = getColorTexture();
  #endif
  vNormal = normalize(mat3(modelMatrix * placed) * normal);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * placed * vec4(position, 1.0);
}
`

const POSTER_INSTANCED_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uShade;
uniform float uEnergy;
uniform float uOpacity;
varying vec3 vNormal;
varying vec4 vInstanceColor;
${POSTER_SHADING_GLSL}
void main() {
  vec3 col = posterShade(uColor * vInstanceColor.rgb, vNormal, uShade);
  col = mix(col, vec3(1.0), clamp(uEnergy, 0.0, 1.0) * 0.25);
  float a = uOpacity * vInstanceColor.a;
  gl_FragColor = vec4(col * a, a);
}
`

/** The poster surface for an InstancedMesh2: per-instance placement and color
 *  (rgb = the copy's shifted base color - set uColor white and write the real
 *  color per instance - alpha = the copy's fade, premultiplied like the plain
 *  poster). Caller owns disposal. */
export function createInstancedPosterMaterial(options?: { doubleSide?: boolean }): ShaderMaterial {
  const material = new ShaderMaterial({
    vertexShader: POSTER_INSTANCED_VERTEX,
    fragmentShader: POSTER_INSTANCED_FRAGMENT,
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

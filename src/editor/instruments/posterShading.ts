import { Color, DoubleSide, FrontSide, ShaderMaterial } from 'three'
import { DEFAULT_POSTER_LIGHT_DIR } from '../core/visual/sceneLights'

// The "poster" look, extracted from Overlap Solid so the 3D Shape's Matte
// finish and the overlap instruments render the SAME surface by construction:
// a flat base color mixed with a single-direction lambert term, tone-map-free
// so the picked color is the rendered color, with a gentle lift toward white
// as the note-pulse energy - present but never glaring, and nothing bright
// enough to trip the scene bloom.
//
// The lambert DIRECTION: historically a baked constant. The poster materials
// now carry it as the `uLightDir` uniform so the Matte finish can follow the
// scene's key (directional) light track - CubeVisual points the uniform's
// value at the scene's shared vector from core/visual/sceneLights.ts. The
// 3-arg `posterShade` overload keeps the baked constant for the consumers
// that embed this GLSL into their own shaders (the Overlap instruments),
// which stay bit-identical.

export const POSTER_SHADE_DEFAULT = 0.3

/** `posterShade(color, normal, shade)`: the one lighting formula. `shade` 0 is
 *  the 2D instrument's poster-flat fill; 1 is the full lambert model. The
 *  4-arg overload takes the light direction; the 3-arg form keeps the
 *  historical baked one. */
export const POSTER_SHADING_GLSL = /* glsl */ `
vec3 posterShade(vec3 color, vec3 normal, float shade, vec3 lightDir) {
  float lambert = clamp(dot(normalize(normal), normalize(lightDir)), 0.0, 1.0);
  return color * mix(1.0, 0.3 + 0.7 * lambert, shade);
}
vec3 posterShade(vec3 color, vec3 normal, float shade) {
  return posterShade(color, normal, shade, vec3(0.55, 0.8, 0.6));
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
uniform vec3 uLightDir;
varying vec3 vNormal;
${POSTER_SHADING_GLSL}
void main() {
  vec3 col = posterShade(uColor, vNormal, uShade, uLightDir);
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
// This include is a MARKER, not used for shading: @three.ez/instanced-mesh
// only injects USE_INSTANCING_COLOR_INDIRECT (and binds its colors texture)
// into materials whose fragment shader contains the color_pars_fragment include.
// Without it the vertex shader's getColorTexture() branch is never compiled in
// and every instance renders uColor (white) - the "I chose a color and nothing
// happens" bug on the Matte finish. The chunk only declares an unused varying.
#include <color_pars_fragment>
uniform vec3 uColor;
uniform float uShade;
uniform float uEnergy;
uniform float uOpacity;
uniform vec3 uLightDir;
varying vec3 vNormal;
varying vec4 vInstanceColor;
${POSTER_SHADING_GLSL}
void main() {
  vec3 col = posterShade(uColor * vInstanceColor.rgb, vNormal, uShade, uLightDir);
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
      // A fresh copy per material: render-path callers repoint `.value` at
      // their scene's shared live vector; preview/panel mounts keep this.
      uLightDir: { value: DEFAULT_POSTER_LIGHT_DIR.clone() },
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
      // A fresh copy per material: render-path callers repoint `.value` at
      // their scene's shared live vector; preview/panel mounts keep this.
      uLightDir: { value: DEFAULT_POSTER_LIGHT_DIR.clone() },
    },
  })
  material.side = options?.doubleSide ? DoubleSide : FrontSide
  return material
}

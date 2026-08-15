import type { VisualEffect } from '../types'

// Lens - the physical-camera artifact family: barrel/pincushion distortion,
// radial chromatic aberration, and a vignette, in optical order (glass bends
// the ray, dispersion splits it, the hood darkens the corners). Every sub-knob
// is neutral at 0, AMOUNT scales them all together - so `fx:<id>:amount` is
// the classic kick-punch lane: park the sub-knobs at the look's ceiling and
// pulse AMOUNT.
const LENS_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform float amount;
uniform float distortion;
uniform float chromatic;
uniform float vignette;
uniform float softness;
uniform float aspect;
varying vec2 vUv;

vec2 distort(vec2 uv, float k) {
  vec2 p = uv - 0.5;
  p.x *= aspect;
  float r2 = dot(p, p);
  p *= 1.0 + k * r2;
  p.x /= aspect;
  return p + 0.5;
}

// Sampling outside the frame is unavoidable once the ray bends; mirroring
// reads far better than a clamped edge-smear (ImpactWarp's rule).
vec2 wrapUv(vec2 uv) {
  vec2 folded = abs(fract(uv * 0.5) * 2.0 - 1.0);
  return folded;
}

void main() {
  float alpha = texture2D(tDiffuse, vUv).a;

  // Distortion strength: positive bulges (barrel), negative pinches.
  float k = distortion * amount * 0.6;
  vec2 uv = distort(vUv, k);

  // Chromatic aberration: red and blue rays bend slightly more/less than
  // green - three samples along the same radial ray, spread growing with r².
  float ca = chromatic * amount * 0.03;
  vec3 color;
  if (ca > 1e-5) {
    color = vec3(
      texture2D(tDiffuse, wrapUv(distort(vUv, k + ca))).r,
      texture2D(tDiffuse, wrapUv(uv)).g,
      texture2D(tDiffuse, wrapUv(distort(vUv, k - ca))).b
    );
  } else {
    color = texture2D(tDiffuse, wrapUv(uv)).rgb;
  }

  // Vignette in aspect-corrected frame space, so the falloff is round on
  // screen rather than stretched with the viewport.
  vec2 centered = vUv - 0.5;
  centered.x *= aspect;
  float edge = length(centered) / (0.5 * length(vec2(aspect, 1.0)));
  float soft = max(softness, 0.02);
  float fall = smoothstep(1.0 - soft, 1.0, edge);
  color *= 1.0 - vignette * amount * fall;

  // Every sub-term is already scaled by AMOUNT, so amount 0 is a bit-exact
  // passthrough with no final mix needed (and the runtime skips the pass).
  gl_FragColor = vec4(color, alpha);
}`

export const lensScenePlugin: VisualEffect = {
  id: 'sceneLens',
  name: 'Lens',
  category: 'scene',
  params: [
    { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 1 },
    { key: 'distortion', label: 'Distortion', min: -1, max: 1, step: 0.01, default: 0 },
    { key: 'chromatic', label: 'Fringe', min: 0, max: 1, step: 0.01, default: 0 },
    { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01, default: 0 },
    { key: 'softness', label: 'Softness', min: 0, max: 1, step: 0.01, default: 0.5 },
  ],
  fragmentShader: LENS_FRAGMENT,
}

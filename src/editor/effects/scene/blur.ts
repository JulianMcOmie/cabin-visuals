import type { VisualEffect } from '../types'

// Blur - gaussian softening, directional smear, or the zoom (radial) blur
// that sells an impact. One MODE select, because the three share everything
// but the direction each tap walks. AMOUNT is the blur radius and the
// automation target - a zoom-blur punch is `fx:<id>:amount` on a burst lane.
// 13 taps, weighted toward the center; enough for a musical smear, not a
// reference gaussian (the honest trade at one pass).
const BLUR_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform float amount;
uniform float mode;
uniform float angle;
uniform float aspect;
varying vec2 vUv;

void main() {
  vec4 source = texture2D(tDiffuse, vUv);
  float radius = amount * amount * 0.12; // squared so the low range has room
  if (radius < 1e-5) { gl_FragColor = source; return; }

  vec2 centered = vUv - 0.5;
  centered.x *= aspect;

  vec4 sum = vec4(0.0);
  float weightSum = 0.0;
  for (int i = -6; i <= 6; i++) {
    float t = float(i) / 6.0;
    float w = 1.0 - 0.7 * abs(t);
    vec2 offset;
    if (mode < 0.5) {
      // Gaussian-ish: two interleaved diagonals approximate a disc without a
      // second pass - taps alternate between the two axes.
      float a = 2.399963 * float(i); // golden angle spiral
      offset = vec2(cos(a), sin(a)) * abs(t) * radius;
      offset.x /= aspect;
    } else if (mode < 1.5) {
      float rad = radians(angle);
      offset = vec2(cos(rad) / aspect, sin(rad)) * t * radius * 2.0;
    } else {
      // Zoom: each tap walks toward/away from center along its own ray.
      vec2 dir = centered * 2.0;
      offset = vec2(dir.x / aspect, dir.y) * t * radius * 1.5;
    }
    sum += texture2D(tDiffuse, clamp(vUv + offset, 0.0, 1.0)) * w;
    weightSum += w;
  }
  gl_FragColor = vec4((sum / weightSum).rgb, source.a);
}`

export const blurScenePlugin: VisualEffect = {
  id: 'sceneBlur',
  name: 'Blur',
  category: 'scene',
  accent: '#818cf8',
  params: [
    { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: 'mode', label: 'Mode', type: 'select', options: [
      { value: 0, label: 'Soft' },
      { value: 1, label: 'Directional' },
      { value: 2, label: 'Zoom' },
    ], default: 0 },
    { key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, default: 0, showIf: 'mode=1' },
  ],
  fragmentShader: BLUR_FRAGMENT,
}

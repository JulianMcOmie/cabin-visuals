import type { VisualEffect } from '../types'

// Mirror - screen-space symmetry: a single mirror, a quad fold, an N-segment
// kaleidoscope, or a tile. Unlike the per-object Kaleidoscope shader (which
// works on one object's small patch of frame), this folds the WHOLE composed
// scene, which is where screen-space symmetry actually reads. ANGLE turns the
// fold; automate it for the rotating-kaleido look. AMOUNT crossfades to the
// folded frame, so a burst lane can snap symmetry on for a bar and let go.
const MIRROR_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform float amount;
uniform float mode;
uniform float segments;
uniform float angle;
uniform float aspect;
varying vec2 vUv;

void main() {
  vec4 source = texture2D(tDiffuse, vUv);

  vec2 p = vUv - 0.5;
  p.x *= aspect;
  float rad = radians(angle);
  float c = cos(rad);
  float s = sin(rad);
  mat2 rot = mat2(c, -s, s, c);
  mat2 rotBack = mat2(c, s, -s, c); // a rotation's inverse is its transpose
  p = rot * p;

  vec2 folded;
  if (mode < 0.5) {
    // Mirror: left half reflected onto the right.
    folded = vec2(-abs(p.x), p.y);
  } else if (mode < 1.5) {
    // Quad: both axes fold toward one corner.
    folded = -abs(p);
  } else if (mode < 2.5) {
    // Kaleidoscope: angle folded into one wedge, radius kept.
    float seg = 6.28318530718 / max(segments, 2.0);
    float a = atan(p.y, p.x);
    a = abs(mod(a, seg * 2.0) - seg);
    folded = vec2(cos(a), sin(a)) * length(p);
  } else {
    // Tile: the center quarter repeated across the frame.
    folded = (abs(fract(p * 2.0 + 0.5) - 0.5)) - 0.25;
    folded *= 2.0;
  }

  vec2 uv = rotBack * folded;
  uv.x /= aspect;
  uv += 0.5;
  vec4 mirrored = texture2D(tDiffuse, clamp(uv, 0.0, 1.0));

  gl_FragColor = vec4(mix(source.rgb, mirrored.rgb, amount), source.a);
}`

export const mirrorScenePlugin: VisualEffect = {
  id: 'sceneMirror',
  name: 'Mirror',
  category: 'scene',
  params: [
    { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 1 },
    { key: 'mode', label: 'Mode', type: 'select', options: [
      { value: 0, label: 'Mirror' },
      { value: 1, label: 'Quad' },
      { value: 2, label: 'Kaleidoscope' },
      { value: 3, label: 'Tile' },
    ], default: 2 },
    { key: 'segments', label: 'Segments', min: 2, max: 16, step: 1, default: 6, showIf: 'mode=2' },
    { key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, default: 0 },
  ],
  fragmentShader: MIRROR_FRAGMENT,
}

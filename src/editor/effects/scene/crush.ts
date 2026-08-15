import type { VisualEffect } from '../types'

// Crush - resolution and color destruction: pixelate (mosaic), posterize
// (color quantize), and threshold, each with its own knob so they stack in
// one pass (a crushed frame usually wants two at once). AMOUNT scales all
// three, so one burst lane on `fx:<id>:amount` slams the frame down to
// blocks-and-bands and releases it clean.
const CRUSH_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform float amount;
uniform float pixelate;
uniform float posterize;
uniform float threshold;
uniform float aspect;
varying vec2 vUv;

void main() {
  vec4 source = texture2D(tDiffuse, vUv);

  // Pixelate: cell size grows quadratically so the low range stays usable.
  float p = pixelate * amount;
  vec2 uv = vUv;
  if (p > 1e-4) {
    float cells = mix(400.0, 12.0, p * p);
    vec2 grid = vec2(cells, cells / aspect);
    uv = (floor(vUv * grid) + 0.5) / grid;
  }
  vec3 color = texture2D(tDiffuse, uv).rgb;

  // Posterize: quantize each channel; level count falls as the knob rises.
  float q = posterize * amount;
  if (q > 1e-4) {
    float hdrScale = max(1.0, max(color.r, max(color.g, color.b)));
    vec3 working = color / hdrScale;
    float levels = mix(24.0, 2.0, q);
    working = floor(working * levels + 0.5) / levels;
    color = working * hdrScale;
  }

  // Threshold: push toward a hard two-tone read of the frame's luminance,
  // keeping the frame's own hue in the lit half.
  float t = threshold * amount;
  if (t > 1e-4) {
    float luma = dot(clamp(color, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722));
    float lit = smoothstep(0.5 - 0.02, 0.5 + 0.02, luma);
    vec3 hard = color * (lit / max(luma, 1e-4));
    color = mix(color, clamp(hard, 0.0, 4.0) * lit, t);
  }

  gl_FragColor = vec4(color, source.a);
}`

export const crushScenePlugin: VisualEffect = {
  id: 'sceneCrush',
  name: 'Crush',
  category: 'scene',
  accent: '#fb7185',
  params: [
    { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 1 },
    { key: 'pixelate', label: 'Pixelate', min: 0, max: 1, step: 0.01, default: 0.4 },
    { key: 'posterize', label: 'Posterize', min: 0, max: 1, step: 0.01, default: 0 },
    { key: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0 },
  ],
  fragmentShader: CRUSH_FRAGMENT,
}

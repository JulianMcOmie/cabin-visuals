import type { VisualEffect } from '../types'

// Grade - the foundation device of the scene chain: exposure, contrast,
// saturation, temperature/tint and a hue turn over the scene's finished HDR
// render. Every param is NEUTRAL at its default, so a freshly added Grade is a
// passthrough and AMOUNT scales the whole correction (the automation target:
// automate `fx:<id>:amount` to breathe the grade with the music).
//
// The maths runs in the compositor's linear HDR space (pre-tonemap, HalfFloat
// targets). Contrast and saturation borrow COLOR_FILTER_FRAGMENT's headroom
// trick: normalize by the pixel's own peak channel, operate in [0,1], then
// restore the headroom - so an emitter at 3.0 grades like its SDR self instead
// of clipping at the first operation.
const GRADE_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform float amount;
uniform float exposure;
uniform float contrast;
uniform float saturation;
uniform float temperature;
uniform float tint;
uniform float hueShift;
varying vec2 vUv;

vec3 rotateHue(vec3 color, float turns) {
  vec3 axis = normalize(vec3(1.0));
  float angle = turns * 6.28318530718;
  return color * cos(angle)
    + cross(axis, color) * sin(angle)
    + axis * dot(axis, color) * (1.0 - cos(angle));
}

void main() {
  vec4 source = texture2D(tDiffuse, vUv);

  // Exposure is a straight gain in stops - the one operation that WANTS to act
  // on the raw HDR values rather than the normalized working copy.
  vec3 color = source.rgb * exp2(exposure);

  float hdrScale = max(1.0, max(color.r, max(color.g, color.b)));
  vec3 working = color / hdrScale;

  // White balance: temperature slides red against blue, tint green against
  // magenta. Applied as complementary gains so mid-gray holds its luminance.
  working *= vec3(1.0 + 0.25 * temperature - 0.1 * tint,
                  1.0 + 0.2 * tint,
                  1.0 - 0.25 * temperature - 0.1 * tint);

  float luma = dot(working, vec3(0.2126, 0.7152, 0.0722));
  working = mix(vec3(luma), working, 1.0 + saturation);
  working = (working - 0.5) * (1.0 + contrast) + 0.5;
  if (abs(hueShift) > 1e-4) working = rotateHue(working, hueShift);

  vec3 graded = clamp(working, 0.0, 1.0) * hdrScale;
  gl_FragColor = vec4(mix(source.rgb, graded, amount), source.a);
}`

export const gradeScenePlugin: VisualEffect = {
  id: 'sceneGrade',
  name: 'Grade',
  category: 'scene',
  accent: '#eab308',
  params: [
    { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 1 },
    { key: 'exposure', label: 'Exposure', min: -2, max: 2, step: 0.01, default: 0 },
    { key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.01, default: 0 },
    { key: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.01, default: 0 },
    { key: 'temperature', label: 'Temperature', min: -1, max: 1, step: 0.01, default: 0 },
    { key: 'tint', label: 'Tint', min: -1, max: 1, step: 0.01, default: 0 },
    { key: 'hueShift', label: 'Hue', min: -0.5, max: 0.5, step: 0.005, default: 0 },
  ],
  fragmentShader: GRADE_FRAGMENT,
}

import { Vector2, Vector3 } from 'three'

/** The note history is resolved once per track on the CPU. These few values
 * drive every star in parallel, without integrating a previous GPU frame. */
export interface StarsFrame {
  displacement: readonly [number, number, number]
  spread: number
  depth: number
  pulseAmount: number
  rollAngle: number
  tumbleAngle: number
  tumbleAxis: readonly [number, number, number]
  dotSize: number
  tint: number
}

export function createStarsUniforms() {
  return {
    uDisplacement: { value: new Vector3() },
    uHalfBounds: { value: new Vector3(6, 6, 7.5) },
    uPulse: { value: 0 },
    uRoll: { value: new Vector2(1, 0) },
    uTumble: { value: new Vector2(1, 0) },
    uTumbleAxis: { value: new Vector3(0, 1, 0) },
    uDotSize: { value: 2 },
    uTint: { value: 220 / 360 },
    uStreakFactor: { value: 0 },
    uOpacity: { value: 1 },
  }
}

export type StarsUniforms = ReturnType<typeof createStarsUniforms>

export function createStarsMotionState(home: Float32Array, parallax: Float32Array) {
  return {
    home, parallax,
    positions: new Float32Array(home.length),
    anchor: new Vector3(NaN, NaN, NaN),
    halfBounds: new Vector3(),
  }
}

export type StarsMotionState = ReturnType<typeof createStarsMotionState>

const wrap = (v: number, half: number) => (((v + half) % (2 * half) + 2 * half) % (2 * half)) - half

/** Keep float32 shader arithmetic near the origin even in long projects.
 * Rebase from the immutable seed layout, never from the previous frame, so
 * seeking backwards or exporting out of order produces the same positions.
 * Returns true only when the position attribute needs one new upload. */
export function updateStarsMotion(s: StarsMotionState, u: StarsUniforms, f: StarsFrame): boolean {
  const ax = Math.trunc(f.displacement[0] / 32) * 32
  const ay = Math.trunc(f.displacement[1] / 32) * 32
  const az = Math.trunc(f.displacement[2] / 32) * 32
  updateStarsUniforms(u, f)
  const bounds = u.uHalfBounds.value
  const changed = s.anchor.x !== ax || s.anchor.y !== ay || s.anchor.z !== az || !s.halfBounds.equals(bounds)
  if (changed) {
    for (let i = 0; i < s.parallax.length; i++) {
      const factor = s.parallax[i]
      s.positions[i * 3] = wrap(s.home[i * 3] + ax * factor, bounds.x)
      s.positions[i * 3 + 1] = wrap(s.home[i * 3 + 1] + ay * factor, bounds.y)
      s.positions[i * 3 + 2] = wrap(s.home[i * 3 + 2] + az * factor, bounds.z)
    }
    s.anchor.set(ax, ay, az)
    s.halfBounds.copy(bounds)
  }
  u.uDisplacement.value.set(f.displacement[0] - ax, f.displacement[1] - ay, f.displacement[2] - az)
  return changed
}

export function updateStarsUniforms(u: StarsUniforms, f: StarsFrame): void {
  u.uDisplacement.value.set(...f.displacement)
  u.uHalfBounds.value.set(f.spread, f.spread, f.depth / 2)
  u.uPulse.value = f.pulseAmount
  u.uRoll.value.set(Math.cos(f.rollAngle), Math.sin(f.rollAngle))
  // The legacy instrument only tumbles for positive accumulated angles.
  u.uTumble.value.set(f.tumbleAngle > 0 ? Math.cos(f.tumbleAngle) : 1, f.tumbleAngle > 0 ? Math.sin(f.tumbleAngle) : 0)
  u.uTumbleAxis.value.set(...f.tumbleAxis)
  u.uDotSize.value = f.dotSize
  u.uTint.value = f.tint / 360
}

// Also compiled directly by scripts/perf/stars-gpu.mjs for transform-feedback
// parity checks against the frozen, independent legacy CPU implementation.
export const STARS_TRANSFORM_GLSL = `
uniform vec3 uDisplacement;
uniform vec3 uHalfBounds;
uniform float uPulse;
uniform vec2 uRoll;
uniform vec2 uTumble;
uniform vec3 uTumbleAxis;
uniform float uDotSize;
uniform float uTint;

vec3 starPosition(vec3 home, float parallax) {
  vec3 p = mod(home + uDisplacement * parallax + uHalfBounds, 2.0 * uHalfBounds) - uHalfBounds;
  float distanceXY = length(p.xy);
  if (uPulse > 0.0 && distanceXY > 0.01) p.xy += p.xy / distanceXY * uPulse * parallax;
  p.xy = vec2(p.x * uRoll.x - p.y * uRoll.y, p.x * uRoll.y + p.y * uRoll.x);
  p = p * uTumble.x + cross(uTumbleAxis, p) * uTumble.y
    + uTumbleAxis * dot(uTumbleAxis, p) * (1.0 - uTumble.x);
  return mod(p + uHalfBounds, 2.0 * uHalfBounds) - uHalfBounds;
}

float starSize(vec3 p) {
  return max(0.5, uDotSize * (uHalfBounds.z / (abs(p.z) + 0.5)));
}

float starHue(float q, float p, float hue) {
  float h = fract(hue);
  if (h < 1.0 / 6.0) return q + (p - q) * 6.0 * h;
  if (h < 0.5) return p;
  if (h < 2.0 / 3.0) return q + (p - q) * 6.0 * (2.0 / 3.0 - h);
  return q;
}

vec3 starColor(vec3 p) {
  float depthFraction = abs(p.z) / uHalfBounds.z;
  if (uTint == 0.0 || depthFraction < 0.1) return vec3(1.0);
  float saturation = 0.4 * depthFraction;
  float lightness = 0.9 - 0.3 * depthFraction;
  float high = lightness + saturation - lightness * saturation;
  float low = 2.0 * lightness - high;
  // Matches Color.setHSL in Three's working (linear) color space; no sRGB decode.
  vec3 tint = vec3(starHue(low, high, uTint + 1.0 / 3.0),
    starHue(low, high, uTint), starHue(low, high, uTint - 1.0 / 3.0));
  return mix(vec3(1.0), tint, depthFraction * 0.6);
}

float starAlpha(vec3 p) {
  return 1.0 - abs(p.z) / uHalfBounds.z * 0.7;
}
`

export const STARS_VERTEX_SHADER = `
attribute float aParallax;
varying vec3 vColor;
varying float vAlpha;
varying float vStreak;
uniform float uStreakFactor;
${STARS_TRANSFORM_GLSL}
void main() {
  vec3 p = starPosition(position, aParallax);
  vColor = starColor(p);
  vAlpha = starAlpha(p);
  vStreak = uStreakFactor;
  gl_PointSize = starSize(p) * (1.0 + uStreakFactor * 2.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`

export const STARS_FRAGMENT_SHADER = `
varying vec3 vColor;
varying float vAlpha;
varying float vStreak;
uniform float uOpacity;
void main() {
  vec2 cxy = gl_PointCoord * 2.0 - 1.0;
  float sx = cxy.x / (1.0 + max(vStreak, 0.0) * 3.0);
  float r = sx * sx + cxy.y * cxy.y;
  if (r > 1.0) discard;
  float alpha = vAlpha * (1.0 - smoothstep(0.4, 1.0, r));
  gl_FragColor = vec4(vColor, alpha * uOpacity);
}
`

/** CPU positions are needed only for explicit pointer picking. Keep that work
 * off playback/export, and off the render geometry so it causes no GL upload. */
export function writeStarsPickPositions(home: Float32Array, parallax: Float32Array, u: StarsUniforms, out: Float32Array): void {
  const d = u.uDisplacement.value, bounds = u.uHalfBounds.value
  const roll = u.uRoll.value, tumble = u.uTumble.value, axis = u.uTumbleAxis.value
  for (let i = 0; i < parallax.length; i++) {
    let x = wrap(home[i * 3] + d.x * parallax[i], bounds.x)
    let y = wrap(home[i * 3 + 1] + d.y * parallax[i], bounds.y)
    let z = wrap(home[i * 3 + 2] + d.z * parallax[i], bounds.z)
    const radius = Math.hypot(x, y)
    if (u.uPulse.value > 0 && radius > 0.01) {
      const push = u.uPulse.value * parallax[i]
      x += x / radius * push
      y += y / radius * push
    }
    const rx = x * roll.x - y * roll.y
    y = x * roll.y + y * roll.x
    x = rx
    const dot = axis.x * x + axis.y * y + axis.z * z
    const tx = x * tumble.x + (axis.y * z - axis.z * y) * tumble.y + axis.x * dot * (1 - tumble.x)
    const ty = y * tumble.x + (axis.z * x - axis.x * z) * tumble.y + axis.y * dot * (1 - tumble.x)
    z = z * tumble.x + (axis.x * y - axis.y * x) * tumble.y + axis.z * dot * (1 - tumble.x)
    out[i * 3] = wrap(tx, bounds.x)
    out[i * 3 + 1] = wrap(ty, bounds.y)
    out[i * 3 + 2] = wrap(z, bounds.z)
  }
}

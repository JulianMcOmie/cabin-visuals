import type { VisualEffect } from '../types'

// A local lens over the finished scene. All distances use frame-height units,
// so corners, bevels and frost stay round in landscape and portrait exports.
export const LIQUID_GLASS_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform float aspect;
uniform float time;
uniform float amount;
uniform float refraction;
uniform float frost;
uniform float width;
uniform float height;
uniform float corners;
uniform float positionX;
uniform float positionY;
uniform float angle;
uniform float ripple;
uniform float flow;
uniform float sheen;
uniform float fringe;
varying vec2 vUv;

float glassDistance(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

// Identity within the frame, mirrored beyond it (including negative UVs).
vec2 glassUv(vec2 uv) {
  return 1.0 - abs(mod(uv, 2.0) - 1.0);
}

vec3 glassSample(vec2 uv) {
  return texture2D(tDiffuse, glassUv(uv)).rgb;
}

void main() {
  vec4 source = texture2D(tDiffuse, vUv);
  if (amount <= 0.0) { gl_FragColor = source; return; }
  float a = max(aspect, 0.0001);
  vec2 center = vec2(0.5 + positionX * 0.5, 0.5 + positionY * 0.5);
  vec2 p = (vUv - center) * vec2(a, 1.0);
  float theta = radians(angle);
  mat2 rotation = mat2(cos(theta), sin(theta), -sin(theta), cos(theta));
  mat2 inverseRotation = mat2(cos(theta), -sin(theta), sin(theta), cos(theta));
  p = inverseRotation * p;
  vec2 halfSize = max(vec2(width * a, height) * 0.5, vec2(0.002));
  float smallSide = min(halfSize.x, halfSize.y);
  float radius = clamp(corners, 0.0, 1.0) * smallSide;
  float d = glassDistance(p, halfSize, radius);
  // A fixed frame-relative feather also works in the shared WebGL1 preview.
  float feather = 0.0015;
  float mask = 1.0 - smoothstep(-feather, feather, d);
  if (mask <= 0.0) { gl_FragColor = source; return; }

  vec2 normal = vec2(
    glassDistance(p + vec2(feather, 0.0), halfSize, radius) - glassDistance(p - vec2(feather, 0.0), halfSize, radius),
    glassDistance(p + vec2(0.0, feather), halfSize, radius) - glassDistance(p - vec2(0.0, feather), halfSize, radius)
  );
  normal /= max(length(normal), 0.00001);
  float bevelWidth = max(0.004, smallSide * 0.22);
  float bevel = 1.0 - smoothstep(0.0, bevelWidth, -d);
  float phase = time * flow * 1.570796327;
  // Closed-form waves: paused, scrubbed and exported frames agree exactly.
  vec2 waves = vec2(
    sin(p.y * 19.0 + phase) * cos(p.x * 11.0 - phase * 0.7),
    cos(p.x * 17.0 - phase) * sin(p.y * 13.0 + phase * 0.6)
  );
  vec2 bend = -normal * bevel * bevel * min(smallSide * 0.24, 0.045);
  bend -= p * 0.055;
  bend += waves * ripple * min(smallSide * 0.1, 0.016) * (1.0 - bevel);
  vec2 offset = rotation * bend * refraction / vec2(a, 1.0);
  vec2 uv = vUv + offset;

  vec3 color = glassSample(uv);
  if (frost > 0.001) {
    float blurRadius = frost * frost * 0.026;
    vec3 sum = color * 2.0;
    for (int i = 0; i < 12; i++) {
      float n = float(i) + 0.5;
      float tapAngle = n * 2.39996323;
      vec2 tap = vec2(cos(tapAngle) / a, sin(tapAngle)) * sqrt(n / 12.0) * blurRadius;
      sum += glassSample(uv + tap);
    }
    color = sum / 14.0;
  }
  if (fringe > 0.001) {
    vec2 split = rotation * normal / vec2(a, 1.0) * bevel * fringe * 0.0025;
    // Retain the frosted base while adding only the dispersed channel delta.
    color.r += (glassSample(uv + split).r - glassSample(uv).r) * 0.65;
    color.b += (glassSample(uv - split).b - glassSample(uv).b) * 0.65;
  }
  vec2 screenNormal = rotation * normal;
  float lighting = dot(screenNormal, normalize(vec2(-0.55, 0.83)));
  float rim = exp(-abs(d) / 0.0025);
  float highlight = pow(max(lighting, 0.0), 3.0);
  float reflection = pow(0.5 + 0.5 * sin(p.x * 3.0 + p.y * 5.0 + 0.8), 8.0);
  color *= 1.0 - sheen * bevel * 0.12;
  color += sheen * vec3(0.78, 0.90, 1.0) * (
    rim * (0.14 + highlight * 0.8) + bevel * bevel * highlight * 0.18 + reflection * 0.028
  );
  // Keep the scene's alpha contract: glass never fills transparent cut-outs.
  gl_FragColor = vec4(mix(source.rgb, max(color, 0.0), mask * clamp(amount, 0.0, 1.0)), source.a);
}`

export const liquidGlassScenePlugin: VisualEffect = {
  id: 'sceneLiquidGlass',
  name: 'Liquid Glass',
  category: 'scene',
  accent: '#a5e8f5',
  params: [
    { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 1 },
    { key: 'refraction', label: 'Refraction', min: 0, max: 2, step: 0.01, default: 1 },
    { key: 'frost', label: 'Frost', min: 0, max: 1, step: 0.01, default: 0.22 },
    { key: 'width', label: 'Width', min: 0.05, max: 1.5, step: 0.01, default: 0.56 },
    { key: 'height', label: 'Height', min: 0.05, max: 1.5, step: 0.01, default: 0.58 },
    { key: 'corners', label: 'Corners', min: 0, max: 1, step: 0.01, default: 0.22 },
    { key: 'positionX', label: 'Position X', min: -1.5, max: 1.5, step: 0.01, default: 0 },
    { key: 'positionY', label: 'Position Y', min: -1.5, max: 1.5, step: 0.01, default: 0 },
    { key: 'angle', label: 'Rotation', min: -180, max: 180, step: 1, default: 0 },
    { key: 'ripple', label: 'Ripples', min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: 'flow', label: 'Flow', min: 0, max: 2, step: 0.01, default: 0.5 },
    { key: 'sheen', label: 'Sheen', min: 0, max: 2, step: 0.01, default: 0.85 },
    { key: 'fringe', label: 'Fringe', min: 0, max: 1, step: 0.01, default: 0.3 },
  ],
  fragmentShader: LIQUID_GLASS_FRAGMENT,
}

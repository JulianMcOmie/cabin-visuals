// The Deformer's GLSL: one self-contained chunk per effect INSTANCE.
//
// Everything is suffixed - helpers included - rather than emitting a shared
// prelude once. Deformers stack (twist then bend then melt), so several chunks
// land in one program, and a self-contained chunk keeps MaterialWrapper from
// having to know that this particular plugin has a prelude. The cost is a few
// duplicated helper functions per instance, which the compiler inlines away.
//
// Mirrors deformOps.ts exactly: `fxDrive` is `driveEnvelope`, `fxFalloff` is
// `falloffWeight`. The panel plots the TS copy and the GPU runs this one, so
// they are pinned against each other in deformOps.test.ts. Change one, change
// both.
//
// No backticks anywhere below, including in comments: this is a TS template
// literal, and a stray backtick silently ends the string and surfaces as
// "Parsing ecmascript source code failed" pointing at the comment.

import { instanceSuffix, uniformName } from '../uniforms'
import {
  DEFORM_BEND,
  DEFORM_BULGE,
  DEFORM_INFLATE,
  DEFORM_JITTER,
  DEFORM_MELT,
  DEFORM_PINCH,
  DEFORM_RIPPLE,
  DEFORM_SHEAR,
  DEFORM_SPHERIFY,
  DEFORM_TAPER,
  DEFORM_TWIST,
  DEFORM_WAVE,
} from './deformOps'

// The naming contract is shared with the wrapper that writes the values
// (effects/uniforms.ts) rather than re-derived here: a mismatch would compile
// cleanly and simply never deliver a value.
export { uniformName as deformUniformName, instanceSuffix as deformSuffix }

const TAU = '6.28318530718'

// Memoized per suffix: MaterialWrapper asks for this every frame per deformer
// per copy, and the ~5 KB template string was being rebuilt each time.
const glslBySuffix = new Map<string, string>()

export function deformFieldGlsl(suffix: string): string {
  const cached = glslBySuffix.get(suffix)
  if (cached !== undefined) return cached
  const glsl = buildDeformFieldGlsl(suffix)
  glslBySuffix.set(suffix, glsl)
  return glsl
}

function buildDeformFieldGlsl(suffix: string): string {
  const u = (key: string) => uniformName(key, suffix)
  return `
uniform float ${u('operation')};
uniform float ${u('drive')};
uniform float ${u('falloff')};
uniform float ${u('strength')};
uniform float ${u('axis')};
uniform float ${u('angle')};
uniform float ${u('amount')};
uniform float ${u('center')};
uniform float ${u('width')};
uniform float ${u('wavelength')};
uniform float ${u('phase')};
uniform float ${u('radius')};
uniform float ${u('seed')};
uniform float ${u('rate')};
uniform float ${u('falloffSize')};
uniform float ${u('falloffOffset')};
uniform float ${u('falloffSoftness')};

// The chosen axis becomes the THIRD component, so every operation below can be
// written once against (u, v, along) and inherit the axis select for free.
vec3 fxAxisTo${suffix}(vec3 p, int ax) {
  if (ax == 0) return vec3(p.y, p.z, p.x);
  if (ax == 1) return vec3(p.x, p.z, p.y);
  return p;
}
vec3 fxAxisFrom${suffix}(vec3 q, int ax) {
  if (ax == 0) return vec3(q.z, q.x, q.y);
  if (ax == 1) return vec3(q.x, q.z, q.y);
  return q;
}

float fxHash${suffix}(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

float fxDrive${suffix}() {
  int d = int(${u('drive')} + 0.5);
  float r = ${u('rate')};
  if (d == 1) { float p = uKBeat * r; return exp(-4.0 * fract(p)); }
  if (d == 2) return uKBeat * r;
  if (d == 3) return 0.5 - 0.5 * cos(uKBeat * r * ${TAU});
  return 1.0;
}

float fxSoftEdge${suffix}(float d, float size, float soft) {
  float inner = size * (1.0 - soft);
  if (d <= inner) return 1.0;
  if (d >= size) return 0.0;
  float t = (d - inner) / max(1e-4, size - inner);
  return 1.0 - t * t * (3.0 - 2.0 * t);
}

float fxFalloff${suffix}(float along, float radius, float cheb) {
  int m = int(${u('falloff')} + 0.5);
  if (m == 0) return 1.0;
  float size = max(1e-4, ${u('falloffSize')});
  float soft = clamp(${u('falloffSoftness')}, 0.0, 1.0);
  float off = ${u('falloffOffset')};
  if (m == 1) {
    float t = clamp((along - off) / size + 0.5, 0.0, 1.0);
    return t * (1.0 - soft) + soft * t * t * (3.0 - 2.0 * t);
  }
  if (m == 2) return fxSoftEdge${suffix}(radius - off, size, soft);
  return fxSoftEdge${suffix}(cheb - off, size, soft);
}

vec3 fxApply${suffix}(vec3 pos, vec3 nrm) {
  int op = int(${u('operation')} + 0.5);
  int ax = int(${u('axis')} + 0.5);
  vec3 q = fxAxisTo${suffix}(pos, ax);
  float radius = length(pos);
  float cheb = max(max(abs(pos.x), abs(pos.y)), abs(pos.z));
  float k = ${u('strength')} * fxDrive${suffix}() * fxFalloff${suffix}(q.z, radius, cheb);
  if (abs(k) < 1e-6) return pos;

  float t = q.z - ${u('center')};
  float band = max(0.05, ${u('width')});
  float wl = max(0.05, ${u('wavelength')});

  if (op == ${DEFORM_TWIST}) {
    float a = ${u('angle')} * 0.01745329 * k * t;
    float c = cos(a); float s = sin(a);
    q.xy = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
  } else if (op == ${DEFORM_BEND}) {
    float a = ${u('angle')} * 0.01745329 * k * t;
    float c = cos(a); float s = sin(a);
    q.xz = vec2(q.x * c - q.z * s, q.x * s + q.z * c);
  } else if (op == ${DEFORM_TAPER}) {
    q.xy *= 1.0 + ${u('amount')} * k * t;
  } else if (op == ${DEFORM_SHEAR}) {
    q.x += ${u('amount')} * k * q.z;
  } else if (op == ${DEFORM_BULGE}) {
    float g = t / band;
    q.xy *= 1.0 + ${u('amount')} * k * exp(-g * g);
  } else if (op == ${DEFORM_WAVE}) {
    q.x += ${u('amount')} * k * sin(q.z / wl * ${TAU} + ${u('phase')} * ${TAU});
  } else if (op == ${DEFORM_RIPPLE}) {
    float r = length(q.xy);
    q.z += ${u('amount')} * k * sin(r / wl * ${TAU} - ${u('phase')} * ${TAU});
  } else if (op == ${DEFORM_INFLATE}) {
    return pos + nrm * (${u('amount')} * k);
  } else if (op == ${DEFORM_SPHERIFY}) {
    float d = max(1e-4, radius);
    return mix(pos, pos / d * ${u('radius')}, clamp(${u('amount')} * k, 0.0, 1.0));
  } else if (op == ${DEFORM_PINCH}) {
    float g = t / band;
    q.xy *= 1.0 - ${u('amount')} * k * exp(-g * g);
  } else if (op == ${DEFORM_MELT}) {
    // Pools at the axis's negative end and spreads where it pools.
    float pool = clamp(0.5 - q.z * 0.5, 0.0, 1.0);
    q.z -= ${u('amount')} * k * pool;
    q.xy *= 1.0 + band * k * pool * 0.5;
  } else if (op == ${DEFORM_JITTER}) {
    vec3 seeded = pos / wl + ${u('seed')};
    vec3 h = vec3(
      fxHash${suffix}(seeded),
      fxHash${suffix}(seeded + 19.13),
      fxHash${suffix}(seeded + 41.77)
    ) - 0.5;
    return pos + h * (${u('amount')} * k);
  }
  return fxAxisFrom${suffix}(q, ax);
}

// Normals are re-derived by finite differences rather than left alone: a bent
// surface lit by its ORIGINAL normals reads as a flat object with a warped
// silhouette, which is the single most common way a deformer looks broken.
// Two tangent samples are deformed alongside the point and crossed; the frame
// (t1, t2, nrm) is right-handed, so the cross comes back pointing outward with
// no sign fixing. A degenerate result (the deform collapsed the neighbourhood)
// keeps the original normal instead of flipping the shading inside out.
vec3 fxDeformNormal${suffix}(vec3 pos, vec3 nrm, vec3 moved) {
  vec3 ref = abs(nrm.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(nrm, ref));
  vec3 t2 = cross(nrm, t1);
  float e = 0.01;
  vec3 d1 = fxApply${suffix}(pos + t1 * e, nrm) - moved;
  vec3 d2 = fxApply${suffix}(pos + t2 * e, nrm) - moved;
  vec3 n = cross(d1, d2);
  float len = length(n);
  return len > 1e-8 ? n / len : nrm;
}
`
}

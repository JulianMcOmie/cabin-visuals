// The REFERENCE FRAME every Scene FX panel previews against, and the assembly
// that runs a device's real shader over it.
//
// A scene device processes a whole rendered frame, so its panel cannot preview
// "the effect" on a lone object the way an instrument's can - it needs a frame.
// Sampling the live viewport is not available to a panel (a second WebGL
// context cannot share the compositor's textures, and reading pixels back per
// frame is far too expensive), so the preview renders a PROCEDURAL frame in the
// shader itself and the device's own GLSL runs over it. That is what keeps the
// preview honest: the picture in the panel is produced by the exact source that
// produces the picture in the viewport (KaleidoSolid's and the Deformer's rule,
// applied to a full-frame effect).
//
// The frame's CONTENT is a design decision, not decoration - each element is
// there so that one of the seven devices is legible, and dropping any of them
// makes a device look broken in its own panel:
//
//   - an off-centre solid, so MIRROR's fold has something asymmetric to fold
//     (a centred subject makes every mirror mode look like a no-op);
//   - a receding grid of straight lines running into all four edges, so LENS's
//     barrel/pincushion bends something visibly straight, and BLUR has fine
//     high-frequency detail to destroy;
//   - large flat mid-tone areas, because GRAIN is invisible on busy pixels and
//     its luminance weighting peaks at mid grey;
//   - one long smooth backdrop ramp, so CRUSH's posterize shows real banding;
//   - emitters well above 1.0, so GRADE's exposure has highlight headroom to
//     pull down rather than clipped white.
//
// Everything is a pure function of `uv` and the aspect uniform, so the panel may
// render it at any size; `time` is the panel's own rAF clock in beats (chrome,
// not a rendered visual - see the design guide).

import type { VisualEffect } from '../types'

/** Declared once by the preview prelude; a device shader's own copies of these
 *  are stripped during assembly so the program has no duplicate symbols. */
const SHARED_DECLARATIONS = /^\s*(varying\s+vec2\s+vUv;|uniform\s+sampler2D\s+tDiffuse;|uniform\s+float\s+aspect;)\s*$/

export const SCENE_FX_PREVIEW_PRELUDE = `precision highp float;
varying vec2 vUv;
uniform float aspect;

float sceneFxEmitter(vec2 p, vec2 center, float radius) {
  float d = length(p - center);
  return exp(-(d * d) / (radius * radius)) + 0.30 * exp(-d / (radius * 5.0));
}

vec3 sceneFxReferenceFrame(vec2 uv) {
  uv = clamp(uv, 0.0, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * 2.0;

  // Backdrop: one long ramp from a lit upper-left toward black - the smooth
  // gradient Crush's posterize bands across.
  float lit = clamp(1.0 - length((p - vec2(-0.55, 0.45)) * vec2(0.42, 0.52)), 0.0, 1.0);
  vec3 color = mix(vec3(0.008, 0.011, 0.032), vec3(0.075, 0.125, 0.315), lit * lit);

  // Floor grid: straight lines reaching every edge (Lens), fine detail (Blur).
  float horizon = -0.30;
  if (p.y < horizon) {
    float depth = horizon - p.y + 0.012;
    float perspective = 0.26 / depth;
    float across = p.x * perspective * 0.75;
    float along = perspective * 1.05;
    float lineAcross = min(fract(across), 1.0 - fract(across));
    float lineAlong = min(fract(along), 1.0 - fract(along));
    float grid = max(smoothstep(0.030, 0.0, lineAcross), smoothstep(0.045, 0.0, lineAlong));
    color += vec3(0.10, 0.40, 0.62) * grid * clamp(depth * 2.6, 0.0, 1.0) * 0.62;
  }

  // The subject: a rounded solid parked off-centre (Mirror), with broad flat
  // faces for Grain to sit in and a hot rim for Grade to roll off.
  vec2 corner = abs(p - vec2(-0.46, 0.14)) - vec2(0.27, 0.27);
  float box = length(max(corner, 0.0)) + min(max(corner.x, corner.y), 0.0) - 0.075;
  float face = smoothstep(0.010, -0.010, box);
  vec3 solid = mix(vec3(0.86, 0.17, 0.52), vec3(0.17, 0.33, 0.94),
                   clamp((p.y + 0.22) / 0.62, 0.0, 1.0));
  color = mix(color, solid, face);
  color += vec3(1.0, 0.74, 0.52) * smoothstep(0.050, 0.0, abs(box)) * 0.85;

  // Emitters above 1.0: Grade's highlight headroom, and what Bloom would catch.
  color += vec3(1.00, 0.88, 0.58) * sceneFxEmitter(p, vec2(0.52, 0.44), 0.030) * 2.1;
  color += vec3(0.48, 0.90, 1.00) * sceneFxEmitter(p, vec2(0.80, -0.04), 0.023) * 1.7;
  color += vec3(1.00, 0.40, 0.72) * sceneFxEmitter(p, vec2(0.30, -0.52), 0.019) * 1.4;

  color += vec3(0.32, 0.52, 1.00) * smoothstep(0.13, 0.0, abs(p.x - 1.02))
         * 0.22 * smoothstep(-0.9, 0.5, p.y);
  return color;
}

vec4 sceneFxReferenceTexel(vec2 uv) { return vec4(sceneFxReferenceFrame(uv), 1.0); }
`

/**
 * A device's fragment shader rewired to read the reference frame instead of the
 * compositor's scene texture. Two textual edits, both mechanical:
 *
 *   - every `texture2D(tDiffuse, …)` becomes a reference-frame sample, so a
 *     device that takes many taps (Blur's 13, Lens's three chromatic samples)
 *     previews with exactly the tap pattern it ships;
 *   - the declarations the prelude already provides are dropped.
 *
 * The device's own body is otherwise untouched, which is the point - there is no
 * second copy of the effect to drift. `sceneFxPreviewFragment` is pure so
 * `previewFrame.test.ts` can assert the rewiring on every registered device
 * (a shader that sampled the texture some other way would be caught there,
 * rather than showing up as a black panel).
 */
export function sceneFxPreviewFragment(fragmentShader: string): string {
  const body = fragmentShader
    .split('\n')
    .filter((line) => !SHARED_DECLARATIONS.test(line))
    .join('\n')
    .replace(/texture2D\s*\(\s*tDiffuse\s*,/g, 'sceneFxReferenceTexel(')
  return `${SCENE_FX_PREVIEW_PRELUDE}\n${body}`
}

/** Every uniform the preview drives: the device's own params plus the two the
 *  prelude and the animated devices read. */
export function sceneFxPreviewUniformNames(plugin: VisualEffect): string[] {
  return ['aspect', 'time', ...plugin.params.map((param) => param.key)]
}

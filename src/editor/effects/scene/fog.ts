import type { VisualEffect } from '../types'

export const FOG_MAX_LIGHTS = 8

// World-space single scattering. Depth terminates each ray at opaque geometry;
// the fixed sample budget and beat-driven field keep seeks/export deterministic.
export const FOG_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform mat4 fogProjectionInverse;
uniform mat4 fogCameraWorld;
uniform vec3 fogAmbient;
uniform int fogLightCount;
uniform vec3 fogLightPosition[${FOG_MAX_LIGHTS}];
uniform vec3 fogLightColor[${FOG_MAX_LIGHTS}];
uniform vec3 fogLightDirection[${FOG_MAX_LIGHTS}];
// type (0 point, 1 spot, 2 directional, 3 area), range, decay, outer cone
uniform vec4 fogLightShape[${FOG_MAX_LIGHTS}];
// inner cone, area width, area height
uniform vec3 fogLightExtra[${FOG_MAX_LIGHTS}];
uniform float amount;
uniform float density;
uniform float reach;
uniform float scattering;
uniform float detail;
uniform float scale;
uniform float drift;
uniform float time;
varying vec2 vUv;

float fogHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float fogNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fogHash(i), fogHash(i + vec3(1,0,0)), f.x),
                 mix(fogHash(i + vec3(0,1,0)), fogHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(fogHash(i + vec3(0,0,1)), fogHash(i + vec3(1,0,1)), f.x),
                 mix(fogHash(i + vec3(0,1,1)), fogHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
vec3 fogWorld(float z) {
  vec4 p = fogProjectionInverse * vec4(vUv * 2.0 - 1.0, z, 1.0);
  return (fogCameraWorld * vec4(p.xyz / p.w, 1.0)).xyz;
}
void main() {
  vec4 source = texture2D(tDiffuse, vUv);
  if (amount <= 0.0 || density <= 0.0) { gl_FragColor = source; return; }
  vec3 origin = fogWorld(-1.0);
  vec3 end = fogWorld(texture2D(tDepth, vUv).r * 2.0 - 1.0);
  vec3 path = end - origin;
  float distanceToSurface = length(path);
  vec3 ray = path / max(distanceToSurface, 0.0001);
  float stepSize = min(distanceToSurface, max(0.0, reach)) / 32.0;
  // Spatial dither hides sample bands without flickering while paused.
  float jitter = fogHash(vec3(gl_FragCoord.xy, 0.0));
  float transmission = 1.0;
  vec3 radiance = vec3(0.0);
  for (int s = 0; s < 32; s++) {
    vec3 p = origin + ray * (float(s) + jitter) * stepSize;
    vec3 field = p / max(scale, 0.1) + vec3(time * drift * 0.13, time * drift * 0.04, 0.0);
    float noise = fogNoise(field) * 0.7 + fogNoise(field * 2.03) * 0.3;
    float localDensity = max(0.0, density) * 0.08 * mix(1.0, noise * 1.8, clamp(detail, 0.0, 1.0));
    vec3 illumination = fogAmbient * 0.25;
    for (int i = 0; i < ${FOG_MAX_LIGHTS}; i++) {
      if (i >= fogLightCount) break;
      vec4 shape = fogLightShape[i];
      vec3 delta = fogLightPosition[i] - p;
      float d = length(delta);
      vec3 towardLight = delta / max(d, 0.001);
      float falloff = 1.0;
      if (shape.x > 1.5 && shape.x < 2.5) {
        towardLight = -fogLightDirection[i];
      } else {
        falloff = 1.0 / max(pow(d, max(shape.z, 0.0)), 1.0);
        if (shape.y > 0.0) falloff *= pow(clamp(1.0 - pow(d / shape.y, 4.0), 0.0, 1.0), 2.0);
        if (shape.x > 0.5 && shape.x < 1.5) {
          float cone = dot(-towardLight, fogLightDirection[i]);
          falloff *= smoothstep(shape.w, max(shape.w + 0.0001, fogLightExtra[i].x), cone);
        } else if (shape.x > 2.5) {
          // Finite area emitter approximation: solid-angle falloff and one-sided emission.
          float area = fogLightExtra[i].y * fogLightExtra[i].z;
          falloff = area / (area + d * d) * max(0.0, dot(-towardLight, fogLightDirection[i]));
        }
      }
      float g = clamp(scattering, 0.0, 0.85);
      float cosTheta = dot(towardLight, ray);
      // Normalized Henyey-Greenstein phase (1 / 4π): without normalization
      // the default surface-light rig blows the haze out to solid white.
      float phase = 0.07957747 * (1.0 - g * g) / pow(max(0.02, 1.0 + g * g - 2.0 * g * cosTheta), 1.5);
      illumination += fogLightColor[i] * falloff * phase;
    }
    float absorbed = 1.0 - exp(-localDensity * stepSize);
    radiance += transmission * absorbed * illumination;
    transmission *= 1.0 - absorbed;
  }
  vec3 fogged = source.rgb * transmission + radiance;
  // Scattering remains visible over transparent scene backdrops and exports.
  float alpha = source.a + (1.0 - source.a) * (1.0 - transmission);
  gl_FragColor = mix(source, vec4(fogged, alpha), clamp(amount, 0.0, 1.0));
}`

export const fogScenePlugin: VisualEffect = {
  id: 'sceneFog',
  name: 'Atmospheric Fog',
  category: 'scene',
  sceneStage: 'atmosphere',
  accent: '#9bbfcf',
  params: [
    { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.65 },
    { key: 'density', label: 'Density', min: 0, max: 2, step: 0.01, default: 0.3 },
    { key: 'scattering', label: 'Light scatter', min: 0, max: 0.85, step: 0.01, default: 0.35 },
    { key: 'detail', label: 'Turbulence', min: 0, max: 1, step: 0.01, default: 0.65 },
    { key: 'scale', label: 'Cloud size', min: 0.5, max: 20, step: 0.1, default: 4 },
    { key: 'drift', label: 'Drift', min: 0, max: 2, step: 0.01, default: 0.2 },
    { key: 'reach', label: 'Depth', min: 1, max: 80, step: 1, default: 30 },
  ],
  fragmentShader: FOG_FRAGMENT,
}

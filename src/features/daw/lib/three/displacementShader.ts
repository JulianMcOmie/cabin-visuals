import * as THREE from 'three';

// Shared displacement uniforms — create one set and share by reference across all materials
export interface DisplacementUniforms {
  uWaveAmp: THREE.IUniform<number>;
  uWaveFreq: THREE.IUniform<number>;
  uWaveSpeed: THREE.IUniform<number>;
  uWarpAmp: THREE.IUniform<number>;
  uWarpFold: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
}

export function createDisplacementUniforms(): DisplacementUniforms {
  return {
    uWaveAmp: { value: 0 },
    uWaveFreq: { value: 2.0 },
    uWaveSpeed: { value: 1.8 },
    uWarpAmp: { value: 0 },
    uWarpFold: { value: 3.0 },
    uTime: { value: 0 },
  };
}

export const DISPLACEMENT_VERT = /* glsl */ `
  uniform float uWaveAmp;
  uniform float uWaveFreq;
  uniform float uWaveSpeed;
  uniform float uWarpAmp;
  uniform float uWarpFold;
  uniform float uTime;

  varying vec2 vUv;

  void main() {
    vec3 pos = position;

    // Apply instance transform when used with InstancedMesh (e.g. ManagedDotSet)
    #ifdef USE_INSTANCING
      pos = (instanceMatrix * vec4(pos, 1.0)).xyz;
    #endif

    // Ink-on-water: cross-axis sine displacement
    if (uWaveAmp > 0.0001) {
      pos.x += sin(pos.y * uWaveFreq + uTime * uWaveSpeed) * uWaveAmp;
      pos.y += sin(pos.x * uWaveFreq * 1.3 + uTime * uWaveSpeed * 0.7) * uWaveAmp;
    }

    // Warp field: N-fold polar symmetry with multiple harmonics
    if (uWarpAmp > 0.0001) {
      float r = length(pos.xy) + 0.001;
      float theta = atan(pos.y, pos.x);
      float cosT = pos.x / r;
      float sinT = pos.y / r;
      float N = uWarpFold;
      float ts = uTime * 0.6;

      // Primary N-fold radial pattern
      float dr = sin(N * theta + ts * 1.3) * cos(r * 3.0 + ts);
      // Concentric ripple modulated by N-fold
      dr += 0.5 * sin(r * N + ts * 0.7) * cos(N * theta - ts * 0.9);
      // 2N harmonic — doubles petal count
      dr += 0.35 * sin(2.0 * N * theta - ts * 1.1) * sin(r * 4.0 + ts * 1.5);

      // Tangential: N-1 fold swirl
      float dt = 0.4 * sin((N - 1.0) * theta + ts * 0.8) * cos(r * 2.0 + ts * 1.2);
      // Counter-rotating N+1 fold
      dt += 0.25 * cos((N + 1.0) * theta - ts) * sin(r * 3.5 - ts * 0.6);

      pos.x += (dr * cosT - dt * sinT) * uWarpAmp;
      pos.y += (dr * sinT + dt * cosT) * uWarpAmp;
    }

    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const DISPLACEMENT_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;

  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
  }
`;

export function createDisplacementMaterial(
  sharedUniforms: DisplacementUniforms,
  color?: THREE.Color,
  opacity?: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: DISPLACEMENT_VERT,
    fragmentShader: DISPLACEMENT_FRAG,
    uniforms: {
      // Shared by reference — updating the uniform object updates all materials
      uWaveAmp: sharedUniforms.uWaveAmp,
      uWaveFreq: sharedUniforms.uWaveFreq,
      uWaveSpeed: sharedUniforms.uWaveSpeed,
      uWarpAmp: sharedUniforms.uWarpAmp,
      uWarpFold: sharedUniforms.uWarpFold,
      uTime: sharedUniforms.uTime,
      // Per-material
      uColor: { value: color ?? new THREE.Color(0x000000) },
      uOpacity: { value: opacity ?? 1.0 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
}

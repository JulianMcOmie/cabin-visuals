import * as THREE from 'three';

export const BLOB_VERT = /* glsl */ `
  attribute float aOpacity;
  uniform vec3 uColor;

  varying float vOpacity;

  void main() {
    vOpacity = aOpacity;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

export const BLOB_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vOpacity;

  void main() {
    gl_FragColor = vec4(uColor, vOpacity);
  }
`;

export function createBlobMaterial(color?: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: BLOB_VERT,
    fragmentShader: BLOB_FRAG,
    uniforms: {
      uColor: { value: color ?? new THREE.Color(0x000000) },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
}

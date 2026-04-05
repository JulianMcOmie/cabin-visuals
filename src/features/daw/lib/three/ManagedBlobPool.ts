import * as THREE from 'three';
import { createBlobMaterial } from './blobShader';

// Module-scope scratch matrix
const _mat4 = new THREE.Matrix4();

export interface ManagedBlobPoolOptions {
  parent: THREE.Group;
  maxInstances: number;
  geometry: THREE.BufferGeometry;
  color: THREE.Color;
}

/**
 * InstancedMesh with per-instance opacity for variable-count, variable-opacity shapes.
 * Uses custom shader with aOpacity attribute.
 */
export class ManagedBlobPool {
  private mesh: THREE.InstancedMesh;
  private material: THREE.ShaderMaterial;
  private opacityArray: Float32Array;
  private opacityAttr: THREE.InstancedBufferAttribute;

  constructor(private opts: ManagedBlobPoolOptions) {
    this.material = createBlobMaterial(opts.color);

    this.mesh = new THREE.InstancedMesh(opts.geometry, this.material, opts.maxInstances);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;

    // Per-instance opacity attribute
    this.opacityArray = new Float32Array(opts.maxInstances);
    this.opacityAttr = new THREE.InstancedBufferAttribute(this.opacityArray, 1);
    this.opacityAttr.setUsage(THREE.DynamicDrawUsage);
    this.mesh.geometry.setAttribute('aOpacity', this.opacityAttr);

    // Initialize all instances at scale 0 so they're invisible until explicitly positioned
    _mat4.makeScale(0, 0, 0);
    for (let i = 0; i < opts.maxInstances; i++) {
      this.mesh.setMatrixAt(i, _mat4);
      this.opacityArray[i] = 0;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.opacityAttr.needsUpdate = true;

    opts.parent.add(this.mesh);
  }

  /** Place a blob at position with opacity, optional scale, and optional rotation (radians). */
  setInstance(index: number, x: number, y: number, opacity: number, scale?: number, rotation?: number): void {
    if (index >= this.opts.maxInstances) return;
    const s = scale ?? 1;
    const r = rotation ?? 0;
    if (r !== 0) {
      const cos = Math.cos(r) * s;
      const sin = Math.sin(r) * s;
      const e = _mat4.elements;
      e[0] = cos;  e[4] = -sin; e[8]  = 0; e[12] = x;
      e[1] = sin;  e[5] =  cos; e[9]  = 0; e[13] = y;
      e[2] = 0;    e[6] =  0;   e[10] = 1; e[14] = 0;
      e[3] = 0;    e[7] =  0;   e[11] = 0; e[15] = 1;
    } else {
      _mat4.makeScale(s, s, 1);
      _mat4.setPosition(x, y, 0);
    }
    this.mesh.setMatrixAt(index, _mat4);
    this.mesh.instanceMatrix.needsUpdate = true;

    this.opacityArray[index] = opacity;
    this.opacityAttr.needsUpdate = true;
  }

  /** Set visible count. */
  setCount(count: number): void {
    this.mesh.count = Math.min(count, this.opts.maxInstances);
  }

  /** Update color for all blobs. */
  setColor(color: number | THREE.Color): void {
    const c = typeof color === 'number' ? new THREE.Color(color) : color;
    this.material.uniforms.uColor.value = c;
  }

  /** Get the underlying InstancedMesh (for setting renderOrder etc.). */
  getMesh(): THREE.InstancedMesh {
    return this.mesh;
  }

  dispose(): void {
    this.opts.parent.remove(this.mesh);
    this.material.dispose();
    this.mesh.dispose();
  }
}

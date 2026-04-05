import * as THREE from 'three';

// Module-scope scratch matrix for instance transforms
const _mat4 = new THREE.Matrix4();

export interface ManagedDotSetOptions {
  parent: THREE.Group;
  maxDots: number;
  material: THREE.Material;
  radius: number;
  segments?: number;
}

/**
 * InstancedMesh wrapper for positioning circle dots.
 * Zero allocations after construction.
 */
export class ManagedDotSet {
  private mesh: THREE.InstancedMesh;
  private geometry: THREE.CircleGeometry;

  constructor(private opts: ManagedDotSetOptions) {
    const segments = opts.segments ?? 12;
    this.geometry = new THREE.CircleGeometry(opts.radius, segments);
    this.mesh = new THREE.InstancedMesh(this.geometry, opts.material, opts.maxDots);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;

    // Initialize all instances at scale 0 so they're invisible until explicitly positioned
    _mat4.makeScale(0, 0, 0);
    for (let i = 0; i < opts.maxDots; i++) {
      this.mesh.setMatrixAt(i, _mat4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    opts.parent.add(this.mesh);
  }

  /** Position a specific dot at (x, y) with optional scale. */
  setDot(index: number, x: number, y: number, scale?: number): void {
    if (index >= this.opts.maxDots) return;
    const s = scale ?? 1;
    _mat4.makeScale(s, s, 1);
    _mat4.setPosition(x, y, 0);
    this.mesh.setMatrixAt(index, _mat4);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Set how many dots are visible. */
  setCount(count: number): void {
    this.mesh.count = Math.min(count, this.opts.maxDots);
  }

  /** Update material color. */
  setColor(color: number | THREE.Color): void {
    const c = typeof color === 'number' ? new THREE.Color(color) : color;
    const mat = this.opts.material;
    if ('uniforms' in mat && (mat as THREE.ShaderMaterial).uniforms?.uColor) {
      (mat as THREE.ShaderMaterial).uniforms.uColor.value = c;
    } else if ('color' in mat) {
      (mat as THREE.MeshBasicMaterial).color = c;
    }
  }

  /** Get the underlying InstancedMesh (for setting renderOrder etc.). */
  getMesh(): THREE.InstancedMesh {
    return this.mesh;
  }

  dispose(): void {
    this.opts.parent.remove(this.mesh);
    this.geometry.dispose();
    this.mesh.dispose();
  }
}

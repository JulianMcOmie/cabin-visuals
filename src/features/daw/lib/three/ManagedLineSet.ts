import * as THREE from 'three';

export interface ManagedLineSetOptions {
  parent: THREE.Group;
  maxLines: number;
  maxPointsPerLine: number;
  material: THREE.Material;
}

/**
 * Pool of pre-allocated THREE.Line objects with shared material.
 * Zero allocations after construction — only copies data and sets draw ranges.
 */
export class ManagedLineSet {
  private lines: THREE.Line[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private positionArrays: Float32Array[] = [];
  private activeCount: number;

  constructor(private opts: ManagedLineSetOptions) {
    this.activeCount = opts.maxLines;

    for (let i = 0; i < opts.maxLines; i++) {
      const positions = new Float32Array(opts.maxPointsPerLine * 3);
      const geom = new THREE.BufferGeometry();
      const attr = new THREE.BufferAttribute(positions, 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute('position', attr);
      geom.setDrawRange(0, 0);

      const line = new THREE.Line(geom, opts.material);
      line.frustumCulled = false;

      this.positionArrays.push(positions);
      this.geometries.push(geom);
      this.lines.push(line);
      opts.parent.add(line);
    }
  }

  /** Update positions for a specific line. positions should contain pointCount*3 floats (x,y,z). */
  updateLine(index: number, positions: Float32Array, pointCount: number): void {
    if (index >= this.opts.maxLines) return;
    const arr = this.positionArrays[index];
    // Copy only the needed portion
    arr.set(positions.subarray(0, pointCount * 3));
    const attr = this.geometries[index].getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.geometries[index].setDrawRange(0, pointCount);
  }

  /** Set how many lines are visible (hides unused via draw range 0). */
  setLineCount(count: number): void {
    this.activeCount = count;
    for (let i = 0; i < this.opts.maxLines; i++) {
      if (i >= count) {
        this.geometries[i].setDrawRange(0, 0);
      }
    }
  }

  /** Update shared material uniform. */
  setUniform(name: string, value: unknown): void {
    const mat = this.opts.material as THREE.ShaderMaterial;
    if (mat.uniforms && mat.uniforms[name]) {
      mat.uniforms[name].value = value;
    }
  }

  /** Get the underlying Line object at index (for setting renderOrder etc.). */
  getLine(index: number): THREE.Line | undefined {
    return this.lines[index];
  }

  /** Get the positions Float32Array at index (for reading back positions). */
  getPositions(index: number): Float32Array | undefined {
    return this.positionArrays[index];
  }

  dispose(): void {
    for (let i = 0; i < this.opts.maxLines; i++) {
      this.opts.parent.remove(this.lines[i]);
      this.geometries[i].dispose();
    }
    this.lines.length = 0;
    this.geometries.length = 0;
    this.positionArrays.length = 0;
  }
}

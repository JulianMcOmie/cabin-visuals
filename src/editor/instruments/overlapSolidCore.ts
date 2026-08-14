// Pure math for the Overlap Solid instrument - the 3D sibling of Overlap Shape.
// Same idea lifted into volume: a solid renders one flat color, and wherever a
// surface fragment sits INSIDE an odd number of the track's other copies, the
// parity rule fires - the fragment is discarded (a true see-through window
// shaped like the intersection's silhouette) or flipped to the overlap color.
// Two coincident solids vanish entirely, three come back: the same even/odd
// contract as the 2D instrument, decided by volume containment instead of
// screen-space coverage.
//
// Where the 2D recipe used the stencil buffer (screen-space coverage parity),
// this one is per-fragment geometry: the shader receives every sibling copy's
// INVERSE world transform (packed into a float texture, three RGBA texels per
// copy - the three rows of the affine inverse) and runs an exact point-in-solid
// test in each sibling's local space. Exact containment needs analytic solids,
// which is why the vocabulary is spheres/boxes/cylinders/cones/tori rather than
// arbitrary meshes - and why, unlike the 2D instrument, only copies of the SAME
// track interact (the shader only knows its own track's copies).
//
// overlapSolidCore.test.ts pins the option list against the GLSL dispatch so a
// new solid cannot land in one and not the other.

export interface OverlapSolidOption {
  value: number
  label: string
  /** Segmented-control caption. */
  short: string
}

export const OVERLAP_SOLID_OPTIONS: readonly OverlapSolidOption[] = [
  { value: 0, label: 'Sphere', short: 'SPH' },
  { value: 1, label: 'Cube', short: 'CUBE' },
  { value: 2, label: 'Cylinder', short: 'CYL' },
  { value: 3, label: 'Cone', short: 'CONE' },
  { value: 4, label: 'Torus', short: 'TOR' },
]

/** A param value (possibly automated off-grid) to a valid solid index. */
export function overlapSolidIndex(value: number): number {
  const i = Math.round(value)
  return Math.max(0, Math.min(OVERLAP_SOLID_OPTIONS.length - 1, Number.isFinite(i) ? i : 0))
}

/** Mesh scale: SIZE swelled by the shared note-pulse energy (same contract as
 *  the 2D shape - the geometry is authored at unit radius). */
export function overlapSolidScale(size: number, energy: number, pulse: number): number {
  return Math.max(0.0001, size) * (1 + energy * pulse)
}

/** Torus proportions, shared by the geometry and the containment test. */
export const OVERLAP_SOLID_TORUS_RADIUS = 0.7
export const OVERLAP_SOLID_TORUS_TUBE = 0.3

/** Copies beyond this many are ignored as CARVERS (they still render). Three
 *  RGBA32F texels per copy keeps the texture tiny either way; the cap only
 *  bounds the shader loop. */
export const OVERLAP_SOLID_MAX_SIBLINGS = 256

/**
 * Point-in-solid, in the solid's own unit-sized local space. `uShape` selects
 * the test; the cases MUST cover every OVERLAP_SOLID_OPTIONS value (the
 * colocated test greps for each marker). All solids are authored to unit
 * radius/half-extent so one SIZE knob scales them all identically.
 */
export const OVERLAP_SOLID_CONTAINS_GLSL = /* glsl */ `
bool solidContains(int shape, vec3 p) {
  if (shape == 0) { // sphere
    return dot(p, p) < 1.0;
  } else if (shape == 1) { // cube
    return all(lessThan(abs(p), vec3(1.0)));
  } else if (shape == 2) { // cylinder
    return abs(p.y) < 1.0 && dot(p.xz, p.xz) < 1.0;
  } else if (shape == 3) { // cone (apex up, unit base circle at y = -1)
    float t = (1.0 - p.y) * 0.5; // 1 at the base, 0 at the apex
    return abs(p.y) < 1.0 && dot(p.xz, p.xz) < t * t;
  } else { // torus (three's TorusGeometry lies in the XY plane)
    vec2 q = vec2(length(p.xy) - ${OVERLAP_SOLID_TORUS_RADIUS.toFixed(4)}, p.z);
    return dot(q, q) < ${(OVERLAP_SOLID_TORUS_TUBE * OVERLAP_SOLID_TORUS_TUBE).toFixed(4)};
  }
}
`

/**
 * Pack an affine matrix's INVERSE-ready rows into a float texture: three RGBA
 * texels per copy = the first three rows of a column-major three.js Matrix4's
 * elements, read back as row vectors so the shader transforms a point with
 * three dot products. Row r of copy i lands at texel (i * 3 + r).
 */
export function packAffineRows(elements: ArrayLike<number>, out: Float32Array, copyIndex: number): void {
  const base = copyIndex * 12
  for (let row = 0; row < 3; row++) {
    out[base + row * 4 + 0] = elements[0 + row]
    out[base + row * 4 + 1] = elements[4 + row]
    out[base + row * 4 + 2] = elements[8 + row]
    out[base + row * 4 + 3] = elements[12 + row]
  }
}

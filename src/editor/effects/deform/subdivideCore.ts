// Midpoint triangle subdivision, as pure array maths so it can be tested without
// a GPU or a three scene.
//
// Why a deformer needs this at all: `<boxGeometry args={[1.6, 1.6, 1.6]} />` -
// what the Cube instrument draws - has EIGHT vertices. A vertex shader can only
// move the vertices it is given, so a twist applied to that box shears its eight
// corners and leaves the faces flat between them; the object looks skewed rather
// than twisted. Every classic deformer silently assumes a tessellated mesh, and
// saying so in the panel is not a substitute for supplying one.
//
// Each triangle becomes four by splitting its three edges at their midpoints.
// Attributes ride along by linear interpolation, which is exactly right for
// positions and uvs, and right for normals within a flat face (a box's face
// normals are constant, so the split vertices inherit them unchanged). The
// deform re-derives normals in the shader anyway, so any error here is transient.

export interface SubdivisionAttribute {
  /** Flat, non-indexed, `itemSize` floats per vertex, 3 vertices per triangle. */
  array: Float32Array
  itemSize: number
}

/** Above this the subdivision stops early rather than producing a mesh that
 *  costs more to draw than the rest of the frame. A level-4 box is 9,216
 *  vertices; the cap only bites on geometry that was already dense. */
export const MAX_SUBDIVIDED_VERTICES = 200_000

/** How many vertices `levels` of subdivision would produce. Each level
 *  quadruples the triangle count. */
export function subdividedVertexCount(vertexCount: number, levels: number): number {
  return vertexCount * Math.pow(4, Math.max(0, levels))
}

/**
 * `levels` rounds of midpoint subdivision applied to every attribute in step, so
 * the returned arrays stay vertex-aligned with each other.
 *
 * Returns the inputs untouched when there is nothing to do (level 0, an empty
 * mesh, or a vertex count that is not a whole number of triangles) - a caller
 * can therefore always use the result and never has to special-case.
 */
export function subdivideAttributes(
  attributes: SubdivisionAttribute[],
  levels: number,
): SubdivisionAttribute[] {
  const rounds = Math.max(0, Math.round(levels))
  if (rounds === 0 || attributes.length === 0) return attributes
  const vertexCount = attributes[0].array.length / attributes[0].itemSize
  if (vertexCount < 3 || vertexCount % 3 !== 0) return attributes

  let current = attributes
  let count = vertexCount
  for (let round = 0; round < rounds; round++) {
    if (subdividedVertexCount(count, 1) > MAX_SUBDIVIDED_VERTICES) break
    current = current.map((attr) => ({ itemSize: attr.itemSize, array: subdivideOnce(attr) }))
    count *= 4
  }
  return current
}

/** One round: triangle (a, b, c) becomes (a, ab, ca), (ab, b, bc), (ca, bc, c),
 *  (ab, bc, ca) - the middle triangle keeps the winding of the original, so
 *  face orientation survives every level. */
function subdivideOnce({ array, itemSize }: SubdivisionAttribute): Float32Array {
  const triangles = array.length / (itemSize * 3)
  const out = new Float32Array(triangles * 4 * 3 * itemSize)
  let write = 0

  const a: number[] = new Array(itemSize)
  const b: number[] = new Array(itemSize)
  const c: number[] = new Array(itemSize)
  const ab: number[] = new Array(itemSize)
  const bc: number[] = new Array(itemSize)
  const ca: number[] = new Array(itemSize)

  const emit = (v: number[]) => {
    for (let i = 0; i < itemSize; i++) out[write++] = v[i]
  }

  for (let t = 0; t < triangles; t++) {
    const base = t * itemSize * 3
    for (let i = 0; i < itemSize; i++) {
      a[i] = array[base + i]
      b[i] = array[base + itemSize + i]
      c[i] = array[base + itemSize * 2 + i]
      ab[i] = (a[i] + b[i]) * 0.5
      bc[i] = (b[i] + c[i]) * 0.5
      ca[i] = (c[i] + a[i]) * 0.5
    }
    emit(a); emit(ab); emit(ca)
    emit(ab); emit(b); emit(bc)
    emit(ca); emit(bc); emit(c)
    emit(ab); emit(bc); emit(ca)
  }
  return out
}

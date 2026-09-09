import { BufferGeometry, Color, Float32BufferAttribute } from 'three'
import type { UndertaleSprite } from './undertaleSprites'

/** Build a closed pixel silhouette. Only exposed walls are emitted; adjacent
 * cells share a solid interior instead of hundreds of overlapping boxes. */
export function createUndertaleGeometry(sprite: UndertaleSprite): BufferGeometry {
  const height = sprite.rows.length
  const width = Math.max(...sprite.rows.map(row => row.length))
  const pixel = 2.4 / height
  const positions: number[] = [], colors: number[] = [], normals: number[] = []
  const ink = new Color()
  const occupied = (x: number, y: number) => {
    const cell = sprite.rows[y]?.[x]
    return cell !== undefined && cell !== '.' && sprite.palette[cell] !== undefined
  }
  const face = (corners: number[][], normal: number[], shade: number) => {
    for (const index of [0, 1, 2, 0, 2, 3]) {
      positions.push(...corners[index])
      normals.push(...normal)
      colors.push(ink.r * shade, ink.g * shade, ink.b * shade)
    }
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!occupied(x, y)) continue
    ink.set(sprite.palette[sprite.rows[y][x]])
    const left = (x - width / 2) * pixel, right = left + pixel
    const top = (height / 2 - y) * pixel, bottom = top - pixel
    const front = 0.5, back = -0.5 // Actual thickness is a mesh-local Z scale.
    face([[left,bottom,front],[right,bottom,front],[right,top,front],[left,top,front]], [0,0,1], 1)
    face([[right,bottom,back],[left,bottom,back],[left,top,back],[right,top,back]], [0,0,-1], 0.85)
    if (!occupied(x - 1,y)) face([[left,bottom,back],[left,bottom,front],[left,top,front],[left,top,back]], [-1,0,0], 0.6)
    if (!occupied(x + 1,y)) face([[right,bottom,front],[right,bottom,back],[right,top,back],[right,top,front]], [1,0,0], 0.7)
    if (!occupied(x,y - 1)) face([[left,top,front],[right,top,front],[right,top,back],[left,top,back]], [0,1,0], 0.9)
    if (!occupied(x,y + 1)) face([[left,bottom,back],[right,bottom,back],[right,bottom,front],[left,bottom,front]], [0,-1,0], 0.5)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

import type { Object3D, Mesh, ShaderMaterial } from 'three'

// Dev-only tripwire for the pause invariant: when the transport is paused and
// the playhead hasn't moved, the rendered scene must not change AT ALL - every
// instrument is a pure function of the beat. The lint bans make violations hard
// to write; this catches whatever creative path slips through (a smuggled clock,
// an accumulating ref) by hashing the scene while paused and naming the objects
// that moved.
//
// Sampled every 15th static frame, dev builds only - zero cost in production.

const SAMPLE_EVERY = 15

export class PauseCanary {
  private lastBeat: number | null = null
  private lastEditStamp: unknown = null
  private staticFrames = 0
  private lastHashes: Map<string, number> | null = null
  private warned = false

  /** Call once per frame (after computeAtBeat). Resets whenever time moves OR
   *  the project is edited (`editStamp` = the immutable project state ref) -
   *  an edit while paused legitimately changes the scene; only change with NO
   *  cause (time static, document untouched) is a violation. */
  check(scene: Object3D, beat: number, isPlaying: boolean, editStamp: unknown) {
    if (isPlaying || beat !== this.lastBeat || editStamp !== this.lastEditStamp) {
      this.lastBeat = beat
      this.lastEditStamp = editStamp
      this.staticFrames = 0
      this.lastHashes = null
      this.warned = false
      return
    }
    this.staticFrames++
    if (this.staticFrames % SAMPLE_EVERY !== 0) return
    const hashes = hashObjects(scene)
    if (this.lastHashes && !this.warned) {
      const movers: string[] = []
      for (const [key, h] of hashes) {
        if (this.lastHashes.has(key) && this.lastHashes.get(key) !== h) movers.push(key)
      }
      if (hashes.size !== this.lastHashes.size) {
        const added = [...hashes.keys()].filter((k) => !this.lastHashes!.has(k))
        const removed = [...this.lastHashes.keys()].filter((k) => !hashes.has(k))
        movers.push(`(added: ${added.slice(0, 5).join(', ') || '-'} | removed: ${removed.slice(0, 5).join(', ') || '-'})`)
      }
      if (movers.length) {
        console.warn(
          '[pause-canary] Scene changed while paused at a static playhead - these are not pure functions of the beat:\n  ' +
            movers.slice(0, 12).join('\n  ') +
            '\nHunt for wall-clock time, per-frame randomness, or an accumulating ref.',
        )
        this.warned = true // once per pause, not 4x/second
      }
    }
    this.lastHashes = hashes
  }
}

/** A stable-ish label for an offender: name if set, else type + uuid prefix. */
function label(o: Object3D): string {
  return o.name ? `${o.type} "${o.name}"` : `${o.type} ${o.uuid.slice(0, 8)}`
}

// Cheap per-object structural hash: world transform, visibility, material
// opacity/color, shader uniforms, and a strided sample of geometry positions
// (catches batched line/point writers, not just moved meshes). Floats are mixed
// at 1e-3 fixed precision so denormal jitter doesn't false-positive.
function hashObjects(root: Object3D): Map<string, number> {
  const out = new Map<string, number>()
  root.traverse((o) => {
    let h = 0
    const mix = (v: number) => {
      h = (h * 31 + ((v * 1000) | 0)) | 0
    }
    const e = o.matrixWorld.elements
    for (let i = 0; i < 16; i++) mix(e[i])
    mix(o.visible ? 1 : 0)

    const mesh = o as Mesh
    const mat = mesh.material as ShaderMaterial | undefined
    if (mat) {
      if (typeof mat.opacity === 'number') mix(mat.opacity)
      const color = (mat as unknown as { color?: { r: number; g: number; b: number } }).color
      if (color) { mix(color.r); mix(color.g); mix(color.b) }
      if (mat.uniforms) {
        for (const key in mat.uniforms) {
          const v = mat.uniforms[key]?.value
          if (typeof v === 'number') mix(v)
        }
      }
    }

    const geo = mesh.geometry
    if (geo) {
      mix(geo.drawRange.count === Infinity ? -1 : geo.drawRange.count)
      const pos = geo.getAttribute?.('position')
      if (pos) {
        const arr = pos.array as ArrayLike<number>
        const limit = geo.drawRange.count === Infinity ? arr.length : Math.min(arr.length, geo.drawRange.count * 3)
        for (let i = 0; i < limit; i += 64) mix(arr[i])
        if (limit > 0) mix(arr[limit - 1])
      }
    }
    out.set(label(o), h)
  })
  return out
}

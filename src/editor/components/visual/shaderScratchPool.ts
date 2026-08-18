import { LinearFilter, WebGLRenderTarget } from 'three'

/**
 * Scratch render targets shared by every mounted ShaderWrapper.
 *
 * A wrapper's pass chain runs to completion inside its own useFrame - source
 * rasterization, then each fullscreen pass - and only its FINAL texture is
 * read later (by its overlay mesh, during the scene render). So the source
 * target and the ping-pong intermediates are dead the moment the chain ends,
 * and one set can serve every wrapper in turn; only the last pass's output
 * needs a target the wrapper owns. Under a splitter (16 copies × 3 targets
 * each) that is the difference between 48 full-canvas targets and 16 + 3.
 *
 * Keyed by size so a resize (or a preview-quality change) hands out a fresh
 * set while the old one drains; a set is disposed when its last holder lets go.
 */
export interface ShaderScratch {
  /** Where the object's real geometry rasterizes when at least one pass runs,
   *  so it carries a stencil buffer (Overlap Shape's parity passes need one
   *  wherever the meshes draw). */
  src: WebGLRenderTarget
  /** Intermediate pass outputs; only ever receive fullscreen quads. */
  ping: WebGLRenderTarget
  pong: WebGLRenderTarget
}

interface PoolEntry extends ShaderScratch {
  refs: number
}

const pool = new Map<string, PoolEntry>()

const keyOf = (width: number, height: number) => `${width}x${height}`

export function acquireShaderScratch(width: number, height: number): ShaderScratch {
  const key = keyOf(width, height)
  let entry = pool.get(key)
  if (!entry) {
    const opts = { minFilter: LinearFilter, magFilter: LinearFilter }
    entry = {
      src: new WebGLRenderTarget(width, height, { ...opts, stencilBuffer: true }),
      ping: new WebGLRenderTarget(width, height, opts),
      pong: new WebGLRenderTarget(width, height, opts),
      refs: 0,
    }
    pool.set(key, entry)
  }
  entry.refs++
  return entry
}

export function releaseShaderScratch(scratch: ShaderScratch): void {
  const key = keyOf(scratch.src.width, scratch.src.height)
  const entry = pool.get(key)
  if (!entry || entry !== scratch) return
  entry.refs--
  if (entry.refs > 0) return
  pool.delete(key)
  entry.src.dispose(); entry.ping.dispose(); entry.pong.dispose()
}

/** Test/diagnostic hook: how many distinct-size scratch sets are alive. */
export function shaderScratchPoolSize(): number {
  return pool.size
}

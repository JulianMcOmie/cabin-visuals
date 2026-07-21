import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial, SRGBColorSpace } from 'three'

/**
 * Canvas-to-viewport-plane plumbing for full-frame canvas instruments, plus
 * the repaint skip that keeps them affordable.
 *
 * A full-frame canvas instrument pays a CPU rasterization of the WHOLE canvas
 * and a multi-megabyte texture upload every time it paints. Its
 * useInstrumentFrame callback runs on every beat change, so at 60fps playback
 * (and once per exported frame) it would pay that cost continuously - even
 * when the content only advances at film cadence and the frame it is about to
 * paint is pixel-identical to the one already on the canvas.
 *
 * `unchanged(key, notes)` lets a callback declare what its frame is a function
 * of. When the key AND the note list both match the last painted frame, the
 * caller returns early: no rasterization, no upload. Stacking three of these
 * instruments (the Silent Film template) is what made the skip necessary.
 *
 * The key MUST cover every input the paint reads - quantized time, each param
 * it touches, the canvas size. Miss one and edits to it silently do nothing:
 * the frame signature is already committed by the time the callback runs, so a
 * wrongly-skipped paint is never retried (the same trap the useInstrumentFrame
 * `false` contract exists for). `notes` is passed separately because the
 * engine hands out a stable array reference per resolve - reference equality
 * is the cheap, correct test for "the MIDI changed".
 */
export function useFullFrameCanvas(texHeight: number) {
  const { viewport } = useThree()
  const meshRef = useRef<Mesh>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textureRef = useRef<CanvasTexture | null>(null)
  const lastKeyRef = useRef('')
  const lastNotesRef = useRef<unknown>(null)

  // Canvas matches the visual window's aspect, quantized so a resize drag
  // doesn't mint a new canvas every pixel (CrtScanlines' scheme).
  const aspect = viewport.height > 0 ? viewport.width / viewport.height : 1
  const texW = Math.max(256, Math.min(2048, Math.round((texHeight * aspect) / 64) * 64))

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = texW
    canvas.height = texHeight
    canvasRef.current = canvas

    const texture = new CanvasTexture(canvas)
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    // The canvas paints sRGB values; without this the sampler reads them as
    // linear and the whole frame lifts to washed-out grey.
    texture.colorSpace = SRGBColorSpace
    textureRef.current = texture

    // A fresh canvas is blank, so nothing may be skipped against the key that
    // described the OLD one.
    lastKeyRef.current = ''
    return () => texture.dispose()
  }, [texW, texHeight])

  /** True when the frame about to be painted is the one already on the canvas.
   *  Records the new key as a side effect, so callers just `if (...) return`. */
  const unchanged = (key: string, notes: unknown): boolean => {
    if (key === lastKeyRef.current && notes === lastNotesRef.current) return true
    lastKeyRef.current = key
    lastNotesRef.current = notes
    return false
  }

  /** Force the next frame to repaint (used when the plane goes invisible - the
   *  canvas it comes back to may be stale). */
  const invalidate = () => { lastKeyRef.current = '' }

  return { viewport, meshRef, canvasRef, textureRef, unchanged, invalidate }
}

/** Flag the upload and (re)bind the texture after a canvas recreation. */
export function commitCanvasFrame(mesh: Mesh, texture: CanvasTexture): void {
  texture.needsUpdate = true
  const material = mesh.material as MeshBasicMaterial
  if (material.map !== texture) {
    material.map = texture
    material.needsUpdate = true
  }
}

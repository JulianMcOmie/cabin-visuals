'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Mesh, MeshBasicMaterial, SRGBColorSpace, LinearFilter, TextureLoader, type Texture } from 'three'
import { useThree } from '@react-three/fiber'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { getObjectState } from '../core/visual/VisualEngine'
import { activePhotoAt, PHOTO_BASE_PITCH } from '../core/photo/photoTime'
import { getPhotoPlayableUrl } from '../core/photo/photoSource'
import { registerFramePreparer } from '../core/export/exportEngine'
import { paramDefault, type ObjectInstrumentDef } from './types'

// The Photo instrument: an ordered bank of the user's own photos, cut by MIDI.
// A note-on selects photo (pitch - PHOTO_BASE_PITCH) mod photoCount and shows
// it full-frame; the photo latches until the next note-on, bounded by its
// block (block-gated visibility). It is the Video instrument minus a timeline:
// a still image has no seeking, no clip time, no decode engine - just a texture.
//
// Pause invariant: the frame at a beat is f(beat, notes). The active photo is
// derived purely (activePhotoAt); the plane draws exactly that texture. A photo
// loads once per ref into a module cache; while paused, a load arrival redraws
// the last request (the frame callback is skip-gated and won't re-fire itself).

// One texture per ref, shared across every Photo track and the export preparer.
// A photo's bytes never change, so a loaded texture is reusable forever this
// session; the promise dedupes concurrent loads of the same ref.
interface CacheEntry {
  texture: Texture | null
  promise: Promise<Texture | null>
}
const textureCache = new Map<string, CacheEntry>()

/** Load (or reuse) the texture for a ref. The returned promise resolves to the
 *  texture, or null if the bytes could not be loaded. */
function loadPhotoTexture(ref: string): Promise<Texture | null> {
  const existing = textureCache.get(ref)
  if (existing) return existing.promise
  const promise = (async (): Promise<Texture | null> => {
    try {
      const url = await getPhotoPlayableUrl(ref)
      const texture = await new TextureLoader().loadAsync(url)
      texture.colorSpace = SRGBColorSpace
      texture.minFilter = LinearFilter
      texture.magFilter = LinearFilter
      texture.generateMipmaps = false
      const entry = textureCache.get(ref)
      if (entry) entry.texture = texture
      return texture
    } catch (err) {
      console.error('Photo failed to load', ref, err)
      textureCache.delete(ref) // let a later attempt retry
      return null
    }
  })()
  textureCache.set(ref, { texture: null, promise })
  return promise
}

/** The texture for a ref if it is already loaded, else null (kicks off a load). */
function cachedPhotoTexture(ref: string): Texture | null {
  const entry = textureCache.get(ref)
  if (entry) return entry.texture
  void loadPhotoTexture(ref)
  return null
}

function PhotoComponent({ trackId }: { trackId: string }) {
  const meshRef = useRef<Mesh>(null)
  const invalidate = useThree((s) => s.invalidate)
  const viewport = useThree((s) => s.viewport)

  // The ref wanted by the last frame, so an async texture arrival while paused
  // can apply it without the skip-gated frame callback re-running.
  const wantRef = useRef<string | null>(null)

  const material = useMemo(
    // Backdrop, not occluder: depthWrite off so 3D objects draw in front.
    () => new MeshBasicMaterial({ toneMapped: false, depthWrite: false, transparent: false }),
    [],
  )

  useEffect(() => {
    return () => {
      material.dispose()
    }
  }, [material])

  // Point the plane at `texture`, scaled to restore the photo's true aspect.
  // Cover (default) crops the overflowing axis; Fit letterboxes inside the frame.
  const applyTexture = (texture: Texture, cover: boolean) => {
    const mesh = meshRef.current
    if (!mesh) return
    if (material.map !== texture) {
      material.map = texture
      material.needsUpdate = true
    }
    const img = texture.image as { width?: number; height?: number } | undefined
    const photoAspect = img && img.width && img.height ? img.width / img.height : 16 / 9
    const viewAspect = viewport.height > 0 ? viewport.width / viewport.height : 16 / 9
    let sx = 1
    let sy = 1
    if (cover ? photoAspect > viewAspect : photoAspect < viewAspect) sx = photoAspect / viewAspect
    else sy = viewAspect / photoAspect
    if (!cover) {
      const shrink = 1 / Math.max(sx, sy)
      sx *= shrink
      sy *= shrink
    }
    mesh.scale.set(sx, sy, 1)
    mesh.visible = true
  }

  // A texture finished loading while paused: apply it if it is still wanted, so
  // the new photo reaches the screen (playback's own loop handles the live case).
  const settleLoad = (ref: string, cover: boolean) => {
    void loadPhotoTexture(ref).then((texture) => {
      if (wantRef.current !== ref || !texture) return
      applyTexture(texture, cover)
      invalidate()
    })
  }

  // Export: ensure the active photo's texture is loaded before its frame renders
  // (load once, no per-frame work). The frame callback then applies it synchronously.
  useEffect(() => {
    return registerFramePreparer(async (beat) => {
      const st = getObjectState(trackId)
      const pads = st?.photoPads
      if (!st || !pads || pads.length === 0) return
      const active = activePhotoAt(st.notes, beat, PHOTO_BASE_PITCH, pads.length)
      if (!active) return
      await loadPhotoTexture(pads[active.photoIndex].ref)
    })
  }, [trackId])

  useInstrumentFrame(trackId, (state) => {
    const mesh = meshRef.current
    if (!mesh) return
    const pads = state.photoPads ?? []
    const active = state.blackedOut ? null : activePhotoAt(state.notes, state.beat, PHOTO_BASE_PITCH, pads.length)
    const ref = active ? pads[active.photoIndex].ref : null
    wantRef.current = ref

    if (!ref) {
      mesh.visible = false
      return
    }
    const cover = (state.params.fit ?? paramDefault(photoInstrument, 'fit')) === 0
    const texture = cachedPhotoTexture(ref)
    if (texture) {
      applyTexture(texture, cover)
    } else {
      // Not loaded yet: show nothing this frame, apply when it arrives.
      mesh.visible = false
      settleLoad(ref, cover)
    }
  })

  return (
    <mesh ref={meshRef} material={material} visible={false}>
      <planeGeometry args={[viewport.width, viewport.height]} />
    </mesh>
  )
}

export const photoInstrument: ObjectInstrumentDef = {
  id: 'photo',
  name: 'Photo',
  kind: 'object',
  params: [
    {
      key: 'fit',
      label: 'Fit',
      type: 'select' as const,
      options: [
        { value: 0, label: 'Cover (fill, crop edges)' },
        { value: 1, label: 'Fit (letterbox)' },
      ],
      default: 0,
    },
  ],
  // The Photo track's MIDI editor shows only its photo rows (generatePhotoRows).
  // A full-frame layer: the renderer pins it dead-ahead of the camera, parallel
  // to it, so the photo reads as a screen - never a tilted plane in space.
  fullFrame: true,
  component: PhotoComponent,
}

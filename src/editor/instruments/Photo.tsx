'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Mesh, ShaderMaterial, SRGBColorSpace, LinearFilter, TextureLoader, Vector2, type Texture } from 'three'
import { useThree } from '@react-three/fiber'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { getObjectState } from '../core/visual/VisualEngine'
import { photoTransitionAt, PHOTO_BASE_PITCH } from '../core/photo/photoTime'
import { getPhotoPlayableUrl } from '../core/photo/photoSource'
import { registerFramePreparer } from '../core/export/exportEngine'
import { paramDefault, type ObjectInstrumentDef } from './types'

// The Photo instrument: an ordered bank of the user's own photos, cut by MIDI.
// A note-on selects photo (pitch - PHOTO_BASE_PITCH) mod photoCount and shows
// it full-frame; the photo latches until the next note-on, bounded by its
// block (block-gated visibility). It is the Video instrument minus a timeline:
// a still image has no seeking, no clip time, no decode engine - just a texture.
//
// Between photos it can blend rather than hard-cut: a crossfade, fade-through-
// black, slide/push, wipe, or zoom. The two photos and the blend amount all
// come from photoTransitionAt(beat, notes) - a pure function - so the shader is
// just a viewport-sized plane sampling `from` and `to` at a beat-derived
// progress. Cut (the default) is the same path with progress pinned to 1.
//
// Pause invariant: the frame at a beat is f(beat, notes). A photo loads once
// per ref into a module cache; while paused, a load arrival redraws the last
// request (the frame callback is skip-gated and won't re-fire itself).

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

// Transition modes, matched to the `transition` param's option values. Kept in
// one place so the param list and the shader agree.
const MODE_CUT = 0
const MODE_CROSSFADE = 1
const MODE_FADE_BLACK = 2
const MODE_SLIDE = 3
const MODE_WIPE = 4
const MODE_ZOOM = 5
const MODE_BOUNCE = 6

// UV multiplier on (uv - 0.5) that fits `photoAspect` into `viewAspect`. Cover
// crops the overflowing axis (scale < 1 on that axis); Fit letterboxes, reading
// past [0,1] on the padded axis so the shader can paint those pixels black.
function uvScaleFor(photoAspect: number, viewAspect: number, cover: boolean): [number, number] {
  const wide = photoAspect > viewAspect
  if (cover) return wide ? [viewAspect / photoAspect, 1] : [1, photoAspect / viewAspect]
  return wide ? [1, photoAspect / viewAspect] : [viewAspect / photoAspect, 1]
}

function textureAspect(texture: Texture | null): number {
  const img = texture?.image as { width?: number; height?: number } | undefined
  return img && img.width && img.height ? img.width / img.height : 16 / 9
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// Two samplers, one beat-derived progress, one branch per transition mode.
// Every mode lands on `to` at progress 1, so a hard cut needs no special case.
// Aspect is applied per texture via uScale* so the two photos can differ.
const FRAGMENT = /* glsl */ `
  precision highp float;
  uniform sampler2D uFrom;
  uniform sampler2D uTo;
  uniform float uProgress;
  uniform float uMode;
  uniform float uHasFrom;
  uniform vec2 uScaleFrom;
  uniform vec2 uScaleTo;
  varying vec2 vUv;

  // Sample tex at plane coord uv, applying aspect scaling; outside the image
  // (letterbox padding) returns black.
  vec3 samp(sampler2D tex, vec2 uv, vec2 scale) {
    vec2 t = (uv - 0.5) * scale + 0.5;
    if (t.x < 0.0 || t.x > 1.0 || t.y < 0.0 || t.y > 1.0) return vec3(0.0);
    return texture2D(tex, t).rgb;
  }

  // Whether a plane coord falls within the [0,1] image rect after aspect scaling
  // (false in the letterbox padding). Lets a mode composite one photo over the
  // other only where the top one actually has pixels.
  bool inside(vec2 uv, vec2 scale) {
    vec2 t = (uv - 0.5) * scale + 0.5;
    return t.x >= 0.0 && t.x <= 1.0 && t.y >= 0.0 && t.y <= 1.0;
  }

  // Penner ease-out-bounce: 0..1 that overshoots and settles with a few bounces.
  float bounceOut(float t) {
    float n = 7.5625;
    float d = 2.75;
    if (t < 1.0 / d) return n * t * t;
    if (t < 2.0 / d) { t -= 1.5 / d; return n * t * t + 0.75; }
    if (t < 2.5 / d) { t -= 2.25 / d; return n * t * t + 0.9375; }
    t -= 2.625 / d; return n * t * t + 0.984375;
  }

  void main() {
    float p = clamp(uProgress, 0.0, 1.0);
    int mode = int(uMode + 0.5);
    vec3 toCol = samp(uTo, vUv, uScaleTo);
    vec3 fromCol = uHasFrom > 0.5 ? samp(uFrom, vUv, uScaleFrom) : vec3(0.0);
    vec3 col;

    if (mode == 1) {              // crossfade / dissolve
      col = mix(fromCol, toCol, p);
    } else if (mode == 2) {       // fade through black
      col = p < 0.5 ? fromCol * (1.0 - p * 2.0) : toCol * ((p - 0.5) * 2.0);
    } else if (mode == 3) {       // slide / push (left)
      float b = 1.0 - p;
      col = vUv.x < b
        ? samp(uFrom, vec2(vUv.x + p, vUv.y), uScaleFrom)
        : samp(uTo, vec2(vUv.x - b, vUv.y), uScaleTo);
    } else if (mode == 4) {       // wipe (left to right, soft edge)
      float edge = smoothstep(p - 0.04, p + 0.04, vUv.x);
      col = mix(toCol, fromCol, edge);
    } else if (mode == 5) {       // zoom + crossfade
      float e = smoothstep(0.0, 1.0, p);
      vec3 zoomed = samp(uTo, (vUv - 0.5) * mix(1.6, 1.0, e) + 0.5, uScaleTo);
      col = mix(fromCol, zoomed, e);
    } else if (mode == 6) {       // bounce: the incoming photo drops from the top and settles
      float yoff = 1.0 - bounceOut(p);           // 1 = one screen above, 0 = at rest
      vec2 toUv = vec2(vUv.x, vUv.y - yoff);
      col = inside(toUv, uScaleTo) ? samp(uTo, toUv, uScaleTo) : fromCol;
    } else {                      // cut / fallback
      col = toCol;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`

function PhotoComponent({ trackId }: { trackId: string }) {
  const meshRef = useRef<Mesh>(null)
  const invalidate = useThree((s) => s.invalidate)
  const viewport = useThree((s) => s.viewport)

  // What the last frame wanted, so an async texture arrival while paused can
  // re-apply without the skip-gated frame callback re-running.
  const wantFrom = useRef<string | null>(null)
  const wantTo = useRef<string | null>(null)
  // The pad set already warmed, so a transition never lands on a cold texture
  // (which would flash black until it loaded). Re-warms if the bank changes.
  const preloadSig = useRef('')

  const material = useMemo(
    // Backdrop, not occluder: depthWrite off so 3D objects draw in front.
    () =>
      new ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        depthWrite: false,
        transparent: false,
        uniforms: {
          uFrom: { value: null as Texture | null },
          uTo: { value: null as Texture | null },
          uProgress: { value: 1 },
          uMode: { value: MODE_CUT },
          uHasFrom: { value: 0 },
          uScaleFrom: { value: new Vector2(1, 1) },
          uScaleTo: { value: new Vector2(1, 1) },
        },
      }),
    [],
  )

  useEffect(() => {
    return () => {
      material.dispose()
    }
  }, [material])

  const viewAspect = viewport.height > 0 ? viewport.width / viewport.height : 16 / 9

  // Drive the shader for one frame: point both samplers at the current photos,
  // set the aspect scales, mode, and blend. `toTex` must be loaded (there is
  // always a target); `fromTex` may be null (blend from black until it arrives).
  const applyTransition = (
    toTex: Texture,
    fromTex: Texture | null,
    cover: boolean,
    mode: number,
    progress: number,
  ) => {
    const mesh = meshRef.current
    if (!mesh) return
    const u = material.uniforms
    u.uTo.value = toTex
    u.uFrom.value = fromTex ?? toTex
    u.uHasFrom.value = fromTex ? 1 : 0
    u.uMode.value = mode
    u.uProgress.value = progress
    const [tsx, tsy] = uvScaleFor(textureAspect(toTex), viewAspect, cover)
    u.uScaleTo.value.set(tsx, tsy)
    const [fsx, fsy] = uvScaleFor(textureAspect(fromTex), viewAspect, cover)
    u.uScaleFrom.value.set(fsx, fsy)
    mesh.visible = true
  }

  // A texture finished loading while paused: re-derive and re-apply if the same
  // pair is still wanted (playback's own loop handles the live case).
  const settleLoad = (fromRef: string | null, toRef: string, cover: boolean, mode: number, progress: number) => {
    const wanted = () => wantFrom.current === fromRef && wantTo.current === toRef
    void loadPhotoTexture(toRef).then((toTex) => {
      if (!wanted() || !toTex) return
      const fromTex = fromRef ? cachedPhotoTexture(fromRef) : null
      applyTransition(toTex, fromTex, cover, mode, progress)
      invalidate()
    })
    if (fromRef) {
      void loadPhotoTexture(fromRef).then((fromTex) => {
        const toTex = cachedPhotoTexture(toRef)
        if (!wanted() || !toTex) return
        applyTransition(toTex, fromTex, cover, mode, progress)
        invalidate()
      })
    }
  }

  // Export: ensure both photos of the active transition are loaded before the
  // frame renders (load once, no per-frame work); the frame callback then
  // applies them synchronously.
  useEffect(() => {
    return registerFramePreparer(async (beat) => {
      const st = getObjectState(trackId)
      const pads = st?.photoPads
      if (!st || !pads || pads.length === 0) return
      const mode = st.params.transition ?? paramDefault(photoInstrument, 'transition')
      const trBeats = mode === MODE_CUT ? 0 : st.params.transitionBeats ?? paramDefault(photoInstrument, 'transitionBeats')
      const tr = photoTransitionAt(st.notes, beat, PHOTO_BASE_PITCH, pads.length, trBeats)
      if (!tr) return
      await loadPhotoTexture(pads[tr.toIndex].ref)
      if (tr.fromIndex !== null) await loadPhotoTexture(pads[tr.fromIndex].ref)
    })
  }, [trackId])

  useInstrumentFrame(trackId, (state) => {
    const mesh = meshRef.current
    if (!mesh) return false
    const pads = state.photoPads ?? []

    // Warm the whole bank the first time this track renders (and again if its
    // photos change), so a note-on never cuts to a texture that has to load -
    // that gap was the black flash before/at the transition.
    if (pads.length) {
      const sig = pads.map((p) => p.ref).join('|')
      if (preloadSig.current !== sig) {
        preloadSig.current = sig
        for (const pad of pads) void loadPhotoTexture(pad.ref)
      }
    }

    const mode = state.params.transition ?? paramDefault(photoInstrument, 'transition')
    const trBeats = mode === MODE_CUT ? 0 : state.params.transitionBeats ?? paramDefault(photoInstrument, 'transitionBeats')
    const tr = state.blackedOut
      ? null
      : photoTransitionAt(state.notes, state.beat, PHOTO_BASE_PITCH, pads.length, trBeats)

    const toRef = tr ? pads[tr.toIndex].ref : null
    const fromRef = tr && tr.fromIndex !== null ? pads[tr.fromIndex].ref : null
    wantTo.current = toRef
    wantFrom.current = fromRef

    if (!tr || !toRef) {
      mesh.visible = false
      return
    }
    const cover = (state.params.fit ?? paramDefault(photoInstrument, 'fit')) === 0
    const toTex = cachedPhotoTexture(toRef)
    const fromTex = fromRef ? cachedPhotoTexture(fromRef) : null

    if (!toTex) {
      // The incoming photo has not loaded yet. Rather than flash black, hold the
      // outgoing photo (if it is ready) full-frame until the target arrives; the
      // real blend snaps in once the load lands. Only a genuinely cold start
      // (neither photo ready) shows nothing.
      if (fromTex) applyTransition(fromTex, null, cover, MODE_CUT, 1)
      else mesh.visible = false
      settleLoad(fromRef, toRef, cover, mode, tr.progress)
      return
    }
    applyTransition(toTex, fromTex, cover, mode, tr.progress)
    // The outgoing photo is still loading: paint it in when it lands.
    if (fromRef && !fromTex) settleLoad(fromRef, toRef, cover, mode, tr.progress)
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
  userInterfaceRenderer: 'photo',
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
    {
      key: 'transition',
      label: 'Transition',
      type: 'select' as const,
      options: [
        { value: MODE_CUT, label: 'Cut (instant)' },
        { value: MODE_CROSSFADE, label: 'Crossfade' },
        { value: MODE_FADE_BLACK, label: 'Fade through black' },
        { value: MODE_SLIDE, label: 'Slide (push)' },
        { value: MODE_WIPE, label: 'Wipe' },
        { value: MODE_ZOOM, label: 'Zoom' },
        { value: MODE_BOUNCE, label: 'Bounce' },
      ],
      default: MODE_CUT,
    },
    {
      key: 'transitionBeats',
      label: 'Transition length',
      type: 'number' as const,
      min: 0.05,
      max: 4,
      step: 0.05,
      default: 0.5,
    },
  ],
  // The Photo track's MIDI editor shows only its photo rows (generatePhotoRows).
  // A full-frame layer: the renderer pins it dead-ahead of the camera, parallel
  // to it, so the photo reads as a screen - never a tilted plane in space.
  fullFrame: true,
  component: PhotoComponent,
}

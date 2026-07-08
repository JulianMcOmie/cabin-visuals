'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Mesh, MeshBasicMaterial, SRGBColorSpace, VideoTexture } from 'three'
import { useThree } from '@react-three/fiber'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { getObjectState } from '../core/visual/VisualEngine'
import { activeVideoAt, clipTimeAt, VIDEO_BASE_PITCH } from '../core/video/videoTime'
import { getPlayableVideoUrl } from '../core/video/videoSource'
import { registerFramePreparer } from '../core/export/exportEngine'
import { useVideoStore } from '../store/VideoStore'
import { useProjectStore } from '../store/ProjectStore'
import { useTimeStore } from '../store/TimeStore'
import { paramDefault, type ObjectInstrumentDef } from './types'

// The Video instrument: an ordered bank of the user's own clips, cut by MIDI.
// A note-on selects clip (pitch − VIDEO_BASE_PITCH) mod clipCount and restarts it; the
// clip latches until the next note-on, bounded by its block (see
// core/video/videoTime.ts — the pure time model everything here follows).
//
// The pause-invariant shape of this instrument: the frame shown at a beat is
// f(beat, notes). Live playback approximates it smoothly (the active <video>
// element plays natively, snapped back whenever it drifts past ~90ms); pause,
// scrub, and export enforce it exactly (pause + seek). Seeks land async, so
// 'seeked' asks the demand-mode loop for one frame.

const DRIFT_TOLERANCE_S = 0.09
const SEEK_EPSILON_S = 1 / 120

interface ClipRuntime {
  el: HTMLVideoElement
  texture: VideoTexture
}

function VideoComponent({ trackId }: { trackId: string }) {
  const meshRef = useRef<Mesh>(null)
  const invalidate = useThree((s) => s.invalidate)
  const viewport = useThree((s) => s.viewport)
  // The clip bank (element + texture per ref), rebuilt when the refs change.
  const runtimesRef = useRef<Map<string, ClipRuntime>>(new Map())
  const videoRefs = useProjectStore((s) => s.tracks[trackId]?.videoRefs)

  const material = useMemo(() => {
    // A backdrop, not an occluder: depthWrite off so 3D objects always draw in
    // front of the footage (the CrtScanlines/FractalTunnel screen pattern).
    const m = new MeshBasicMaterial({ toneMapped: false, depthWrite: false })
    return m
  }, [])

  // Element lifecycle: one warm, muted element per clip so cuts never wait on
  // the network. Async arrivals (metadata, completed seeks) each request one
  // frame — the render governor's demand mode needs the poke while paused.
  useEffect(() => {
    const runtimes = runtimesRef.current
    const wanted = new Set(videoRefs ?? [])
    for (const [ref, rt] of runtimes) {
      if (wanted.has(ref)) continue
      rt.el.pause()
      rt.el.removeAttribute('src')
      rt.texture.dispose()
      runtimes.delete(ref)
    }
    for (const ref of wanted) {
      if (runtimes.has(ref)) continue
      const el = document.createElement('video')
      el.muted = true
      el.playsInline = true
      el.preload = 'auto'
      el.crossOrigin = 'anonymous'
      el.addEventListener('loadeddata', () => invalidate())
      el.addEventListener('seeked', () => invalidate())
      void getPlayableVideoUrl(ref).then((url) => {
        el.src = url
        el.load()
      }).catch((err) => console.error('Video clip failed to load', ref, err))
      const texture = new VideoTexture(el)
      texture.colorSpace = SRGBColorSpace
      runtimes.set(ref, { el, texture })
    }
    return undefined
  }, [videoRefs, invalidate])

  // Full teardown on unmount only.
  useEffect(() => {
    const runtimes = runtimesRef.current
    return () => {
      for (const rt of runtimes.values()) {
        rt.el.pause()
        rt.el.removeAttribute('src')
        rt.texture.dispose()
      }
      runtimes.clear()
      material.dispose()
    }
  }, [material])

  // Transport pause must stop the elements even though the frozen beat means
  // the gated frame callback won't run again — a playing element under a
  // paused transport would violate the pause invariant on its own.
  useEffect(() => {
    const unsub = useTimeStore.subscribe((s, prev) => {
      if (prev.isPlaying && !s.isPlaying) {
        for (const rt of runtimesRef.current.values()) rt.el.pause()
      }
    })
    return unsub
  }, [])

  // Export: before each exported frame renders, seek the active element to the
  // exact beat-derived time and wait for the seek to land (frame-exact, where
  // live playback merely drift-corrects). Guarded by a timeout so one broken
  // element can never hang an export.
  useEffect(() => {
    return registerFramePreparer(async (beat) => {
      const st = getObjectState(trackId)
      const refs = st?.videoRefs
      if (!st || !refs || refs.length === 0) return
      const loop = (st.params.loop ?? paramDefault(videoInstrument, 'loop')) > 0
      const active = activeVideoAt(st.notes, beat, VIDEO_BASE_PITCH, refs.length)
      if (!active) return
      const ref = refs[active.clipIndex]
      const rt = runtimesRef.current.get(ref)
      if (!rt) return
      const duration = useVideoStore.getState().videoClips[ref]?.duration ?? rt.el.duration
      if (!duration || !isFinite(duration)) return
      const target = clipTimeAt(beat, active.noteBeat, st.secPerBeat, duration, loop)
      rt.el.pause()
      if (Math.abs(rt.el.currentTime - target) < SEEK_EPSILON_S) return
      await new Promise<void>((resolve) => {
        const timer = setTimeout(finish, 1000)
        function finish() {
          clearTimeout(timer)
          rt!.el.removeEventListener('seeked', finish)
          resolve()
        }
        rt.el.addEventListener('seeked', finish)
        rt.el.currentTime = target
      })
    })
  }, [trackId])

  useInstrumentFrame(trackId, (state) => {
    const mesh = meshRef.current
    if (!mesh) return
    const refs = state.videoRefs ?? []
    const loop = (state.params.loop ?? paramDefault(videoInstrument, 'loop')) > 0
    const active = state.blackedOut ? null : activeVideoAt(state.notes, state.beat, VIDEO_BASE_PITCH, refs.length)

    const activeRef = active ? refs[active.clipIndex] : null
    const runtimes = runtimesRef.current

    // Everyone but the active clip is paused.
    for (const [ref, rt] of runtimes) {
      if (ref !== activeRef && !rt.el.paused) rt.el.pause()
    }

    const rt = activeRef ? runtimes.get(activeRef) : undefined
    if (!active || !rt || rt.el.readyState < 2 /* HAVE_CURRENT_DATA */) {
      mesh.visible = false
      return
    }

    const meta = useVideoStore.getState().videoClips[activeRef!]
    const duration = meta?.duration ?? rt.el.duration
    if (!duration || !isFinite(duration)) {
      mesh.visible = false
      return
    }
    const target = clipTimeAt(state.beat, active.noteBeat, state.secPerBeat, duration, loop)

    rt.el.loop = loop
    if (useTimeStore.getState().isPlaying) {
      // Live: the element free-runs (smooth), the beat clock is the boss.
      if (rt.el.paused) void rt.el.play().catch(() => {})
      if (Math.abs(rt.el.currentTime - target) > DRIFT_TOLERANCE_S) rt.el.currentTime = target
    } else {
      // Paused / scrubbing / export: enforce the mapping exactly.
      if (!rt.el.paused) rt.el.pause()
      if (Math.abs(rt.el.currentTime - target) > SEEK_EPSILON_S) rt.el.currentTime = target
    }

    if (material.map !== rt.texture) {
      material.map = rt.texture
      material.needsUpdate = true
    }
    // The plane fills the viewport; scale it to restore the clip's true aspect.
    // Cover (default) crops the overflowing axis so footage always fills the
    // frame; Fit letterboxes inside it instead.
    const videoAspect = meta && meta.height > 0 ? meta.width / meta.height : 16 / 9
    const viewAspect = viewport.height > 0 ? viewport.width / viewport.height : 16 / 9
    const cover = (state.params.fit ?? paramDefault(videoInstrument, 'fit')) === 0
    let sx = 1
    let sy = 1
    if (cover ? videoAspect > viewAspect : videoAspect < viewAspect) sx = videoAspect / viewAspect
    else sy = viewAspect / videoAspect
    if (!cover) {
      const shrink = 1 / Math.max(sx, sy)
      sx *= shrink
      sy *= shrink
    }
    mesh.scale.set(sx, sy, 1)
    mesh.visible = true
  })

  return (
    <mesh ref={meshRef} material={material} visible={false}>
      <planeGeometry args={[viewport.width, viewport.height]} />
    </mesh>
  )
}

export const videoInstrument: ObjectInstrumentDef = {
  id: 'video',
  name: 'Video',
  kind: 'object',
  params: [
    { key: 'loop', label: 'Loop Clips', type: 'boolean' as const, default: 1 },
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
  // (No midiRowLabels: the Video track's MIDI editor shows only its clip rows,
  // built live from the pad bank — see generateVideoClipRows.)
  // A full-frame layer: the renderer pins it dead-ahead of the camera, parallel
  // to it, so footage reads as a screen — never a tilted plane in space.
  fullFrame: true,
  component: VideoComponent,
}

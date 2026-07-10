'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Mesh, MeshBasicMaterial, SRGBColorSpace, LinearFilter, CanvasTexture } from 'three'
import { useThree } from '@react-three/fiber'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { getObjectState } from '../core/visual/VisualEngine'
import { activeVideoAt, clipTimeAt, VIDEO_BASE_PITCH } from '../core/video/videoTime'
import { VideoDecodeEngine } from '../core/video/decodeEngine'
import { registerFramePreparer } from '../core/export/exportEngine'
import { useVideoStore } from '../store/VideoStore'
import { useProjectStore } from '../store/ProjectStore'
import { useTimeStore } from '../store/TimeStore'
import { paramDefault, type ObjectInstrumentDef } from './types'

// The Video instrument: an ordered bank of the user's own clips, cut by MIDI.
// A note-on selects clip (pitch − VIDEO_BASE_PITCH) mod clipCount and restarts it;
// the clip latches until the next note-on, bounded by its block.
//
// Rendering is the mediabunny decode engine (core/video/decodeEngine), NOT a
// <video> element - element seeking could not do instant, re-triggerable cuts.
// The engine keeps each clip's head decoded and warm, so a note-triggered
// restart lands on a cached frame the next display tick.
//
// Pause invariant: the frame at a beat is f(beat, notes). The active clip and
// its source-time are derived purely (activeVideoAt + clipTimeAt); the engine
// draws exactly that. Live playback serves from the warm buffer; export serves
// frame-exact (engine.drawExact); a paused decode arrival redraws the last
// request (the frame callback is skip-gated and won't re-fire on its own).

function VideoComponent({ trackId }: { trackId: string }) {
  const meshRef = useRef<Mesh>(null)
  const invalidate = useThree((s) => s.invalidate)
  const viewport = useThree((s) => s.viewport)
  const videoRefs = useProjectStore((s) => s.tracks[trackId]?.videoRefs)

  // Last (clip, source-time) asked for, so an async decode arrival while paused
  // can redraw it without the skip-gated frame callback re-running.
  const lastReq = useRef<{ ref: string | null; sourceTime: number }>({ ref: null, sourceTime: 0 })
  const readyCb = useRef<() => void>(() => {})

  const { engine, texture, material } = useMemo(() => {
    const engine = new VideoDecodeEngine(() => readyCb.current())
    const texture = new CanvasTexture(engine.canvasSource)
    texture.colorSpace = SRGBColorSpace
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    texture.generateMipmaps = false
    // Backdrop, not occluder: depthWrite off so 3D objects draw in front.
    const material = new MeshBasicMaterial({ map: texture, toneMapped: false, depthWrite: false })
    return { engine, texture, material }
  }, [])

  // A decode finished while paused: redraw the last request so the new frame
  // reaches the texture (playback's own loop handles the live case).
  readyCb.current = () => {
    if (useTimeStore.getState().isPlaying) return
    const { ref, sourceTime } = lastReq.current
    const res = engine.draw(ref, sourceTime)
    if (meshRef.current) meshRef.current.visible = res.visible
    if (res.updated) texture.needsUpdate = true
    invalidate()
  }

  // Reconcile which clips are open. Each ref is a whole-source clip (in-point 0
  // for now; the pad model sets real in-points here with no engine change).
  useEffect(() => {
    engine.syncClips((videoRefs ?? []).map((ref) => ({ ref, inPoint: 0 })))
    invalidate()
  }, [engine, videoRefs, invalidate])

  useEffect(() => {
    return () => {
      engine.dispose()
      texture.dispose()
      material.dispose()
    }
  }, [engine, texture, material])

  // Export: draw the frame-exact frame for each exported beat before it renders.
  useEffect(() => {
    return registerFramePreparer(async (beat) => {
      const st = getObjectState(trackId)
      const refs = st?.videoRefs
      if (!st || !refs || refs.length === 0) return
      const loop = (st.params.loop ?? paramDefault(videoInstrument, 'loop')) > 0
      const active = activeVideoAt(st.notes, beat, VIDEO_BASE_PITCH, refs.length)
      if (!active) return
      const ref = refs[active.clipIndex]
      const duration = useVideoStore.getState().videoClips[ref]?.duration ?? 1e9
      const sourceTime = clipTimeAt(beat, active.noteBeat, st.secPerBeat, duration, loop)
      const aspect = await engine.drawExact(ref, sourceTime)
      if (aspect !== null) texture.needsUpdate = true
    })
  }, [engine, texture, trackId])

  useInstrumentFrame(trackId, (state) => {
    const mesh = meshRef.current
    if (!mesh) return
    const refs = state.videoRefs ?? []
    const loop = (state.params.loop ?? paramDefault(videoInstrument, 'loop')) > 0
    const active = state.blackedOut ? null : activeVideoAt(state.notes, state.beat, VIDEO_BASE_PITCH, refs.length)
    const ref = active ? refs[active.clipIndex] : null

    let sourceTime = 0
    if (ref && active) {
      const duration = useVideoStore.getState().videoClips[ref]?.duration ?? 1e9
      sourceTime = clipTimeAt(state.beat, active.noteBeat, state.secPerBeat, duration, loop)
    }
    lastReq.current = { ref, sourceTime }

    const res = engine.draw(ref, sourceTime)
    if (res.updated) texture.needsUpdate = true
    mesh.visible = res.visible
    if (!res.visible) return

    if (material.map !== texture) {
      material.map = texture
      material.needsUpdate = true
    }
    // Viewport-filling plane, scaled to restore the clip's true aspect. Cover
    // (default) crops the overflowing axis; Fit letterboxes inside the frame.
    const videoAspect = res.aspect
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
  // The Video track's MIDI editor shows only its clip rows (generateVideoClipRows).
  // A full-frame layer: the renderer pins it dead-ahead of the camera, parallel
  // to it, so footage reads as a screen — never a tilted plane in space.
  fullFrame: true,
  component: VideoComponent,
}

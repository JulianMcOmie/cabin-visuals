'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Mesh, MeshBasicMaterial, SRGBColorSpace, LinearFilter, CanvasTexture } from 'three'
import { useThree } from '@react-three/fiber'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { getObjectState } from '../core/visual/VisualEngine'
import { activeVideoAt, padSourceTime, VIDEO_BASE_PITCH } from '../core/video/videoTime'
import { VideoDecodeEngine, clipKey } from '../core/video/decodeEngine'
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
  const videoPads = useProjectStore((s) => s.tracks[trackId]?.videoPads)

  // Last (clip, source-time) asked for, so an async decode arrival while paused
  // can redraw it without the skip-gated frame callback re-running.
  const lastReq = useRef<{ key: string | null; sourceTime: number }>({ key: null, sourceTime: 0 })
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
    const { key, sourceTime } = lastReq.current
    const res = engine.draw(key, sourceTime)
    if (meshRef.current) meshRef.current.visible = res.visible
    if (res.updated) texture.needsUpdate = true
    invalidate()
  }

  // Reconcile which pads are armed: each is (source, in-point), and its head
  // frames stay permanently decoded so a note hit lands next display tick.
  useEffect(() => {
    engine.syncClips(
      (videoPads ?? []).map((p) => ({ key: clipKey(p.ref, p.inPoint), ref: p.ref, inPoint: p.inPoint })),
    )
    invalidate()
  }, [engine, videoPads, invalidate])

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
      const pads = st?.videoPads
      if (!st || !pads || pads.length === 0) return
      const loop = (st.params.loop ?? paramDefault(videoInstrument, 'loop')) > 0
      const active = activeVideoAt(st.notes, beat, VIDEO_BASE_PITCH, pads.length)
      if (!active) return
      const pad = pads[active.clipIndex]
      const duration = useVideoStore.getState().videoClips[pad.ref]?.duration ?? 1e9
      const sourceTime = padSourceTime(pad, beat, active.noteBeat, st.secPerBeat, loop, duration)
      const aspect = await engine.drawExact(clipKey(pad.ref, pad.inPoint), sourceTime)
      if (aspect !== null) texture.needsUpdate = true
    })
  }, [engine, texture, trackId])

  useInstrumentFrame(trackId, (state) => {
    const mesh = meshRef.current
    if (!mesh) return
    const pads = state.videoPads ?? []
    const loop = (state.params.loop ?? paramDefault(videoInstrument, 'loop')) > 0
    const active = state.blackedOut ? null : activeVideoAt(state.notes, state.beat, VIDEO_BASE_PITCH, pads.length)
    const pad = active ? pads[active.clipIndex] : null

    const key = pad ? clipKey(pad.ref, pad.inPoint) : null
    const sourceTime = pad && active
      ? padSourceTime(
          pad,
          state.beat,
          active.noteBeat,
          state.secPerBeat,
          loop,
          useVideoStore.getState().videoClips[pad.ref]?.duration ?? 1e9,
        )
      : 0
    lastReq.current = { key, sourceTime }

    const res = engine.draw(key, sourceTime)
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

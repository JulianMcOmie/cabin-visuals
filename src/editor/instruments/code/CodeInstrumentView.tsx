import { useEffect, useRef, type FC } from 'react'
import { useThree } from '@react-three/fiber'
import type { Group } from 'three'
import { beatInBlock, useInstrumentFrame } from '../../core/visual/instrumentFrame'
import type { ObjectState } from '../../core/visual/types'
import { ColorCache, makeMusicCtx, specDefaults, type SpecDefaults } from './musicCtx'
import { reportCodeError } from './errors'
import { latestSpec, onSpecSwap } from './live'
import { world } from './world'
import { applyCameraPose } from '../../core/visual/cameraOwner'
import type { CodeInstrumentSpec, FrameCtx, SetupCtx } from './types'

// The one R3F host behind every code instrument. It owns an empty <group> (the
// instrument's root), runs the spec's setup() on the first frame the group
// exists, then frame() on every frame whose inputs changed (useInstrumentFrame's
// signature skip - so a paused, unchanged frame costs nothing). Everything the
// author touches is plain three.js; React never sees per-frame state.
//
// Hot swap: the component is per instrument ID, not per def object, and reads
// the newest spec from the live registry every frame (live.ts). When the spec
// object changes - its module was re-evaluated by a hot reload - the old
// setup is disposed and the new one runs, on the next frame, without a
// remount. The spec is part of the frame signature and a swap invalidates the
// canvas, so this happens while paused too.

interface Mount {
  spec: CodeInstrumentSpec
  state: unknown
  owned: { dispose(): void }[]
  failed: boolean
}

const views = new Map<string, FC<{ trackId: string }>>()
const defaultsBySpec = new WeakMap<CodeInstrumentSpec, SpecDefaults>()

function defaultsOf(spec: CodeInstrumentSpec): SpecDefaults {
  let d = defaultsBySpec.get(spec)
  if (!d) defaultsBySpec.set(spec, d = specDefaults(spec.params))
  return d
}

/** The component for one code-instrument id (stable for the page's lifetime). */
export function codeViewFor(id: string): FC<{ trackId: string }> {
  let view = views.get(id)
  if (!view) {
    view = makeView(id)
    views.set(id, view)
  }
  return view
}

function teardown(m: Mount, root: Group | null, id: string, trackId: string) {
  world().setTrackLook(trackId, null)
  try { m.spec.dispose?.(m.state) } catch (err) { reportCodeError(id, trackId, 'dispose', err, 0) }
  for (const thing of m.owned) {
    try { thing.dispose() } catch { /* already gone */ }
  }
  root?.clear()
}

function makeView(id: string): FC<{ trackId: string }> {
  function CodeInstrument({ trackId }: { trackId: string }) {
    const groupRef = useRef<Group>(null)
    const get = useThree((s) => s.get)
    const invalidate = useThree((s) => s.invalidate)
    const mount = useRef<Mount | null>(null)
    const colors = useRef(new ColorCache()).current

    // A hot swap of this id repaints even when nothing else changed.
    useEffect(() => onSpecSwap((swapped) => { if (swapped === id) invalidate() }), [invalidate])

    useEffect(() => () => {
      const m = mount.current
      mount.current = null
      if (m) teardown(m, groupRef.current, id, trackId)
    }, [trackId])

    useInstrumentFrame(trackId, (s: ObjectState) => {
      const root = groupRef.current
      if (!root) return false
      const spec = latestSpec(id)
      if (!spec) return false
      if (mount.current && mount.current.spec !== spec) {
        teardown(mount.current, root, id, trackId)
        mount.current = null
      }
      const three = get()
      const size = { width: three.size.width, height: three.size.height }
      const px = Math.max(1, three.size.height) / 1080
      const defaults = defaultsOf(spec)
      if (!mount.current) {
        const owned: { dispose(): void }[] = []
        const m: Mount = { spec, state: undefined, owned, failed: false }
        mount.current = m
        const music = makeMusicCtx({
          beat: s.beat, secPerBeat: s.secPerBeat, beatsPerBar: s.beatsPerBar,
          params: s.params, stringParams: s.stringParams, notes: s.notes, active: s.activeNotes,
        }, defaults, colors)
        const setupCtx: SetupCtx = {
          trackId, root, camera: three.camera, gl: three.gl, size, px,
          params: music.params, colors: music.colors, text: music.text,
          own: (thing) => { owned.push(thing); return thing },
        }
        try {
          m.state = spec.setup ? spec.setup(setupCtx) : undefined
        } catch (err) {
          m.failed = true
          reportCodeError(id, trackId, 'setup', err, s.beat)
        }
      }
      const m = mount.current
      if (m.failed || (!spec.frame && !spec.camera && !spec.look)) return
      const music = makeMusicCtx({
        beat: s.beat, secPerBeat: s.secPerBeat, beatsPerBar: s.beatsPerBar,
        params: s.params, stringParams: s.stringParams, notes: s.notes, active: s.activeNotes,
      }, defaults, colors)
      const vp = three.viewport.getCurrentViewport(three.camera, [0, 0, 0], three.size)
      const ctx: FrameCtx = {
        ...music,
        trackId,
        energy: s.energy,
        opacity: s.opacity,
        inBlock: beatInBlock(s),
        root,
        camera: three.camera,
        gl: three.gl,
        size,
        px,
        aspect: size.width / Math.max(1, size.height),
        viewport: { width: vp.width, height: vp.height },
        claimCamera: () => world().claimCamera(trackId),
      }
      try {
        spec.frame?.(ctx, m.state)
      } catch (err) {
        reportCodeError(id, trackId, 'frame', err, s.beat)
      }
      if (spec.camera) {
        try {
          const pose = spec.camera(ctx, m.state)
          if (pose) {
            applyCameraPose(three.camera, pose)
            world().claimCamera(trackId)
          }
        } catch (err) {
          reportCodeError(id, trackId, 'camera', err, s.beat)
        }
      }
      if (spec.look) {
        try {
          world().setTrackLook(trackId, spec.look(ctx, m.state) || null)
        } catch (err) {
          reportCodeError(id, trackId, 'look', err, s.beat)
        }
      }
    }, () => latestSpec(id))

    return <group ref={groupRef} />
  }
  CodeInstrument.displayName = `Code(${id})`
  return CodeInstrument
}

import { useRef, useEffect } from 'react'
import {
  Group, LineSegments, LineBasicMaterial, EdgesGeometry, IcosahedronGeometry, Color, AdditiveBlending,
  type BufferGeometry,
} from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { setAnimatedOpacity } from '../core/visual/animatedOpacity'

// The Icosahedron Burst visual - the lazy half of ./IcosahedronBurst (see that
// file's header for what this is and why each shell is closed-form in note age).

let sharedEdges: BufferGeometry | null = null
function edgeGeometry(): BufferGeometry {
  if (!sharedEdges) sharedEdges = new EdgesGeometry(new IcosahedronGeometry(1))
  return sharedEdges
}

interface Pooled { line: LineSegments; material: LineBasicMaterial; active: boolean }
const _c = new Color()

export function IcosahedronBurstVisual({ trackId }: { trackId: string }) {
  const groupRef = useRef<Group>(null)
  const poolRef = useRef<Pooled[]>([])

  useEffect(() => () => {
    const g = groupRef.current
    if (g) for (const p of poolRef.current) { g.remove(p.line); p.material.dispose() }
    poolRef.current = []
  }, [])

  function acquire(group: Group): Pooled {
    for (const p of poolRef.current) if (!p.active) { p.active = true; p.line.visible = true; return p }
    const material = new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false })
    material.blending = AdditiveBlending
    const line = new LineSegments(edgeGeometry(), material)
    group.add(line)
    const entry: Pooled = { line, material, active: true }
    poolRef.current.push(entry)
    return entry
  }

  useInstrumentFrame(trackId, (state) => {
    const group = groupRef.current
    if (!group) return false
    const notes = state.notes
    const p = state.params
    const startSize = p.startSize ?? 0.15
    const expansionSpeed = p.expansionSpeed ?? 4
    const maxSize = p.maxSize ?? 6
    const fadeStart = p.fadeStart ?? 0.5
    const hueStep = p.hueStep ?? 0.08
    const baseHue = p.baseHue ?? 0.55
    const saturation = p.saturation ?? 0.9
    const lightness = p.lightness ?? 0.6

    const currentBeat = state.beat
    const secPerBeat = state.secPerBeat
    // Seconds a shell takes to expand from startSize to maxSize - its lifetime.
    const lifetime = (maxSize - startSize) / expansionSpeed
    const fadeThreshold = maxSize * fadeStart

    for (const pm of poolRef.current) { pm.active = false; pm.line.visible = false }

    // A shell = a note whose age (in seconds) is within [0, lifetime). Size and
    // opacity are closed-form in that age, so pause freezes and scrub matches playback.
    for (let ni = 0; ni < notes.length; ni++) {
      const note = notes[ni]
      const ageSec = (currentBeat - note.beat) * secPerBeat
      if (ageSec < 0 || ageSec >= lifetime) continue
      const size = startSize + ageSec * expansionSpeed

      const pooled = acquire(group)
      pooled.line.scale.setScalar(size)
      // Hue steps per note in play order (index in the sorted note list stands in
      // for the old spawn counter, so it's stable under scrubbing).
      pooled.material.color.copy(_c.setHSL((baseHue + ni * hueStep) % 1, saturation, lightness))
      setAnimatedOpacity(pooled.material, size > fadeThreshold ? 1 - (size - fadeThreshold) / (maxSize - fadeThreshold) : 1)
    }
  })

  return <group ref={groupRef} />
}

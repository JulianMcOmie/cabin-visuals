import { useRef, useEffect } from 'react'
import { Group, Mesh, BoxGeometry, MeshBasicMaterial, AdditiveBlending } from 'three'
import { useInstrumentFrame, seededRand } from '../core/visual/instrumentFrame'
import { setAnimatedOpacity } from '../core/visual/animatedOpacity'
import { PALETTES } from './PixelBlast'

// The Pixel Blast visual - the lazy half of ./PixelBlast (see that file's
// header for the pitch/velocity mapping and why every particle is seeded).

const boxGeo = new BoxGeometry(1, 1, 1)

interface Pooled { mesh: Mesh; mat: MeshBasicMaterial; active: boolean }

export function PixelBlastVisual({ trackId }: { trackId: string }) {
  const groupRef = useRef<Group>(null)
  const poolRef = useRef<Pooled[]>([])

  useEffect(() => () => {
    const g = groupRef.current
    if (g) for (const p of poolRef.current) { g.remove(p.mesh); p.mat.dispose() }
    poolRef.current = []
  }, [])

  function acquire(group: Group): Pooled {
    for (const p of poolRef.current) if (!p.active) { p.active = true; p.mesh.visible = true; return p }
    const mat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false })
    mat.blending = AdditiveBlending
    mat.fog = false
    const mesh = new Mesh(boxGeo, mat)
    group.add(mesh)
    const entry: Pooled = { mesh, mat, active: true }
    poolRef.current.push(entry)
    return entry
  }

  useInstrumentFrame(trackId, (state) => {
    const group = groupRef.current
    if (!group) return false
    const p = state.params
    const life = p.life ?? 0.9
    const px = p.pixelSize ?? 0.12
    const speed = p.speed ?? 3
    const countP = Math.round(p.count ?? 24)
    const spreadX = p.spreadX ?? 4.5
    const spreadY = p.spreadY ?? 1.1
    const gravity = p.gravity ?? 1.2
    const flashScale = p.flashScale ?? 1.4
    const sizeScale = p.sizeScale ?? 1
    const blinkOut = (p.blinkOut ?? 1) >= 0.5

    const beat = state.beat
    const secPerBeat = state.secPerBeat

    for (const pm of poolRef.current) { pm.active = false; pm.mesh.visible = false }

    for (const n of state.notes) {
      if (n.beat > beat) continue
      const ageSec = (beat - n.beat) * secPerBeat
      if (ageSec >= life) continue

      const velN = n.velocity <= 1 ? n.velocity : n.velocity / 127
      const pc = ((n.pitch % 12) + 12) % 12
      const cx = ((pc - 5.5) / 5.5) * spreadX
      const cy = Math.max(-2.6, Math.min(2.6, (Math.floor(n.pitch / 12) - 5) * spreadY))
      const cz = (seededRand(n.beat * 13 + n.pitch) - 0.5) * 0.8 // avoid z-fights between blasts
      const pal = PALETTES[pc % PALETTES.length]
      const t = ageSec / life

      // Core flash - one fat white square for the first instant.
      if (ageSec < 0.09 && flashScale > 0) {
        const pooled = acquire(group)
        const fs = (0.5 + velN) * flashScale * px * 6
        pooled.mesh.position.set(Math.round(cx / px) * px, Math.round(cy / px) * px, cz)
        pooled.mesh.scale.set(fs, fs, px)
        pooled.mesh.rotation.set(0, 0, 0)
        pooled.mat.color.set('#ffffff')
        setAnimatedOpacity(pooled.mat, 1 - ageSec / 0.09)
      }

      const count = Math.round(countP * (0.5 + velN))
      for (let i = 0; i < count; i++) {
        const s = n.beat * 13 + n.pitch * 7 + i * 11
        const ang = (Math.floor(seededRand(s) * 16) / 16) * Math.PI * 2
        const spd = (0.5 + seededRand(s + 2)) * speed * (0.5 + velN)
        const d = spd * (1 - Math.exp(-ageSec * 3.2))
        const rawX = cx + Math.cos(ang) * d
        const rawY = cy + Math.sin(ang) * d - gravity * ageSec * ageSec
        // The snap: everything lives on the pixel grid.
        const gx = Math.round(rawX / px) * px
        const gy = Math.round(rawY / px) * px

        // Discrete three-step chunk shrink; blink at the end of life.
        const chunk = px * (0.6 + seededRand(s + 4) * 0.9) * (0.6 + velN * 0.8) * sizeScale
        const size = chunk * (Math.ceil((1 - t) * 3) / 3)
        if (size <= 0) continue
        if (blinkOut && t > 0.75 && Math.floor(ageSec * 24) % 2 === 0) continue

        const pooled = acquire(group)
        pooled.mesh.position.set(gx, gy, cz)
        pooled.mesh.scale.set(size, size, size)
        pooled.mesh.rotation.set(0, 0, 0)
        pooled.mat.color.set(pal[Math.floor(seededRand(s + 6) * pal.length)])
        setAnimatedOpacity(pooled.mat, 1)
      }
    }
  })

  return <group ref={groupRef} />
}

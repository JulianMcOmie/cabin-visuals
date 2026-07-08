import { useRef, useEffect } from 'react'
import { Group, InstancedMesh, BoxGeometry, MeshBasicMaterial, Color, AdditiveBlending, Matrix4, Quaternion, Vector3 } from 'three'
import { useInstrumentFrame, seededRand, beatInBlock } from '../core/visual/instrumentFrame'
import type { ResolvedNote } from '../core/visual/types'
import type { ObjectInstrumentDef, ParamDef } from './types'

// RETRO ARCADE — rows of pixel-art space invaders (one InstancedMesh of tiny cubes
// forming 8-bit sprites) march side-to-side in classic stepped shuffle, animation
// frame alternating each step. Every note fires the cannon: pitch % cols picks the
// column, the bottom-most surviving invader in that column takes the hit — a laser
// column flashes up from the cannon and the invader bursts into grid-snapped pixel
// shrapnel. The whole formation respawns at the top of each phrase. Fully pure in
// `state.beat`: kills are re-derived every frame from the notes inside the current
// phrase window, so scrub == playback and paused frames are static.

const INVADER_A = [
  '..#.....#..',
  '...#...#...',
  '..#######..',
  '.##.###.##.',
  '###########',
  '#.#######.#',
  '#.#.....#.#',
  '...##.##...',
]
const INVADER_B = [
  '..#.....#..',
  '#..#...#..#',
  '#.#######.#',
  '###.###.###',
  '###########',
  '.#########.',
  '..#.....#..',
  '.#.......#.',
]
const CANNON = [
  '.....#.....',
  '....###....',
  '.#########.',
  '###########',
]

const CAP = 4096
const boxGeo = new BoxGeometry(1, 1, 1)
const _m = new Matrix4()
const _q = new Quaternion()
const _pos = new Vector3()
const _scl = new Vector3()
const _c = new Color()
const _cWhite = new Color('#ffffff')

const PARAMS: ParamDef[] = [
  { key: 'cols', label: 'Columns', min: 3, max: 8, step: 1, default: 6 },
  { key: 'rows', label: 'Rows', min: 1, max: 4, step: 1, default: 3 },
  { key: 'pixelSize', label: 'Pixel Size', min: 0.04, max: 0.2, step: 0.01, default: 0.09 },
  { key: 'spacingX', label: 'Column Spacing', min: 0.8, max: 3, step: 0.1, default: 1.5 },
  { key: 'spacingY', label: 'Row Spacing', min: 0.6, max: 2.5, step: 0.1, default: 1.1 },
  { key: 'gridY', label: 'Formation Top Y', min: 0, max: 4, step: 0.1, default: 1.8 },
  { key: 'stepBeats', label: 'March Step (beats)', min: 0.25, max: 4, step: 0.25, default: 1 },
  { key: 'marchSteps', label: 'Steps Per Side', min: 2, max: 12, step: 1, default: 4 },
  { key: 'stepSize', label: 'Step Size', min: 0.1, max: 1, step: 0.05, default: 0.35 },
  { key: 'phraseBeats', label: 'Phrase (beats)', min: 4, max: 64, step: 4, default: 16 },
  { key: 'explodeDur', label: 'Explosion Time (s)', min: 0.2, max: 2, step: 0.05, default: 0.6 },
  { key: 'explodeSpeed', label: 'Explosion Speed', min: 0.5, max: 8, step: 0.25, default: 2.5 },
  { key: 'laserDur', label: 'Laser Flash (s)', min: 0.05, max: 0.5, step: 0.01, default: 0.18 },
  { key: 'rowColor1', label: 'Row Color A', type: 'color', default: '#39ff14' },
  { key: 'rowColor2', label: 'Row Color B', type: 'color', default: '#00e5ff' },
  { key: 'rowColor3', label: 'Row Color C', type: 'color', default: '#ff2079' },
  { key: 'laserColor', label: 'Laser Color', type: 'color', default: '#aef852' },
]
function PixelInvadersVisual({ trackId }: { trackId: string }) {
  const groupRef = useRef<Group>(null)
  const imeshRef = useRef<InstancedMesh | null>(null)

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const mat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false })
    mat.blending = AdditiveBlending
    mat.fog = false
    const imesh = new InstancedMesh(boxGeo, mat, CAP)
    imesh.frustumCulled = false
    imesh.count = 0
    // Initialize the instanceColor buffer so setColorAt is valid from frame one.
    for (let i = 0; i < CAP; i++) imesh.setColorAt(i, _cWhite)
    group.add(imesh)
    imeshRef.current = imesh
    return () => {
      group.remove(imesh)
      mat.dispose()
      imesh.dispose()
      imeshRef.current = null
    }
  }, [])

  useInstrumentFrame(trackId, (state) => {
    const imesh = imeshRef.current
    if (!imesh) return
    // No block at this beat = nothing on screen (blocks are the on-region).
    const inBlock = beatInBlock(state)
    if (groupRef.current) groupRef.current.visible = inBlock
    if (!inBlock) return
    const p = state.params
    const sp = state.stringParams
    const cols = Math.max(1, Math.round(p.cols ?? 6))
    const rows = Math.max(1, Math.round(p.rows ?? 3))
    const px = p.pixelSize ?? 0.09
    const gapX = p.spacingX ?? 1.5
    const gapY = p.spacingY ?? 1.1
    const topY = p.gridY ?? 1.8
    const stepBeats = p.stepBeats ?? 1
    const marchSteps = Math.max(1, Math.round(p.marchSteps ?? 4))
    const stepSize = p.stepSize ?? 0.35
    const phraseBeats = p.phraseBeats ?? 16
    const explodeDur = p.explodeDur ?? 0.6
    const explodeSpeed = p.explodeSpeed ?? 2.5
    const laserDur = p.laserDur ?? 0.18

    const beat = state.beat
    const secPerBeat = state.secPerBeat

    const rowColors = [sp.rowColor1 ?? '#39ff14', sp.rowColor2 ?? '#00e5ff', sp.rowColor3 ?? '#ff2079']
    const laserColor = sp.laserColor ?? '#aef852'

    // Classic stepped shuffle: ping-pong offset in whole steps, sprite frame
    // alternating each step. All from floor(beat) arithmetic — pure.
    const stepIndex = Math.floor(beat / stepBeats)
    const period = marchSteps * 2
    const ph = ((stepIndex % period) + period) % period
    const off = ph < marchSteps ? ph : period - ph
    const marchX = (off - marchSteps / 2) * stepSize
    const sprite = stepIndex % 2 === 0 ? INVADER_A : INVADER_B

    // Kills re-derived from scratch each frame: notes inside the current phrase
    // window whose onset the playhead has passed. Respawn = new phrase window.
    const phraseStart = Math.floor(beat / phraseBeats) * phraseBeats
    const zaps: ResolvedNote[] = []
    for (const n of state.notes) if (n.beat >= phraseStart && n.beat <= beat) zaps.push(n)
    zaps.sort((a, b) => a.beat - b.beat)

    const killedBy: (ResolvedNote | null)[] = new Array(cols * rows).fill(null)
    for (const z of zaps) {
      const col = ((z.pitch % cols) + cols) % cols
      for (let r = rows - 1; r >= 0; r--) {
        const idx = r * cols + col
        if (!killedBy[idx]) { killedBy[idx] = z; break }
      }
    }

    let used = 0
    const place = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: Color) => {
      if (used >= CAP) return
      _pos.set(x, y, z)
      _scl.set(sx, sy, sz)
      _m.compose(_pos, _q, _scl)
      imesh.setMatrixAt(used, _m)
      imesh.setColorAt(used, color)
      used++
    }
    const drawSprite = (bitmap: string[], cx: number, cy: number, color: Color) => {
      const h = bitmap.length
      const w = bitmap[0].length
      for (let i = 0; i < h; i++) {
        const row = bitmap[i]
        for (let j = 0; j < w; j++) {
          if (row[j] !== '#') continue
          place(cx + (j - (w - 1) / 2) * px, cy + ((h - 1) / 2 - i) * px, 0, px * 0.92, px * 0.92, px * 0.92, color)
        }
      }
    }

    const cannonY = topY - rows * gapY - 1.0

    let lastZap: ResolvedNote | null = null
    for (const z of zaps) if (!lastZap || z.beat > lastZap.beat) lastZap = z

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = (c - (cols - 1) / 2) * gapX + marchX
        const cy = topY - r * gapY
        const killer = killedBy[r * cols + c]
        _c.set(rowColors[r % 3])
        if (!killer) {
          drawSprite(sprite, cx, cy, _c)
          continue
        }
        const ageSec = (beat - killer.beat) * secPerBeat
        // Laser column: cannon → invader, a brief bright pillar.
        if (ageSec < laserDur) {
          const h = cy - cannonY
          _c.set(laserColor)
          place(cx, cannonY + h / 2, 0, px * 0.5, h, px * 0.5, _c)
        }
        // Grid-snapped pixel shrapnel, 8 quantized directions, seeded per particle.
        if (ageSec < explodeDur) {
          const velN = killer.velocity <= 1 ? killer.velocity : killer.velocity / 127
          const n = Math.round(12 + velN * 16)
          const t = ageSec / explodeDur
          for (let i = 0; i < n; i++) {
            const s = killer.beat * 13 + killer.pitch * 7 + i * 5
            const ang = (Math.floor(seededRand(s) * 8) / 8) * Math.PI * 2 + (seededRand(s + 1) - 0.5) * 0.3
            const spd = (0.6 + seededRand(s + 2) * 1.2) * explodeSpeed * (0.5 + velN)
            const d = spd * (1 - Math.exp(-ageSec * 4))
            const sx = Math.round((cx + Math.cos(ang) * d) / px) * px
            const sy = Math.round((cy + Math.sin(ang) * d) / px) * px
            const size = px * Math.max(0.15, 1.4 - t * 1.4)
            const white = seededRand(s + 3) > 0.55
            place(sx, sy, 0, size, size, size, white ? _cWhite : _c.set(rowColors[r % 3]))
          }
        }
      }
    }

    // Player cannon: slides under the most recent target, otherwise patrols.
    let cannonX = Math.sin(beat * (Math.PI / 4)) * gapX
    if (lastZap && (beat - lastZap.beat) * secPerBeat < 1.0) {
      const col = ((lastZap.pitch % cols) + cols) % cols
      cannonX = (col - (cols - 1) / 2) * gapX + marchX
    }
    _c.set(laserColor)
    drawSprite(CANNON, cannonX, cannonY - (CANNON.length / 2) * px, _c)

    imesh.count = used
    imesh.instanceMatrix.needsUpdate = true
    if (imesh.instanceColor) imesh.instanceColor.needsUpdate = true
  })

  return <group ref={groupRef} />
}

export const pixelInvadersInstrument: ObjectInstrumentDef = {
  id: 'pixelInvaders',
  name: 'Pixel Invaders',
  kind: 'object',
  params: PARAMS,
  component: PixelInvadersVisual,
}

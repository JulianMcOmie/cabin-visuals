import { useRef, useEffect } from 'react'
import { Group, Mesh, BoxGeometry, MeshBasicMaterial, AdditiveBlending } from 'three'
import { useInstrumentFrame, beatInBlock } from '../core/visual/instrumentFrame'
import type { ResolvedNote } from '../core/visual/types'
import type { ObjectInstrumentDef, ParamDef, PortDef } from './types'

// RETRO ARCADE — pong. A cube ball rallies between two paddles, crossing the
// court once per beat (ambient: it rallies forever with zero notes). The ball's
// position is a closed-form function of `state.beat`: phase advances 0.5 cycles
// per beat, and every played note SMASHES the rally by injecting `smash` whole
// extra crossings via a saturating exponential (1 - e^(-age/tau)) — speed spikes
// then realigns to the beat grid, purely and scrub-safely. The most recent note's
// pitch shapes the bounce: hops per crossing = 1 + (pitch % 3), arc height maps
// pitch 36..84 onto baseBounce..baseBounce+bounceRange. Velocity feeds a decaying
// envelope that sets the ghost-trail length. Paddles bob on the beat and slide to
// meet the ball as it approaches.

const boxGeo = new BoxGeometry(1, 1, 1)

interface Pooled { mesh: Mesh; mat: MeshBasicMaterial; active: boolean }

const PARAMS: ParamDef[] = [
  { key: 'courtWidth', label: 'Court Width', min: 4, max: 16, step: 0.5, default: 8 },
  { key: 'courtHeight', label: 'Court Height', min: 2, max: 10, step: 0.5, default: 4.5 },
  { key: 'ballSize', label: 'Ball Size', min: 0.1, max: 1, step: 0.02, default: 0.32 },
  { key: 'paddleHeight', label: 'Paddle Height', min: 0.5, max: 3, step: 0.1, default: 1.3 },
  { key: 'paddleWidth', label: 'Paddle Width', min: 0.1, max: 0.6, step: 0.02, default: 0.22 },
  { key: 'smash', label: 'Smash Crossings', min: 0, max: 3, step: 1, default: 1 },
  { key: 'smashTau', label: 'Smash Decay (beats)', min: 0.1, max: 2, step: 0.05, default: 0.4 },
  { key: 'baseBounce', label: 'Base Bounce Height', min: 0.2, max: 3, step: 0.1, default: 1.2 },
  { key: 'bounceRange', label: 'Pitch Bounce Range', min: 0, max: 3, step: 0.1, default: 1.6 },
  { key: 'trailMax', label: 'Max Trail', min: 0, max: 30, step: 1, default: 14 },
  { key: 'trailDecay', label: 'Trail Decay (beats)', min: 0.5, max: 8, step: 0.25, default: 2 },
  { key: 'trailSpacing', label: 'Trail Spacing (beats)', min: 0.02, max: 0.2, step: 0.01, default: 0.06 },
  { key: 'ballColor', label: 'Ball Color', type: 'color', default: '#ffffff' },
  { key: 'paddleColor', label: 'Paddle Color', type: 'color', default: '#22d3ee' },
  { key: 'courtColor', label: 'Court Color', type: 'color', default: '#4b5563' },
]
const PORTS: PortDef[] = [
  { key: 'energy', label: 'Energy', combine: 'add', default: 0 },
  { key: 'scale', label: 'Scale', combine: 'add', default: 0 },
  { key: 'hue', label: 'Hue', combine: 'add', default: 0 },
]

/** Closed-form ball state at an arbitrary beat (pure — used for ball AND trail ghosts). */
function ballAt(
  b: number, notes: ResolvedNote[],
  smash: number, tau: number,
  hw: number, yBase: number, baseAmp: number, ampRange: number,
): { x: number; y: number } {
  let phase = b * 0.5 // half a cycle per beat → one paddle crossing per beat
  let amp = baseAmp
  let hops = 1
  let lastBeat = -Infinity
  for (const n of notes) {
    if (n.beat > b) continue
    const age = b - n.beat
    phase += smash * 0.5 * (1 - Math.exp(-age / tau))
    if (n.beat > lastBeat) {
      lastBeat = n.beat
      amp = baseAmp + Math.min(1, Math.max(0, (n.pitch - 36) / 48)) * ampRange
      hops = 1 + ((n.pitch % 3) + 3) % 3
    }
  }
  const u = ((phase % 1) + 1) % 1 // full cycle: left → right → left
  const v = u < 0.5 ? u * 2 : 2 - u * 2 // 0 at left paddle, 1 at right
  const uu = ((phase * 2) % 1 + 1) % 1 // per-crossing progress
  return {
    x: -hw + v * 2 * hw,
    y: yBase + Math.abs(Math.sin(Math.PI * hops * uu)) * amp,
  }
}

function PaddleBounceVisual({ trackId }: { trackId: string }) {
  const groupRef = useRef<Group>(null)
  const ballRef = useRef<Mesh>(null)
  const leftRef = useRef<Mesh>(null)
  const rightRef = useRef<Mesh>(null)
  const topRef = useRef<Mesh>(null)
  const botRef = useRef<Mesh>(null)
  const netRef = useRef<Group>(null)
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
    const ball = ballRef.current
    const left = leftRef.current
    const right = rightRef.current
    const top = topRef.current
    const bot = botRef.current
    const net = netRef.current
    if (!group || !ball || !left || !right || !top || !bot || !net) return

    // No block at this beat = nothing on screen (blocks are the on-region).
    const inBlock = beatInBlock(state)
    group.visible = inBlock
    if (!inBlock) return

    const p = state.params
    const sp = state.stringParams
    const courtW = p.courtWidth ?? 8
    const courtH = p.courtHeight ?? 4.5
    const ballSize = p.ballSize ?? 0.32
    const paddleH = p.paddleHeight ?? 1.3
    const paddleW = p.paddleWidth ?? 0.22
    const smash = Math.round(p.smash ?? 1)
    const tau = p.smashTau ?? 0.4
    const baseAmp = p.baseBounce ?? 1.2
    const ampRange = p.bounceRange ?? 1.6
    const trailMax = Math.round(p.trailMax ?? 14)
    const trailDecay = p.trailDecay ?? 2
    const trailDt = p.trailSpacing ?? 0.06
    const beat = state.beat

    const hw = courtW / 2
    const hh = courtH / 2
    const yBase = -hh * 0.55
    const paddleX = hw - 0.35

    const bs = ballAt(beat, state.notes, smash, tau, paddleX - ballSize * 0.6, yBase, baseAmp, ampRange)
    ball.position.set(bs.x, bs.y, 0)
    ball.scale.setScalar(ballSize)
    // Steppy 8-bit spin — quantized to eighths of a beat.
    ball.rotation.z = Math.floor(beat * 8) * (Math.PI / 8)
    ;(ball.material as MeshBasicMaterial).color.set(sp.ballColor ?? '#ffffff')

    // Paddles bob on the beat, then slide to meet the ball as it nears their side.
    const distL = Math.min(1, Math.abs(bs.x + paddleX) / courtW)
    const distR = Math.min(1, Math.abs(bs.x - paddleX) / courtW)
    const trackL = (1 - distL) * (1 - distL)
    const trackR = (1 - distR) * (1 - distR)
    const bobL = yBase + Math.sin(beat * Math.PI) * 0.15
    const bobR = yBase + Math.sin(beat * Math.PI + Math.PI) * 0.15
    left.position.set(-paddleX, bobL + (bs.y - bobL) * trackL, 0)
    right.position.set(paddleX, bobR + (bs.y - bobR) * trackR, 0)
    left.scale.set(paddleW, paddleH * (1 + trackL * 0.15), paddleW * 1.4)
    right.scale.set(paddleW, paddleH * (1 + trackR * 0.15), paddleW * 1.4)
    ;(left.material as MeshBasicMaterial).color.set(sp.paddleColor ?? '#22d3ee')
    ;(right.material as MeshBasicMaterial).color.set(sp.paddleColor ?? '#22d3ee')

    // Court frame + dashed net.
    const courtColor = sp.courtColor ?? '#4b5563'
    top.position.set(0, hh, 0)
    bot.position.set(0, -hh, 0)
    top.scale.set(courtW + 0.6, 0.08, 0.08)
    bot.scale.set(courtW + 0.6, 0.08, 0.08)
    ;(top.material as MeshBasicMaterial).color.set(courtColor)
    ;(bot.material as MeshBasicMaterial).color.set(courtColor)
    const dashes = net.children.length
    for (let i = 0; i < dashes; i++) {
      const dash = net.children[i] as Mesh
      dash.position.set(0, -hh + ((i + 0.5) / dashes) * courtH, 0)
      dash.scale.set(0.06, courtH / dashes * 0.5, 0.06)
      ;(dash.material as MeshBasicMaterial).color.set(courtColor)
    }

    // Trail: length rides a per-note velocity envelope (decaying in beats).
    let velEnv = 0
    for (const n of state.notes) {
      if (n.beat > beat) continue
      const velN = n.velocity <= 1 ? n.velocity : n.velocity / 127
      const e = velN * Math.exp(-(beat - n.beat) / trailDecay)
      if (e > velEnv) velEnv = e
    }
    const trailN = Math.min(trailMax, Math.round(trailMax * velEnv))

    for (const pm of poolRef.current) { pm.active = false; pm.mesh.visible = false }
    for (let k = 1; k <= trailN; k++) {
      const g = ballAt(beat - k * trailDt, state.notes, smash, tau, paddleX - ballSize * 0.6, yBase, baseAmp, ampRange)
      const fade = 1 - k / (trailN + 1)
      const pooled = acquire(group)
      pooled.mesh.position.set(g.x, g.y, -0.05 * k)
      pooled.mesh.scale.setScalar(ballSize * (0.35 + 0.55 * fade))
      pooled.mesh.rotation.z = Math.floor((beat - k * trailDt) * 8) * (Math.PI / 8)
      pooled.mat.color.set(sp.ballColor ?? '#ffffff')
      pooled.mat.opacity = 0.55 * fade
    }
  })

  return (
    <group ref={groupRef}>
      <mesh ref={ballRef} geometry={boxGeo}>
        <meshBasicMaterial transparent depthWrite={false} blending={AdditiveBlending} fog={false} />
      </mesh>
      <mesh ref={leftRef} geometry={boxGeo}>
        <meshBasicMaterial transparent depthWrite={false} blending={AdditiveBlending} fog={false} />
      </mesh>
      <mesh ref={rightRef} geometry={boxGeo}>
        <meshBasicMaterial transparent depthWrite={false} blending={AdditiveBlending} fog={false} />
      </mesh>
      <mesh ref={topRef} geometry={boxGeo}>
        <meshBasicMaterial transparent depthWrite={false} blending={AdditiveBlending} fog={false} />
      </mesh>
      <mesh ref={botRef} geometry={boxGeo}>
        <meshBasicMaterial transparent depthWrite={false} blending={AdditiveBlending} fog={false} />
      </mesh>
      <group ref={netRef}>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <mesh key={i} geometry={boxGeo}>
            <meshBasicMaterial transparent opacity={0.7} depthWrite={false} blending={AdditiveBlending} fog={false} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

export const paddleBounceInstrument: ObjectInstrumentDef = {
  id: 'paddleBounce',
  name: 'Paddle Bounce',
  kind: 'object',
  params: PARAMS,
  ports: PORTS,
  component: PaddleBounceVisual,
}

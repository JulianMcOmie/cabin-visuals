import { Color } from 'three'

// Frozen from the legacy StarsVisual per-star loop for independent GPU parity
// checks and CPU/GPU A/B measurements. Keep its arithmetic and Float32 writes
// unchanged when the production shader changes.
const scratchColor = new Color()

function wrapCentered(v, half) {
  const span = half * 2
  return ((((v + half) % span) + span) % span) - half
}

export function createStarOutputs(count) {
  return {
    positions: new Float32Array(count * 3),
    sizes: new Float32Array(count),
    colors: new Float32Array(count * 3),
    alphas: new Float32Array(count),
  }
}

/**
 * Evaluate a resolved frame without note interpretation or production helpers.
 * `frame` carries displacement, spread, depth, pulseAmount, rollAngle,
 * tumbleAngle, tumbleAxis, dotSize, and tint (in degrees).
 * Pass reusable outputs to measure the original allocation-free frame loop.
 */
export function evaluateStarsCPU(base, parallax, frame, outputs = createStarOutputs(base.length / 3)) {
  const {
    displacement: [dispX, dispY, dispZ], spread, depth, pulseAmount, rollAngle,
    tumbleAngle, tumbleAxis: [tax, tay, taz], dotSize, tint,
  } = frame
  const depthHalf = depth / 2
  const tintHue = tint / 360
  const sc = scratchColor
  const par = parallax
  const pos = outputs.positions
  const sz = outputs.sizes
  const col = outputs.colors
  const alp = outputs.alphas
  const n = base.length / 3
  const cosRoll = Math.cos(rollAngle)
  const sinRoll = Math.sin(rollAngle)
  const cosT = Math.cos(tumbleAngle)
  const sinT = Math.sin(tumbleAngle)

  for (let i = 0; i < n; i++) {
    const parallax = par[i]

    // Translation displacement with parallax, wrapped back into the volume.
    let x = wrapCentered(base[i * 3] + dispX * parallax, spread)
    let y = wrapCentered(base[i * 3 + 1] + dispY * parallax, spread)
    let z = wrapCentered(base[i * 3 + 2] + dispZ * parallax, depthHalf)

    // Pulse burst - radial push outward from center in XY.
    if (pulseAmount > 0) {
      const pDist = Math.sqrt(x * x + y * y)
      if (pDist > 0.01) {
        const pushStr = pulseAmount * parallax
        x += (x / pDist) * pushStr
        y += (y / pDist) * pushStr
      }
    }

    // Barrel roll (rotate XY around Z axis by the accumulated roll angle).
    if (rollAngle !== 0) {
      const tmpX = x
      const tmpY = y
      x = tmpX * cosRoll - tmpY * sinRoll
      y = tmpX * sinRoll + tmpY * cosRoll
    }

    // Tumble (arbitrary axis rotation by the accumulated tumble angle).
    if (tumbleAngle > 0) {
      const dot = tax * x + tay * y + taz * z
      const cx = tay * z - taz * y
      const cy = taz * x - tax * z
      const cz = tax * y - tay * x
      const nx = x * cosT + cx * sinT + tax * dot * (1 - cosT)
      const ny = y * cosT + cy * sinT + tay * dot * (1 - cosT)
      const nz = z * cosT + cz * sinT + taz * dot * (1 - cosT)
      x = nx
      y = ny
      z = nz
    }

    // Wrap coordinates (pulse push and rotations can carry stars back out).
    x = wrapCentered(x, spread)
    y = wrapCentered(y, spread)
    z = wrapCentered(z, depthHalf)

    pos[i * 3] = x
    pos[i * 3 + 1] = y
    pos[i * 3 + 2] = z

    // Size: perspective scaling - closer = bigger.
    const absZ = Math.abs(z) + 0.5
    const perspSize = dotSize * (depthHalf / absZ)
    sz[i] = Math.max(0.5, perspSize)

    // Color: near stars are white, far stars pick up tint.
    const depthFrac = Math.abs(z) / depthHalf
    if (tintHue === 0 || depthFrac < 0.1) {
      col[i * 3] = 1
      col[i * 3 + 1] = 1
      col[i * 3 + 2] = 1
    } else {
      sc.setHSL(tintHue, 0.4 * depthFrac, 0.9 - 0.3 * depthFrac)
      const blend = depthFrac * 0.6
      col[i * 3] = 1 + (sc.r - 1) * blend
      col[i * 3 + 1] = 1 + (sc.g - 1) * blend
      col[i * 3 + 2] = 1 + (sc.b - 1) * blend
    }

    // Alpha: near = fully opaque, far = dimmer.
    alp[i] = 1.0 - depthFrac * 0.7
  }

  return outputs
}

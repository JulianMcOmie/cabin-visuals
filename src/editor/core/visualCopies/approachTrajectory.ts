// Note flight is parameterized by musical time, never integrated frame to frame.
// u=0 is launch and u=1 is the MIDI onset. Both curves join a resting start
// with zero velocity AND acceleration; the through curve continues unchanged
// across arrival, while the quintic joins a stationary target with C2 continuity.
export function approachTrajectory(u: number, settle: boolean): number {
  if (u <= 0) return 0
  if (!settle) return u * u * u
  if (u >= 1) return 1
  return u * u * u * (10 + u * (-15 + 6 * u))
}

/** Also used for visibility, so appearing/disappearing has no hard edge. */
export function approachSmoothstep(u: number): number {
  return approachTrajectory(Math.max(0, Math.min(1, u)), true)
}

export type ApproachPoint = [number, number, number]

/** Quadratic Bezier arc written as a straight path plus its midpoint bend.
 * Bend is perpendicular to start→target; angle rotates around that line
 * (0 = projected local X, 90 = perpendicular up). Coincident endpoints use +Z.
 * Keep the polynomial beyond progress=1: clamping the bend or switching to a
 * tangent would discard curvature and jump acceleration on fly-through.
 * Composing this smooth spatial path with the C2 time sampler preserves both
 * velocity and acceleration at launch, interception and settling.
 */
export function approachPathPosition(
  progress: number,
  start: ApproachPoint,
  target: ApproachPoint,
  bend = 0,
  angleDegrees = 0,
): ApproachPoint {
  const delta = target.map((value, axis) => value - start[axis])
  const position = start.map((value, axis) => value + delta[axis] * progress) as ApproachPoint
  // Preserve the original straight path exactly, including at both endpoints.
  if (bend === 0 || progress === 0 || progress === 1) return position
  const length = Math.hypot(...delta)
  const direction = length > 1e-9 ? delta.map((value) => value / length) : [0, 0, 1]
  // Project local X onto the normal plane; local Z is the fallback for a path
  // nearly parallel to X. Thus the bend frame is finite for every path.
  const axis = Math.abs(direction[0]) < 0.99 ? 0 : 2
  const right = direction.map((value, i) => (i === axis ? 1 : 0) - direction[axis] * value)
  const rightLength = Math.hypot(...right)
  for (let i = 0; i < 3; i++) right[i] /= rightLength
  const up = [
    direction[1] * right[2] - direction[2] * right[1],
    direction[2] * right[0] - direction[0] * right[2],
    direction[0] * right[1] - direction[1] * right[0],
  ]
  const angle = angleDegrees * Math.PI / 180
  const offset = 4 * progress * (1 - progress) * bend
  return position.map((value, i) => value + offset * (right[i] * Math.cos(angle) + up[i] * Math.sin(angle))) as ApproachPoint
}

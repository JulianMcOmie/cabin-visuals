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

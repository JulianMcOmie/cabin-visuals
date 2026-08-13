"use client"

import { useEffect, useRef, type RefObject } from "react"

/**
 * Ambient eye candy behind the hero CTA: concentric rings radiating from the
 * BUTTON, each one a polar curve whose lobe count and point sharpness morph as
 * it travels — circle, rose, five-point star, thirteen-point flower.
 *
 * It runs all the time. At rest the field is slow, sparse, nearly transparent
 * and barely varies; hovering (or focusing) the CTA ramps every one of those
 * toward the lively settings and back. IDLE and HOT below are the whole design —
 * the draw loop just blends between them by `heat`, which is driven by a
 * critically damped spring so the pickup eases in and out and stays smooth when
 * the pointer is flicked on and off. The two rate-like parameters blend through
 * `lerpRate`, not `lerp`; see its note for why that matters as much as the
 * spring does. What does NOT change between the two states is the number of
 * lobes — see polarRadius.
 *
 * The radius function is NeonPolar's `layerRadius`
 * (src/editor/instruments/NeonPolar.tsx:108) — same baseR wobble, same drifting
 * freq / amp / phase terms. Two changes were needed to make it work as a RING:
 *
 *  - **The harmonic is blended between two integers, never a fraction.** A
 *    non-integer `freq` makes r(0) ≠ r(2π), so the path does not close and the
 *    ring shows a seam where it joins. NeonPolar gets away with it (its curve is
 *    a thick line, and the break reads as style); a stroked ring cannot. Mixing
 *    lobe(floor k) with lobe(floor k + 1) keeps every term periodic, so the ring
 *    always closes AND the point count still morphs continuously.
 *  - **A sharpness exponent**, so lobes travel between a soft rose (1) and a
 *    hard-pointed star (~4). Raw cosine lobes are only ever sinusoidal bumps.
 *
 * **Rings carry their own progress; nothing is derived from the wall clock.**
 * The obvious implementation — ring n was born at n × spawnInterval — breaks the
 * moment the interval or the lifetime changes, because it retroactively rewrites
 * when every live ring was born and they all jump. Integrating `progress` per
 * ring instead means a parameter change only bends what happens next, so the
 * whole field accelerates smoothly into the hover state rather than cutting.
 * Same reason the morph runs on its own `morphClock` advanced at a rate that
 * lerps, instead of on elapsed seconds.
 *
 * The canvas fills its positioned parent and is clipped by it, which is how the
 * effect stays strictly under the top bar. That parent deliberately reaches
 * further DOWN than the hero: with the origin on the button — near the hero's
 * bottom edge — a hero-sized box would cut the rings off about 130px below the
 * origin, while they were still at ~85% alpha, leaving a hard horizontal line
 * across the page. Given room below, they fade out before they reach the edge,
 * and the only visible cut is the intended one at the top bar.
 *
 * Because it no longer stops when un-hovered, it stops on the other two axes
 * instead: the loop is parked whenever the box is scrolled out of view, and it
 * never starts at all under prefers-reduced-motion.
 */

/** At rest: slow, sparse, calm, nearly transparent. */
const IDLE = {
  life: 6.4, // seconds for a ring to cross the box
  spawn: 0.82, // seconds between rings
  alpha: 0.16,
  width: 1.3,
  variation: 0.55, // lobe DEPTH and point sharpness — never the lobe count
  morphRate: 0.3, // how fast the shape evolves
}

/** Hovered: the original lively setting. */
const HOT = {
  life: 1.6,
  spawn: 0.14,
  alpha: 0.5,
  width: 2.4,
  variation: 1,
  morphRate: 1,
}

// Roughly how long idle → hot takes. It is a spring, not a duration, so this is
// a feel knob rather than a deadline — and a spring eases IN, so it wants to be
// shorter than the constant-rate ramp it replaced or the first moments of a
// hover feel dead.
const HEAT_SMOOTH = 0.18
const SEGMENTS = 220 // samples per ring
const MORPH_SPAN = 0.48 // how far back in the morph a fully-grown ring samples
const MAX_RINGS = 32 // safety net; the parameters never ask for more than ~12

// Lobe count sweeps around this centre. The ends at variation 1 are the extremes
// of NeonPolar's own oscillator bank (2.0 … 13.0).
const LOBES_MID = 7.5
const LOBES_SWING = 5.5

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * Interpolate a duration by its RATE. Lifetimes and spawn intervals are stored
 * as seconds, but what the eye reads is the reciprocal — speed, and rings per
 * second. Lerping 0.82s → 0.14s linearly leaves the interval at 0.48s halfway
 * through, which is only a fifth of the way from 1.2 rings/sec to 7.1: almost
 * all of the density change lands in the last quarter of the ramp and reads as a
 * snap, however smooth the ramp itself is.
 */
const lerpRate = (a: number, b: number, t: number) => 1 / lerp(1 / a, 1 / b, t)

/**
 * NeonPolar's layerRadius, with the two changes described above plus a
 * `variation` scale on how DEEP and how POINTED the lobes are.
 *
 * **`variation` deliberately does not touch the lobe count.** Scaling the count's
 * swing with it was the first version and it looked wrong: hovering re-lobed the
 * whole field, so every ring on screen visibly re-formed into a different number
 * of leaves mid-transition. Leaf count is topology, not intensity — it has to be
 * the same number on both sides of the transition, and only the RATE it drifts
 * at is allowed to change. Because that rate feeds an integrated `morphClock`,
 * changing it never moves the shape, only how fast it keeps evolving.
 *
 * Every ring shares one phase; the only thing separating them is WHEN they
 * sample, which is what keeps them nested rather than crossing.
 */
function polarRadius(theta: number, t: number, variation: number): number {
  const baseR = 1.0 + (0.1 * Math.sin(t * 0.62) + 0.07 * Math.sin(t * 0.94)) * variation
  const amp = 0.26 * (0.55 + 0.45 * variation) + 0.08 * variation * Math.sin(t * 0.71)
  const phase = t * 0.35 + 0.6 * Math.sin(t * 0.27)

  // Lobe count as a blend of two consecutive integer harmonics. Full swing in
  // every state - see the note above.
  const k = LOBES_MID + LOBES_SWING * Math.sin(t * 0.42)
  const f1 = Math.floor(k)
  const w = k - f1

  // 1 = rose, ~4.2 = sharp star. Sign is kept so the valleys stay symmetric.
  const sharp = 1 + 3.2 * variation * (0.5 + 0.5 * Math.sin(t * 0.55))
  const shaped = (f: number) => {
    const c = Math.cos(f * theta + phase)
    return Math.sign(c) * Math.pow(Math.abs(c), sharp)
  }

  return baseR + amp * ((1 - w) * shaped(f1) + w * shaped(f1 + 1))
}

export function PolarRipples({
  active,
  originRef,
}: {
  active: boolean
  /** What the rings radiate from — the CTA. Falls back to the centre of the
   *  clipping box if it is not mounted yet. */
  originRef?: RefObject<HTMLElement | null>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const canvas = canvasRef.current
    const host = canvas?.parentElement
    const ctx = canvas?.getContext("2d")
    if (!canvas || !host || !ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let width = 0
    let height = 0
    let originX = 0
    let originY = 0
    // Measured on resize rather than per frame: one layout read per layout
    // change instead of sixty a second, and it keeps the origin still while the
    // button does its 2px hover lift.
    const resize = () => {
      const rect = host.getBoundingClientRect()
      width = rect.width
      height = rect.height
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const origin = originRef?.current?.getBoundingClientRect()
      originX = origin ? origin.left + origin.width / 2 - rect.left : width / 2
      originY = origin ? origin.top + origin.height / 2 - rect.top : height / 2
    }
    resize()
    const sizeObserver = new ResizeObserver(resize)
    sizeObserver.observe(host)
    if (originRef?.current) sizeObserver.observe(originRef.current)

    let raf = 0
    let visible = true
    let heat = 0
    let heatVel = 0
    let morphClock = 0
    let spawnAcc = 0
    let last = performance.now()
    const rings: { progress: number }[] = []

    const draw = (now: number) => {
      if (!visible) {
        raf = 0
        return
      }
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now

      // Critically damped spring toward the target (the standard SmoothDamp
      // approximation). It eases in AND out, never overshoots, and — because
      // the velocity carries across a change of target — flicking the pointer on
      // and off the button bends the motion instead of kinking it. The constant-
      // rate ramp this replaces was C0 only: full speed from the first frame,
      // dead stop on the last, which is what read as linear.
      const target = activeRef.current ? 1 : 0
      const omega = 2 / HEAT_SMOOTH
      const x = omega * dt
      const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
      const change = heat - target
      const temp = (heatVel + omega * change) * dt
      heatVel = (heatVel - omega * temp) * decay
      heat = target + (change + temp) * decay
      // A spring only approaches its target; settle it so `heat` is exactly 0
      // or 1 at rest and the parameters stop drifting in the last decimal.
      if (Math.abs(target - heat) < 4e-4) {
        heat = target
        heatVel = 0
      }

      const life = lerpRate(IDLE.life, HOT.life, heat)
      const spawn = lerpRate(IDLE.spawn, HOT.spawn, heat)
      const alphaScale = lerp(IDLE.alpha, HOT.alpha, heat)
      const widthScale = lerp(IDLE.width, HOT.width, heat)
      const variation = lerp(IDLE.variation, HOT.variation, heat)
      morphClock += dt * lerp(IDLE.morphRate, HOT.morphRate, heat)

      spawnAcc += dt
      while (spawnAcc >= spawn && rings.length < MAX_RINGS) {
        spawnAcc -= spawn
        // Seed with the time already elapsed since it was due, so several rings
        // born in one frame come out staggered rather than stacked.
        rings.push({ progress: Math.min(0.99, spawnAcc / life) })
      }

      for (let i = rings.length - 1; i >= 0; i--) {
        rings[i].progress += dt / life
        if (rings[i].progress >= 1) rings.splice(i, 1)
      }

      ctx.clearRect(0, 0, width, height)

      const cx = originX
      const cy = originY
      // Distance to the furthest corner FROM THE ORIGIN, not from the box
      // centre — an off-centre origin has a long side, and sizing to the box
      // would leave rings stopping short in mid-air on it. The 1.23 restores
      // the old travel-to-corner ratio once polarRadius' own 0.5 scale and its
      // ~1.3 peak are folded in.
      const reach =
        Math.max(
          Math.hypot(cx, cy),
          Math.hypot(width - cx, cy),
          Math.hypot(cx, height - cy),
          Math.hypot(width - cx, height - cy),
        ) * 1.23

      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      for (const ring of rings) {
        const p = ring.progress
        const radius = reach * Math.pow(p, 0.86)
        // In fast, out slow — a ring should read as arriving, then dissolving.
        const alpha = Math.min(1, p / 0.06) * Math.pow(1 - p, 1.5) * alphaScale
        if (alpha <= 0.004) continue

        const shapeTime = morphClock - p * MORPH_SPAN
        ctx.beginPath()
        for (let s = 0; s <= SEGMENTS; s++) {
          const theta = (s / SEGMENTS) * Math.PI * 2
          const r = radius * polarRadius(theta, shapeTime, variation) * 0.5
          const x = cx + Math.cos(theta) * r
          const y = cy + Math.sin(theta) * r
          if (s === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
        ctx.strokeStyle = `rgba(158, 232, 245, ${alpha.toFixed(4)})`
        ctx.lineWidth = widthScale * (1 - p * 0.7)
        ctx.stroke()
      }

      raf = requestAnimationFrame(draw)
    }

    const start = () => {
      if (!raf) {
        last = performance.now()
        raf = requestAnimationFrame(draw)
      }
    }

    // The effect is permanent now, so scrolling past it is what turns it off.
    const seenObserver = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting
        if (visible) start()
      },
      { rootMargin: "160px" },
    )
    seenObserver.observe(host)
    start()

    return () => {
      if (raf) cancelAnimationFrame(raf)
      sizeObserver.disconnect()
      seenObserver.disconnect()
    }
  }, [originRef])

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
}

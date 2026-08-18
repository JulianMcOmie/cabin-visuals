"use client"

import { useEffect, useRef } from "react"

/** Cursor particle trail for the editorial landing cover: soft cyan (and the
 *  occasional violet) dots spawn near the pointer and drift upward as they
 *  fade. Spawning is throttled (~1 per 24ms, capped at 90 live particles) and
 *  the whole effect is skipped under prefers-reduced-motion. Purely
 *  decorative: fixed, pointer-events none, above content. */
export function CursorParticles() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const canvas = ref.current
    if (!canvas) return
    const context = canvas.getContext("2d")
    if (!context) return
    const ctx = context

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    type Particle = {
      x: number
      y: number
      vx: number
      vy: number
      r: number
      life: number
      decay: number
      hue: string
    }
    let particles: Particle[] = []
    let last = 0
    let raf = 0

    const resize = () => {
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const move = (e: MouseEvent) => {
      const now = performance.now()
      if (now - last < 24 || particles.length > 90) return
      last = now
      // The loop only runs while there is something to draw - an idle
      // landing page used to clear a full-viewport canvas 60×/s forever.
      if (!raf) raf = requestAnimationFrame(tick)
      particles.push({
        x: e.clientX + (Math.random() - 0.5) * 10,
        y: e.clientY + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5 - 0.25,
        r: 1 + Math.random() * 1.8,
        life: 1,
        decay: 0.012 + Math.random() * 0.012,
        hue: Math.random() < 0.85 ? "158,232,245" : "190,175,255",
      })
    }

    function tick() {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        p.life -= p.decay
        if (p.life > 0) {
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(${p.hue},${(0.35 * p.life).toFixed(3)})`
          ctx.fill()
        }
      }
      particles = particles.filter((p) => p.life > 0)
      raf = particles.length > 0 ? requestAnimationFrame(tick) : 0
    }

    window.addEventListener("resize", resize)
    window.addEventListener("mousemove", move)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
      window.removeEventListener("mousemove", move)
    }
  }, [])

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 50,
      }}
    />
  )
}

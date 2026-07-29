"use client"

/**
 * /dev/landing-lab — throwaway prototypes exploring a new landing direction.
 *
 * Three mock heroes, one differentiator: MUSICALITY. Patterns are music, not
 * edits. Everything here is a lightweight facsimile (canvas + WebAudio blips,
 * not the real engine) so we can compare directions fast before committing.
 *
 *   A — "Play your visuals"  · live 16-step pad grid drives bursts + sound
 *   B — "It's music"         · MIDI piano roll playhead fires shapes
 *   C — "Best VJ"            · manifesto type pulsing on the beat
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronLeft, Play, Upload } from "lucide-react"

const BPM = 124
const STEP_MS = (60_000 / BPM) / 4 // 16th notes

/* ------------------------------------------------------------------ */
/* Audio: one lazy context, tiny synth voices. Armed on first gesture. */
/* ------------------------------------------------------------------ */

let audioCtx: AudioContext | null = null
function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null
  if (!audioCtx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    audioCtx = new AC()
  }
  if (audioCtx.state === "suspended") void audioCtx.resume()
  return audioCtx
}

function noiseBuffer(ac: AudioContext, seconds: number) {
  const buf = ac.createBuffer(1, ac.sampleRate * seconds, ac.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buf
}

type Voice = "kick" | "snare" | "hat" | "lead"

function playVoice(voice: Voice, freq = 330) {
  const ac = ctx()
  if (!ac) return
  const t = ac.currentTime
  const out = ac.createGain()
  out.connect(ac.destination)

  if (voice === "kick") {
    const osc = ac.createOscillator()
    osc.type = "sine"
    osc.frequency.setValueAtTime(150, t)
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.13)
    out.gain.setValueAtTime(0.5, t)
    out.gain.exponentialRampToValueAtTime(0.001, t + 0.16)
    osc.connect(out)
    osc.start(t)
    osc.stop(t + 0.18)
  } else if (voice === "snare" || voice === "hat") {
    const src = ac.createBufferSource()
    src.buffer = noiseBuffer(ac, 0.15)
    const filter = ac.createBiquadFilter()
    filter.type = voice === "hat" ? "highpass" : "bandpass"
    filter.frequency.value = voice === "hat" ? 7000 : 1800
    out.gain.setValueAtTime(voice === "hat" ? 0.12 : 0.22, t)
    out.gain.exponentialRampToValueAtTime(0.001, t + (voice === "hat" ? 0.045 : 0.11))
    src.connect(filter)
    filter.connect(out)
    src.start(t)
    src.stop(t + 0.15)
  } else {
    const osc = ac.createOscillator()
    osc.type = "sawtooth"
    osc.frequency.value = freq
    const filter = ac.createBiquadFilter()
    filter.type = "lowpass"
    filter.frequency.setValueAtTime(2400, t)
    filter.frequency.exponentialRampToValueAtTime(500, t + 0.22)
    out.gain.setValueAtTime(0.11, t)
    out.gain.exponentialRampToValueAtTime(0.001, t + 0.24)
    osc.connect(filter)
    filter.connect(out)
    osc.start(t)
    osc.stop(t + 0.26)
  }
}

/* --------------------------------------------------------- */
/* Beat clock: current 16th-note step via rAF, loop of `len`. */
/* --------------------------------------------------------- */

function useStepClock(len: number, onStep: (step: number) => void) {
  const onStepRef = useRef(onStep)
  onStepRef.current = onStep
  useEffect(() => {
    let raf = 0
    let last = -1
    const t0 = performance.now()
    const tick = (now: number) => {
      const step = Math.floor((now - t0) / STEP_MS) % len
      if (step !== last) {
        last = step
        onStepRef.current(step)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [len])
}

/* ----------------------------------------------- */
/* Shared burst canvas: rings, flashes, particles.  */
/* ----------------------------------------------- */

type Burst = {
  kind: "ring" | "flash" | "spark" | "beam"
  x: number
  y: number
  born: number
  hue: string
}

function useBurstCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const burstsRef = useRef<Burst[]>([])

  const fire = useCallback((kind: Burst["kind"], hue: string) => {
    const canvas = canvasRef.current
    if (!canvas) return
    burstsRef.current.push({
      kind,
      x: (0.15 + Math.random() * 0.7) * canvas.width,
      y: (0.2 + Math.random() * 0.6) * canvas.height,
      born: performance.now(),
      hue,
    })
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const g = canvas.getContext("2d")
    if (!g) return

    const resize = () => {
      canvas.width = canvas.offsetWidth * devicePixelRatio
      canvas.height = canvas.offsetHeight * devicePixelRatio
    }
    resize()
    window.addEventListener("resize", resize)

    let raf = 0
    const draw = (now: number) => {
      g.clearRect(0, 0, canvas.width, canvas.height)
      burstsRef.current = burstsRef.current.filter((b) => now - b.born < 700)
      for (const b of burstsRef.current) {
        const age = (now - b.born) / 700 // 0..1
        const fade = 1 - age
        g.globalAlpha = fade
        if (b.kind === "ring") {
          g.strokeStyle = b.hue
          g.lineWidth = 2.5 * devicePixelRatio * fade
          g.beginPath()
          g.arc(b.x, b.y, age * 130 * devicePixelRatio, 0, Math.PI * 2)
          g.stroke()
        } else if (b.kind === "flash") {
          const r = 90 * devicePixelRatio
          const grad = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, r)
          grad.addColorStop(0, b.hue)
          grad.addColorStop(1, "transparent")
          g.globalAlpha = fade * 0.55
          g.fillStyle = grad
          g.fillRect(b.x - r, b.y - r, r * 2, r * 2)
        } else if (b.kind === "spark") {
          g.fillStyle = b.hue
          for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2
            const d = age * 70 * devicePixelRatio
            g.beginPath()
            g.arc(b.x + Math.cos(a) * d, b.y + Math.sin(a) * d, 2.2 * devicePixelRatio * fade, 0, Math.PI * 2)
            g.fill()
          }
        } else {
          g.strokeStyle = b.hue
          g.lineWidth = 1.5 * devicePixelRatio * fade
          g.beginPath()
          g.moveTo(b.x, 0)
          g.lineTo(b.x, canvas.height)
          g.stroke()
        }
      }
      g.globalAlpha = 1
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
    }
  }, [])

  return { canvasRef, fire }
}

/* =========================== Variant A =========================== */

const A_ROWS: { name: string; voice: Voice; kind: Burst["kind"]; color: string }[] = [
  { name: "Kick", voice: "kick", kind: "flash", color: "#35a7e6" },
  { name: "Snare", voice: "snare", kind: "ring", color: "#9f7aea" },
  { name: "Hat", voice: "hat", kind: "spark", color: "#5fd3c0" },
  { name: "Lead", voice: "lead", kind: "beam", color: "#e6e6e6" },
]

const A_SEED = [
  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
  [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0],
  [0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
]

function VariantA({ sound }: { sound: boolean }) {
  const [grid, setGrid] = useState(A_SEED)
  const [step, setStep] = useState(0)
  const { canvasRef, fire } = useBurstCanvas()
  const gridRef = useRef(grid)
  gridRef.current = grid
  const soundRef = useRef(sound)
  soundRef.current = sound

  useStepClock(16, (s) => {
    setStep(s)
    gridRef.current.forEach((row, r) => {
      if (row[s]) {
        fire(A_ROWS[r].kind, A_ROWS[r].color)
        if (soundRef.current) playVoice(A_ROWS[r].voice, [0, 0, 0, 262][r] || 262)
      }
    })
  })

  return (
    <section className="relative flex min-h-[100svh] flex-col items-center justify-center gap-10 overflow-hidden px-5 py-20 text-center">
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      <div className="relative flex flex-col items-center gap-5">
        <p className="m-0 font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--accent)]">
          Patterns, not keyframes
        </p>
        <h1 className="m-0 max-w-[820px] text-[40px] font-bold leading-[1.04] tracking-[-0.03em] sm:text-[64px]">
          Play your visuals.
        </h1>
        <p className="m-0 max-w-[540px] text-[15px] leading-[1.55] text-[var(--text-3)] sm:text-[17px]">
          This grid is live — toggle a pad. Every hit is a note, every note is
          light. That&apos;s the whole idea.
        </p>
      </div>

      <div className="relative rounded-xl border border-[var(--border-strong)] bg-[rgba(10,10,10,0.82)] p-3 shadow-[0_28px_90px_-30px_rgba(0,0,0,0.9)] backdrop-blur-sm">
        {A_ROWS.map((row, r) => (
          <div key={row.name} className="mb-1.5 flex items-center gap-1.5 last:mb-0">
            <span className="w-12 shrink-0 text-right font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
              {row.name}
            </span>
            {grid[r].map((on, c) => (
              <button
                key={c}
                aria-label={`${row.name} step ${c + 1}`}
                onClick={() =>
                  setGrid((prev) =>
                    prev.map((rw, ri) => (ri === r ? rw.map((v, ci) => (ci === c ? (v ? 0 : 1) : v)) : rw)),
                  )
                }
                className="h-7 w-5 cursor-pointer rounded-[3px] border transition-all duration-75 sm:h-8 sm:w-7"
                style={{
                  borderColor: c === step ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.08)",
                  backgroundColor: on
                    ? c === step
                      ? "#ffffff"
                      : row.color
                    : c % 4 === 0
                      ? "rgba(255,255,255,0.06)"
                      : "rgba(255,255,255,0.02)",
                  boxShadow: on && c === step ? `0 0 18px ${row.color}` : undefined,
                }}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="relative flex flex-col items-center gap-3">
        <span className="inline-flex h-12 cursor-pointer items-center rounded-lg bg-[var(--accent)] px-8 text-[15px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)]">
          Start playing — it&apos;s free
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
          No signup · your first pattern in 60 seconds
        </span>
      </div>
    </section>
  )
}

/* =========================== Variant B =========================== */

// Two bars, 32 sixteenths. A motif (bar 1) that repeats varied (bar 2) —
// the "patterns repeat, nest, evolve" argument in one glance.
const B_NOTES: { pitch: number; start: number; len: number }[] = [
  { pitch: 7, start: 0, len: 2 }, { pitch: 5, start: 2, len: 2 }, { pitch: 3, start: 4, len: 4 },
  { pitch: 7, start: 8, len: 2 }, { pitch: 5, start: 10, len: 2 }, { pitch: 2, start: 12, len: 4 },
  { pitch: 7, start: 16, len: 2 }, { pitch: 5, start: 18, len: 2 }, { pitch: 3, start: 20, len: 4 },
  { pitch: 8, start: 24, len: 2 }, { pitch: 6, start: 26, len: 2 }, { pitch: 4, start: 28, len: 4 },
  { pitch: 0, start: 0, len: 8 }, { pitch: 0, start: 16, len: 8 }, { pitch: 1, start: 24, len: 8 },
]

const B_COLORS = ["#35a7e6", "#3f7f7c", "#5fd3c0", "#9f7aea", "#b58aff", "#35a7e6", "#5fd3c0", "#9f7aea", "#e6e6e6"]
const B_FREQS = [131, 147, 165, 196, 220, 262, 294, 330, 392]

function VariantB({ sound }: { sound: boolean }) {
  const [step, setStep] = useState(0)
  const { canvasRef, fire } = useBurstCanvas()
  const soundRef = useRef(sound)
  soundRef.current = sound

  useStepClock(32, (s) => {
    setStep(s)
    for (const note of B_NOTES) {
      if (note.start === s) {
        const kinds: Burst["kind"][] = ["flash", "ring", "spark", "beam"]
        fire(kinds[note.pitch % 4], B_COLORS[note.pitch])
        if (soundRef.current) playVoice(note.pitch <= 1 ? "kick" : "lead", B_FREQS[note.pitch])
      }
    }
  })

  return (
    <section className="relative flex min-h-[100svh] flex-col items-center justify-center gap-9 overflow-hidden px-5 py-20 text-center">
      <div className="relative flex flex-col items-center gap-5">
        <p className="m-0 font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--accent)]">
          MIDI in, light out
        </p>
        <h1 className="m-0 max-w-[880px] text-[40px] font-bold leading-[1.04] tracking-[-0.03em] sm:text-[64px]">
          It&apos;s not an edit.
          <br />
          It&apos;s music.
        </h1>
        <p className="m-0 max-w-[560px] text-[15px] leading-[1.55] text-[var(--text-3)] sm:text-[17px]">
          Video editors cut. Musicians compose. Cabin patterns repeat, nest, and
          evolve over time — because they&apos;re written the way music is.
        </p>
      </div>

      <div className="relative w-full max-w-[760px] overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-app)] shadow-[0_28px_90px_-30px_rgba(0,0,0,0.9)]">
        {/* mock render viewport fed by the roll */}
        <div className="relative h-[190px] border-b border-[var(--border)] bg-[#05060a] sm:h-[230px]">
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-[8px] uppercase tracking-[0.11em] text-white/45">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_6px_var(--accent)]" />
            Live
          </span>
        </div>
        {/* piano roll */}
        <div className="relative h-[150px] sm:h-[170px]">
          <div
            className="absolute inset-0 opacity-60"
            style={{
              backgroundImage:
                "linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(rgba(255,255,255,.03) 1px, transparent 1px)",
              backgroundSize: `${100 / 8}% ${100 / 9}%`,
            }}
          />
          {B_NOTES.map((note, i) => (
            <span
              key={i}
              className="absolute rounded-[2px] border border-white/15 transition-shadow"
              style={{
                left: `${(note.start / 32) * 100}%`,
                width: `${(note.len / 32) * 100}%`,
                top: `${((8 - note.pitch) / 9) * 100 + 1}%`,
                height: `${100 / 9 - 2}%`,
                backgroundColor: B_COLORS[note.pitch],
                opacity: step >= note.start && step < note.start + note.len ? 1 : 0.55,
                boxShadow:
                  step >= note.start && step < note.start + note.len
                    ? `0 0 14px ${B_COLORS[note.pitch]}`
                    : undefined,
              }}
            />
          ))}
          <span
            className="absolute inset-y-0 z-10 w-px bg-white/80 shadow-[0_0_8px_rgba(255,255,255,0.7)]"
            style={{ left: `${((step + 0.5) / 32) * 100}%` }}
          />
          <span className="absolute bottom-1.5 left-2 font-mono text-[8px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Pattern · Laser Sphere · 2 bars
          </span>
        </div>
      </div>

      <div className="relative flex flex-col items-center gap-3">
        <span className="inline-flex h-12 cursor-pointer items-center rounded-lg bg-[var(--accent)] px-8 text-[15px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)]">
          Compose your first visual
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
          If you can read a piano roll, you already know how
        </span>
      </div>
    </section>
  )
}

/* =========================== Variant C =========================== */

const C_WORDS = ["BECOME", "THE BEST", "VJ", "IN THE WORLD"]

function VariantC() {
  const [beat, setBeat] = useState(0)
  useStepClock(16, (s) => {
    if (s % 4 === 0) setBeat(s / 4)
  })

  return (
    <section className="relative flex min-h-[100svh] flex-col items-center justify-center gap-12 overflow-hidden px-5 py-20 text-center">
      {/* stage: slow radial pulse + floor grid */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 42%, rgba(53,167,230,0.16), transparent 70%), radial-gradient(ellipse 45% 35% at 50% 100%, rgba(159,122,234,0.12), transparent 70%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%] opacity-25"
        style={{
          backgroundImage:
            "linear-gradient(rgba(53,167,230,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(53,167,230,.35) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          transform: "perspective(420px) rotateX(58deg)",
          transformOrigin: "bottom",
          maskImage: "linear-gradient(to top, black 30%, transparent)",
        }}
      />

      <div className="relative flex flex-col items-center gap-7">
        <p className="m-0 font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--accent)]">
          Cabin is the instrument
        </p>
        <h1 className="m-0 flex max-w-[900px] flex-col items-center gap-1 text-[44px] font-bold leading-[0.98] tracking-[-0.03em] sm:text-[76px]">
          {C_WORDS.map((word, i) => (
            <span
              key={word}
              className="transition-all duration-150"
              style={{
                transform: beat === i ? "scale(1.045)" : "scale(1)",
                color: beat === i ? "#ffffff" : "var(--text)",
                textShadow: beat === i ? "0 0 42px rgba(53,167,230,0.65)" : "none",
              }}
            >
              {word}
            </span>
          ))}
        </h1>
        <p className="m-0 max-w-[520px] text-[15px] leading-[1.55] text-[var(--text-3)] sm:text-[17px]">
          Not a video editor. An instrument you practice, master, and perform.
          The stage is rendering at 60fps — take it.
        </p>
      </div>

      <div className="relative flex flex-col items-center gap-3">
        <span className="inline-flex h-12 cursor-pointer items-center rounded-lg bg-[var(--accent)] px-8 text-[15px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)]">
          Start your set
        </span>
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full transition-all duration-150"
              style={{
                backgroundColor: beat === i ? "var(--accent)" : "rgba(255,255,255,0.15)",
                boxShadow: beat === i ? "0 0 8px var(--accent)" : "none",
              }}
            />
          ))}
          {BPM} BPM
        </span>
      </div>
    </section>
  )
}

/* =========================== Variant D =========================== */
/* The flow: hero pull → full-bleed visual → scroll zooms out and the
 * editor assembles around the same canvas ("MIDI in. Light out.") →
 * detail cards → CTA. One beat clock drives headline, canvas, and roll. */

const D_RING_COLORS = ["#35a7e6", "#9f7aea", "#5fd3c0", "#b58aff"]

type Beam = { angle: number; born: number; hue: string }

/** Trail-fade canvas: rotating dashed rings + orbiting particles that swell
 *  with `energyRef`, radial beams pushed into `beamsRef` on note hits. */
function useEngineCanvas(energyRef: { current: number }, beamsRef: { current: Beam[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const g = canvas.getContext("2d")
    if (!g) return

    const resize = () => {
      canvas.width = canvas.offsetWidth * devicePixelRatio
      canvas.height = canvas.offsetHeight * devicePixelRatio
      g.fillStyle = "#04050a"
      g.fillRect(0, 0, canvas.width, canvas.height)
    }
    resize()
    window.addEventListener("resize", resize)

    let raf = 0
    const draw = (now: number) => {
      const w = canvas.width
      const h = canvas.height
      const cx = w / 2
      const cy = h / 2
      const base = Math.min(w, h)
      const t = now / 1000
      energyRef.current *= 0.955
      const energy = energyRef.current

      // trail fade instead of clear -> motion streaks
      g.fillStyle = "rgba(4,5,10,0.17)"
      g.fillRect(0, 0, w, h)

      // beams
      beamsRef.current = beamsRef.current.filter((b) => now - b.born < 460)
      for (const b of beamsRef.current) {
        const age = (now - b.born) / 460
        g.globalAlpha = (1 - age) * 0.8
        g.strokeStyle = b.hue
        g.lineWidth = (1 - age) * 2.4 * devicePixelRatio
        g.beginPath()
        g.moveTo(cx, cy)
        g.lineTo(cx + Math.cos(b.angle) * base * 0.75, cy + Math.sin(b.angle) * base * 0.75)
        g.stroke()
      }
      g.globalAlpha = 1

      // rotating dashed rings
      for (let i = 0; i < 4; i++) {
        const r = base * (0.14 + 0.075 * i) * (1 + energy * (i === 0 ? 0.16 : 0.07))
        g.strokeStyle = D_RING_COLORS[i]
        g.globalAlpha = 0.55 - i * 0.08 + energy * 0.25
        g.lineWidth = (i === 0 ? 2.2 : 1.3) * devicePixelRatio
        g.setLineDash([r * (0.5 + i * 0.18), r * 0.32])
        g.lineDashOffset = t * r * (i % 2 === 0 ? 0.35 : -0.28)
        g.beginPath()
        g.arc(cx, cy, r, 0, Math.PI * 2)
        g.stroke()
      }
      g.setLineDash([])
      g.globalAlpha = 1

      // orbiting particles on a golden-angle spiral
      for (let i = 0; i < 56; i++) {
        const angle = i * 2.39996 + t * (0.22 + (i % 5) * 0.03)
        const r = base * (0.06 + (i / 56) * 0.44) * (1 + energy * 0.05)
        const size = (1 + (i % 3)) * 0.9 * devicePixelRatio * (1 + energy * 0.6)
        g.fillStyle = D_RING_COLORS[i % 4]
        g.globalAlpha = 0.35 + energy * 0.45
        g.beginPath()
        g.arc(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, size, 0, Math.PI * 2)
        g.fill()
      }
      g.globalAlpha = 1

      // core
      const coreR = (3.5 + energy * 9) * devicePixelRatio
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, coreR * 5)
      grad.addColorStop(0, "rgba(255,255,255,0.95)")
      grad.addColorStop(0.25, "rgba(86,198,255,0.5)")
      grad.addColorStop(1, "transparent")
      g.fillStyle = grad
      g.fillRect(cx - coreR * 5, cy - coreR * 5, coreR * 10, coreR * 10)

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
    }
  }, [energyRef, beamsRef])

  return canvasRef
}

/** Fluid hero background: blue ink-blobs drifting on layered sine paths with
 *  long additive trails, swelling slightly with the pattern's energy. */
function useFluidCanvas(energyRef: { current: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const g = canvas.getContext("2d")
    if (!g) return

    const resize = () => {
      canvas.width = canvas.offsetWidth * devicePixelRatio
      canvas.height = canvas.offsetHeight * devicePixelRatio
      g.fillStyle = "#050a14"
      g.fillRect(0, 0, canvas.width, canvas.height)
    }
    resize()
    window.addEventListener("resize", resize)

    const BLOBS = [
      { c: "#0e5a94", s: 0.05, p: 0.0, r: 0.34 },
      { c: "#35a7e6", s: 0.071, p: 1.7, r: 0.26 },
      { c: "#123f6b", s: 0.043, p: 3.1, r: 0.4 },
      { c: "#5fd3c0", s: 0.089, p: 4.4, r: 0.18 },
      { c: "#9f7aea", s: 0.061, p: 5.6, r: 0.22 },
      { c: "#0b3b66", s: 0.055, p: 2.4, r: 0.36 },
      { c: "#56c6ff", s: 0.096, p: 0.9, r: 0.15 },
    ]

    let raf = 0
    const draw = (now: number) => {
      const w = canvas.width
      const h = canvas.height
      const t = now / 1000
      const energy = energyRef.current

      g.globalCompositeOperation = "source-over"
      g.fillStyle = "rgba(4,7,15,0.055)"
      g.fillRect(0, 0, w, h)
      g.globalCompositeOperation = "lighter"
      for (const b of BLOBS) {
        const x = w * (0.5 + 0.34 * Math.sin(t * b.s * 2.1 + b.p) + 0.13 * Math.sin(t * b.s * 3.7 + b.p * 2.3))
        const y = h * (0.46 + 0.3 * Math.cos(t * b.s * 1.7 + b.p * 1.4) + 0.12 * Math.sin(t * b.s * 2.9 + b.p))
        const r = Math.min(w, h) * b.r * (1 + energy * 0.13)
        const grad = g.createRadialGradient(x, y, 0, x, y, r)
        grad.addColorStop(0, `${b.c}2e`)
        grad.addColorStop(0.55, `${b.c}14`)
        grad.addColorStop(1, "transparent")
        g.fillStyle = grad
        g.fillRect(x - r, y - r, r * 2, r * 2)
      }
      g.globalCompositeOperation = "source-over"
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
    }
  }, [energyRef])

  return canvasRef
}

/** The hero CTA with the real landing page's glow treatment (same keyframes
 *  already live in globals.css), so "Start creating" gets its showcase. */
function LabCta({ label }: { label: string }) {
  return (
    <span className="group relative inline-flex">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-2.5 rounded-2xl bg-[var(--accent)] opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-35 motion-safe:animate-[landing-glow-breathe_3s_ease-in-out_infinite]"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-px overflow-hidden rounded-[9px] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      >
        <span className="absolute left-1/2 top-1/2 aspect-square w-[220%] -translate-x-1/2 -translate-y-1/2 bg-[conic-gradient(from_0deg,transparent_0deg,rgba(255,255,255,0.55)_55deg,transparent_115deg)] motion-safe:animate-[landing-glow-spin_3.5s_linear_infinite]" />
      </span>
      <span className="relative z-10 inline-flex h-12 cursor-pointer items-center justify-center rounded-lg bg-[var(--accent)] px-8 text-[15px] font-bold text-[var(--on-accent)] transition-colors duration-200 hover:bg-[var(--accent-hover)]">
        {label}
      </span>
    </span>
  )
}

/** Drop a real export at public/landing/hero-visual.mp4 and it plays here;
 *  until then the canvas engine mock stands in underneath. */
const D_VIDEO_SRC = "/landing/hero-visual.mp4"

function VideoOrEngine({
  energyRef,
  beamsRef,
  className,
}: {
  energyRef: { current: number }
  beamsRef: { current: Beam[] }
  className?: string
}) {
  const [videoOk, setVideoOk] = useState(true)
  const canvasRef = useEngineCanvas(energyRef, beamsRef)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  // A missing file errors before hydration, so onError alone can miss it —
  // also inspect the element's error state once mounted.
  useEffect(() => {
    const video = videoRef.current
    if (video && (video.error || video.networkState === 3)) setVideoOk(false)
  }, [])

  return (
    <div className={`relative overflow-hidden bg-[#04050a] ${className ?? ""}`}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {videoOk && (
        <video
          ref={videoRef}
          src={D_VIDEO_SRC}
          autoPlay
          muted
          loop
          playsInline
          onError={() => setVideoOk(false)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  )
}

const D_CARDS = [
  {
    title: "Compose",
    body: "Every visual is a MIDI pattern. Write riffs of light in a piano roll you already know how to play.",
  },
  {
    title: "Layer",
    body: "Stack instruments — laser spheres, tunnels, text — into scenes, the way you stack tracks in a mix.",
  },
  {
    title: "Perform",
    body: "Arrange scenes into a set, hit export, and the whole show renders in sync with the song.",
  },
]

function VariantD({ sound }: { sound: boolean }) {
  const [step, setStep] = useState(0)
  const soundRef = useRef(sound)
  soundRef.current = sound
  const energyRef = useRef(0.6)
  const beamsRef = useRef<Beam[]>([])
  const fluidRef = useFluidCanvas(energyRef)

  useStepClock(32, (s) => {
    setStep(s)
    for (const note of B_NOTES) {
      if (note.start === s) {
        energyRef.current = Math.min(1.5, energyRef.current + (note.pitch <= 1 ? 0.85 : 0.3))
        beamsRef.current.push({ angle: Math.random() * Math.PI * 2, born: performance.now(), hue: B_COLORS[note.pitch] })
        if (soundRef.current) playVoice(note.pitch <= 1 ? "kick" : "lead", B_FREQS[note.pitch])
      }
    }
  })

  return (
    <div>
      {/* ---- Hero: the pull ---- */}
      <section className="relative flex min-h-[100svh] flex-col items-center justify-center gap-10 overflow-hidden px-5 text-center">
        <canvas ref={fluidRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        {/* vignette keeps the type legible over the fluid */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 120% 90% at 50% 45%, transparent 40%, rgba(4,7,15,0.82) 100%)",
          }}
        />
        <div className="relative flex flex-col items-center gap-7">
          {/* difference-blend on every text element: the fluid passing behind
              the letters inverts inside them. Pure white inverts hardest, so
              hierarchy comes from size/weight rather than gray tones (grays
              wash out under difference). */}
          <p
            className="m-0 font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-white/80"
            style={{ mixBlendMode: "difference" }}
          >
            The visual instrument
          </p>
          <h1
            className="m-0 max-w-[880px] text-[40px] font-bold leading-[1.06] tracking-[-0.03em] text-white sm:text-[64px]"
            style={{ mixBlendMode: "difference" }}
          >
            Create insanely great visuals for music
          </h1>
          <p
            className="m-0 max-w-[540px] text-[15px] font-medium leading-[1.55] text-white/90 sm:text-[17px]"
            style={{ mixBlendMode: "difference" }}
          >
            Write patterns in MIDI. Sequence them like a song. Watch them play
            in light.
          </p>
        </div>
        <div className="relative flex flex-col items-center gap-3">
          <LabCta label="Start creating" />
          <span
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/70"
            style={{ mixBlendMode: "difference" }}
          >
            No signup · your first pattern in 60 seconds
          </span>
        </div>
        <ChevronDown
          size={22}
          className="relative text-white/70"
          style={{ mixBlendMode: "difference" }}
        />
      </section>

      {/* ---- The visual, simply present ---- */}
      <section className="relative">
        <VideoOrEngine energyRef={energyRef} beamsRef={beamsRef} className="h-[92svh]" />
        <span className="absolute bottom-4 left-4 flex items-center gap-1.5 rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[8px] uppercase tracking-[0.11em] text-white/50 backdrop-blur-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_6px_var(--accent)]" />
          Made in Cabin
        </span>
      </section>

      {/* ---- The app generating it ---- */}
      <section className="mx-auto w-[min(940px,94vw)] py-24">
        <div className="mb-10 text-center">
          <p className="m-0 font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--accent)]">
            MIDI in. Light out.
          </p>
          <p className="mx-auto mt-3 mb-0 max-w-[480px] text-[15px] leading-[1.55] text-[var(--text-3)]">
            The same visual, open in the editor — the pattern below is writing
            it, note by note.
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-app)] shadow-[0_28px_90px_-30px_rgba(0,0,0,0.9)]">
          {/* top bar */}
          <div className="flex h-11 items-center gap-3 bg-[var(--bg-topbar)] px-3">
            <ChevronLeft size={13} className="shrink-0 text-[var(--text-3)]" />
            <span className="truncate text-[11px] font-medium text-[var(--text)]">Midnight Drive</span>
            <span className="ml-auto flex items-center gap-2">
              <span className="hidden font-mono text-[9px] text-[var(--text-muted)] sm:inline">{BPM} BPM</span>
              <span className="flex h-6 w-7 items-center justify-center rounded bg-[rgba(53,167,230,0.15)] text-[var(--accent)]">
                <Play size={11} fill="currentColor" />
              </span>
              <span className="inline-flex h-7 items-center gap-1.5 rounded bg-[var(--accent)] px-2.5 text-[9px] font-bold text-[var(--on-accent)]">
                <Upload size={11} />
                Export
              </span>
            </span>
          </div>

          {/* live viewport — the same visual, inside the app */}
          <div className="relative h-[46svh] min-h-[260px]">
            <VideoOrEngine energyRef={energyRef} beamsRef={beamsRef} className="h-full" />
            <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-[8px] uppercase tracking-[0.11em] text-white/45">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_6px_var(--accent)]" />
              Main · 16:9
            </span>
          </div>

          {/* piano roll driving it */}
          <div className="relative h-[130px] border-t border-[var(--border)] sm:h-[150px]">
                <div
                  className="absolute inset-0 opacity-60"
                  style={{
                    backgroundImage:
                      "linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(rgba(255,255,255,.03) 1px, transparent 1px)",
                    backgroundSize: `${100 / 8}% ${100 / 9}%`,
                  }}
                />
                {B_NOTES.map((note, i) => (
                  <span
                    key={i}
                    className="absolute rounded-[2px] border border-white/15"
                    style={{
                      left: `${(note.start / 32) * 100}%`,
                      width: `${(note.len / 32) * 100}%`,
                      top: `${((8 - note.pitch) / 9) * 100 + 1}%`,
                      height: `${100 / 9 - 2}%`,
                      backgroundColor: B_COLORS[note.pitch],
                      opacity: step >= note.start && step < note.start + note.len ? 1 : 0.55,
                      boxShadow:
                        step >= note.start && step < note.start + note.len
                          ? `0 0 14px ${B_COLORS[note.pitch]}`
                          : undefined,
                    }}
                  />
                ))}
                <span
                  className="absolute inset-y-0 z-10 w-px bg-white/80 shadow-[0_0_8px_rgba(255,255,255,0.7)]"
                  style={{ left: `${((step + 0.5) / 32) * 100}%` }}
                />
                <span className="absolute bottom-1.5 left-2 font-mono text-[8px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  Pattern · Laser Sphere · 2 bars
                </span>
          </div>
        </div>
      </section>

      {/* ---- More detail ---- */}
      <section className="mx-auto flex w-full max-w-[1000px] flex-col items-center gap-12 px-5 py-28 text-center">
        <div className="flex flex-col items-center gap-3">
          <p className="m-0 font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--accent)]">
            Sequence it. Loop it. Perform it.
          </p>
          <h2 className="m-0 text-[28px] font-bold tracking-[-0.02em] sm:text-[40px]">
            Built like a DAW. Plays like light.
          </h2>
        </div>
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
          {D_CARDS.map((card) => (
            <div
              key={card.title}
              className="rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-6 text-left"
            >
              <h3 className="m-0 mb-2 text-[16px] font-semibold">{card.title}</h3>
              <p className="m-0 text-[13px] leading-[1.6] text-[var(--text-3)]">{card.body}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-col items-center gap-3">
          <span className="inline-flex h-12 cursor-pointer items-center rounded-lg bg-[var(--accent)] px-8 text-[15px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)]">
            Start creating — it&apos;s free
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
            No signup · your first pattern in 60 seconds
          </span>
        </div>
      </section>
    </div>
  )
}

/* ============================= Page ============================= */

const VARIANTS = [
  { key: "a", label: "A · Play it", blurb: "Interactive pad grid — the page is the demo" },
  { key: "b", label: "B · It's music", blurb: "Piano roll drives the render — the musicality argument" },
  { key: "c", label: "C · Best VJ", blurb: "Ambition manifesto — type on the beat" },
  { key: "d", label: "D · The flow", blurb: "Hero → visual → the app generating it → detail" },
] as const

type VariantKey = (typeof VARIANTS)[number]["key"]

export default function LandingLabPage() {
  const [active, setActive] = useState<VariantKey>("d")
  const [sound, setSound] = useState(false)

  return (
    <div className="min-h-screen bg-[var(--bg-page)] font-sans text-[var(--text)]">
      {/* prototype switcher */}
      <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 border-b border-[var(--border-subtle)] bg-[rgba(10,10,10,0.85)] px-3 py-2.5 backdrop-blur-md">
        <span className="mr-1 hidden font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--text-muted)] sm:inline">
          Landing lab
        </span>
        {VARIANTS.map((v) => (
          <button
            key={v.key}
            onClick={() => setActive(v.key)}
            title={v.blurb}
            className={`h-8 cursor-pointer rounded-[5px] px-3 text-[12px] font-medium transition-colors ${
              active === v.key
                ? "bg-[var(--accent)] text-[var(--on-accent)]"
                : "border border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]"
            }`}
          >
            {v.label}
          </button>
        ))}
        <button
          onClick={() => {
            ctx() // user gesture: unlock audio
            setSound((s) => !s)
          }}
          className={`ml-2 h-8 cursor-pointer rounded-[5px] border px-3 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors ${
            sound
              ? "border-[var(--accent)] text-[var(--accent)]"
              : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          Sound {sound ? "on" : "off"}
        </button>
      </div>

      {active === "a" && <VariantA sound={sound} />}
      {active === "b" && <VariantB sound={sound} />}
      {active === "c" && <VariantC />}
      {active === "d" && <VariantD sound={sound} />}

      <p className="pointer-events-none fixed bottom-3 left-1/2 z-50 m-0 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
        Prototype — mocks only, not the real engine
      </p>
    </div>
  )
}

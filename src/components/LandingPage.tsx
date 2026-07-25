"use client"

import { type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { MotionConfig } from "framer-motion"
import {
  ChevronLeft,
  Layers3,
  PanelLeft,
  Pause,
  Play,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Upload,
} from "lucide-react"
import { CabinLogo } from "./CabinLogo"
import { SiteHeader } from "./SiteHeader"
import { Appear, Reveal } from "./motionPresets"
import { ProfileMenu } from "./ProfileMenu"
import { useAuth } from "../persistence/hooks/useAuth"
import { getLastProjectId } from "../persistence/lastProject"
import { track } from "../analytics/analytics"

const VISUAL_EXAMPLES = [
  { id: "8jPhqXtWIUw", title: "Cabin Visuals example 1" },
  { id: "6dU7HrvZNbY", title: "Cabin Visuals example 2" },
  { id: "M61NUKQFCJg", title: "Cabin Visuals example 3" },
  { id: "7rfGIBAizbA", title: "Cabin Visuals example 4" },
]

const SOCIAL_LINKS = [
  {
    label: "Instagram",
    href: "https://www.instagram.com/cabin_visuals/",
    path: "M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06zM12 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm7.846-10.405a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0z",
  },
  {
    label: "TikTok",
    href: "https://www.tiktok.com/@cabinvisuals?lang=en",
    path: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
  },
  {
    label: "YouTube",
    href: "https://www.youtube.com/@CabinVisuals",
    path: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
  },
  {
    label: "X",
    href: "https://x.com/Cabin_Visuals",
    path: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  },
  {
    label: "Discord",
    href: "https://discord.gg/ZrbQMFwCsb",
    path: "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z",
  },
]

const CTA_CLASSES =
  "relative z-10 inline-flex h-12 items-center justify-center rounded-lg bg-[var(--accent)] px-8 text-[15px] font-bold text-[var(--on-accent)] transition-colors duration-200 hover:bg-[var(--accent-hover)] cursor-pointer"

/** Hover-only halo behind the hero CTA: a blurred accent glow that breathes,
 *  plus a thin conic highlight sweeping the button's edge. Both fade in via
 *  the wrapper's group-hover so the resting state stays quiet. */
function CtaGlow({ children }: { children: ReactNode }) {
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
      {children}
    </span>
  )
}

const LIBRARY_ITEMS = [
  { label: "Laser Sphere", color: "#35a7e6" },
  { label: "Text", color: "#9f7aea" },
  { label: "Photo", color: "#3f7f7c" },
]

const TIMELINE_TRACKS = [
  {
    name: "Audio",
    color: "#35a7e6",
    clips: [{ left: "1%", width: "97%", label: "Midnight Drive.wav", waveform: true }],
  },
  {
    name: "Laser Sphere",
    color: "#3a7694",
    clips: [
      { left: "2%", width: "28%", label: "Intro" },
      { left: "34%", width: "36%", label: "Chorus" },
      { left: "74%", width: "24%", label: "Outro" },
    ],
  },
  {
    name: "Title",
    color: "#76517f",
    clips: [
      { left: "8%", width: "19%", label: "MIDNIGHT" },
      { left: "52%", width: "22%", label: "DRIVE" },
    ],
  },
  {
    name: "Tunnel",
    color: "#3f7f7c",
    clips: [
      { left: "27%", width: "26%", label: "Orbit" },
      { left: "66%", width: "29%", label: "Flight" },
    ],
  },
]

/** A faithful, lightweight facsimile of Cabin's actual editor. This is kept
 *  entirely in the page (instead of embedding the real editor) so the landing
 *  page stays fast and the controls cannot accidentally modify a project. */
function AppShowcase() {
  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-4 -inset-y-8 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(53,167,230,0.14),transparent_66%)] blur-2xl"
      />
      <div className="mb-4 flex items-end justify-between gap-4 px-1">
        <div className="text-left">
          <p className="m-0 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
            The visual music workstation
          </p>
          <p className="mt-1.5 mb-0 text-[13px] text-[var(--text-3)]">
            Compose, sync, and finish the whole show in one place.
          </p>
        </div>
        <span className="hidden items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-panel)] px-3 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-muted)] sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_8px_var(--accent)]" />
          App preview
        </span>
      </div>

      <div
        aria-label="Preview of the Cabin Visuals music visualization editor"
        className="overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-app)] text-left shadow-[0_28px_90px_-30px_rgba(0,0,0,0.9),0_22px_70px_-40px_rgba(53,167,230,0.8)]"
      >
        {/* Editor top bar */}
        <div className="relative flex h-11 items-center gap-2 bg-[var(--bg-topbar)] px-2.5 sm:h-12 sm:gap-3 sm:px-3">
          <ChevronLeft size={13} className="shrink-0 text-[var(--text-3)]" />
          <span className="max-w-[120px] truncate text-[10px] font-medium text-[var(--text)] sm:max-w-none sm:text-xs">
            Midnight Drive
          </span>
          <div className="flex items-center gap-0.5 rounded-md bg-[var(--bg-elevated)] p-0.5">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-[rgba(53,167,230,0.13)] text-[var(--accent)]">
              <PanelLeft size={12} />
            </span>
            <span className="flex h-6 w-6 items-center justify-center rounded bg-[rgba(53,167,230,0.13)] text-[var(--accent)]">
              <SlidersHorizontal size={12} />
            </span>
          </div>

          <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-0.5 overflow-hidden rounded-md bg-[var(--bg-elevated)] p-0.5 sm:flex">
            <span className="flex h-6 w-7 items-center justify-center rounded text-[var(--text-3)]">
              <Pause size={10} fill="currentColor" />
            </span>
            <span className="flex h-6 w-7 items-center justify-center rounded bg-[rgba(53,167,230,0.15)] text-[var(--accent)]">
              <Play size={11} fill="currentColor" />
            </span>
            <span className="px-2 font-mono text-[9px] text-[var(--text-3)]">09.2.3</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden font-mono text-[9px] text-[var(--text-muted)] md:inline">124 BPM</span>
            <span className="inline-flex h-7 items-center gap-1.5 rounded bg-[var(--accent)] px-2.5 text-[9px] font-bold text-[var(--on-accent)] sm:px-3 sm:text-[10px]">
              <Upload size={11} />
              Export
            </span>
          </div>
        </div>

        {/* Library, inspector, and live canvas */}
        <div className="grid min-h-[290px] grid-cols-1 md:min-h-[385px] md:grid-cols-[180px_210px_minmax(0,1fr)]">
          <div className="hidden flex-col border-r border-[var(--border)] bg-[var(--bg-panel)] md:flex">
            <div className="flex h-8 items-center justify-between border-b border-[var(--border)] px-3">
              <span className="text-[10px] font-semibold text-[var(--text-2)]">Library</span>
              <Plus size={11} className="text-[var(--text-muted)]" />
            </div>
            <div className="p-2">
              <p className="m-0 px-1 pb-2 font-mono text-[8px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Objects
              </p>
              {LIBRARY_ITEMS.map((item, index) => (
                <div
                  key={item.label}
                  className={`mb-1 flex h-8 items-center gap-2 rounded px-2 text-[9px] ${
                    index === 0
                      ? "border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text)]"
                      : "text-[var(--text-3)]"
                  }`}
                >
                  <span
                    className="h-3.5 w-3.5 rounded-[3px] border border-white/10"
                    style={{ backgroundColor: item.color }}
                  />
                  {item.label}
                </div>
              ))}
              <p className="mt-4 mb-0 px-1 pb-2 font-mono text-[8px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Movement
              </p>
              {["Orbit", "Tunnel", "Audio Pulse"].map((label) => (
                <div key={label} className="flex h-7 items-center gap-2 px-2 text-[9px] text-[var(--text-3)]">
                  <Sparkles size={10} className="text-[var(--accent-muted)]" />
                  {label}
                </div>
              ))}
            </div>
          </div>

          <div className="hidden flex-col border-r border-[var(--border)] bg-[rgba(19,19,19,0.88)] md:flex">
            <div className="flex h-8 items-center border-b border-[var(--border)] px-3 text-[10px] font-semibold text-[var(--accent)]">
              Laser Sphere
            </div>
            <div className="grid h-7 grid-cols-2 border-b border-[var(--border)] text-[9px]">
              <span className="flex items-center justify-center border-r border-[var(--border)] bg-[var(--bg-app)] text-[var(--text)]">
                Instrument
              </span>
              <span className="flex items-center justify-center text-[var(--text-muted)]">Effects</span>
            </div>
            <div className="space-y-4 p-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-[var(--text-muted)]">In front</span>
                <span className="flex h-3.5 w-6 items-center justify-end rounded-full bg-[var(--accent)] p-0.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-white" />
                </span>
              </div>
              {[
                ["Radius", "64"],
                ["Thickness", "18"],
                ["Points", "96"],
                ["Audio gain", "72%"],
              ].map(([label, value], index) => (
                <div key={label}>
                  <div className="mb-1.5 flex items-center justify-between text-[9px]">
                    <span className="text-[var(--text-3)]">{label}</span>
                    <span className="font-mono text-[var(--text-muted)]">{value}</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-[var(--border)]">
                    <div
                      className="h-full rounded-full bg-[var(--accent-muted)]"
                      style={{ width: `${[64, 32, 82, 72][index]}%` }}
                    />
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1 text-[9px]">
                <span className="text-[var(--text-3)]">Color</span>
                <span className="h-5 w-10 rounded border border-white/10 bg-[#56c6ff] shadow-[0_0_12px_rgba(86,198,255,0.35)]" />
              </div>
            </div>
          </div>

          <div className="relative min-h-[290px] overflow-hidden bg-[var(--bg-canvas-deep)] md:min-h-[385px]">
            <div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(circle at 50% 48%, rgba(52, 150, 255, 0.18), transparent 23%), radial-gradient(circle at 24% 74%, rgba(139, 72, 255, 0.13), transparent 32%), linear-gradient(145deg, #05060a 10%, #080b15 58%, #080710 100%)",
              }}
            />
            <div
              className="absolute inset-0 opacity-[0.16]"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px)",
                backgroundSize: "38px 38px",
                maskImage: "linear-gradient(to bottom, transparent, black 35%, black 75%, transparent)",
              }}
            />
            <div className="absolute left-1/2 top-1/2 aspect-square w-[54%] max-w-[330px] -translate-x-1/2 -translate-y-1/2">
              <div className="absolute inset-[4%] rounded-full border border-cyan-300/20 shadow-[0_0_70px_rgba(53,167,230,0.22),inset_0_0_50px_rgba(95,61,255,0.12)]" />
              <div className="absolute inset-[13%] rotate-[22deg] rounded-full border border-cyan-200/50 shadow-[0_0_16px_rgba(89,211,255,0.24)]" />
              <div className="absolute inset-[21%] -rotate-[18deg] rounded-full border border-violet-300/45" />
              <div className="absolute inset-[29%] rotate-[38deg] rounded-full border border-cyan-100/60 shadow-[0_0_22px_rgba(89,211,255,0.28)]" />
              <div className="absolute left-[7%] right-[7%] top-1/2 h-px rotate-[18deg] bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent shadow-[0_0_10px_#56c6ff]" />
              <div className="absolute bottom-[7%] top-[7%] left-1/2 w-px rotate-[32deg] bg-gradient-to-b from-transparent via-violet-300/60 to-transparent" />
              <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_16px_5px_rgba(86,198,255,0.75)]" />
              {[12, 28, 47, 67, 82].map((position, index) => (
                <span
                  key={position}
                  className="absolute h-1.5 w-1.5 rounded-full bg-cyan-100 shadow-[0_0_7px_2px_rgba(86,198,255,0.62)]"
                  style={{
                    left: `${position}%`,
                    top: `${[38, 75, 12, 68, 42][index]}%`,
                  }}
                />
              ))}
            </div>
            <div className="absolute inset-x-0 bottom-0 h-[34%] bg-gradient-to-t from-black/60 to-transparent" />
            <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-[8px] uppercase tracking-[0.11em] text-white/45 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_6px_var(--accent)]" />
              Main · 16:9
            </div>
            <div className="absolute right-3 top-3 rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-[8px] text-white/40 backdrop-blur-sm">
              1920 × 1080
            </div>
            <div className="absolute inset-x-0 bottom-[15%] text-center">
              <p className="m-0 text-[clamp(18px,3vw,38px)] font-bold tracking-[0.22em] text-white/90 drop-shadow-[0_0_18px_rgba(86,198,255,0.5)]">
                MIDNIGHT
              </p>
              <p className="mt-1 mb-0 font-mono text-[8px] uppercase tracking-[0.42em] text-cyan-200/55 sm:text-[9px]">
                audio reactive
              </p>
            </div>
          </div>
        </div>

        {/* Real editor scene tabs */}
        <div className="flex h-8 items-stretch border-y border-[var(--border)] bg-[var(--bg-panel)]">
          {["Verse", "Chorus", "Bridge", "Main"].map((scene, index) => (
            <span
              key={scene}
              className={`flex w-[72px] items-center justify-center border-r border-[var(--border-subtle)] text-[8px] sm:w-24 sm:text-[9px] ${
                index === 1
                  ? "bg-[var(--bg-app)] font-semibold text-[var(--text)]"
                  : "text-[var(--text-muted)]"
              }`}
            >
              {scene}
            </span>
          ))}
          <span className="ml-1 flex w-6 items-center justify-center text-[var(--text-muted)]">
            <Plus size={10} />
          </span>
          <span className="ml-auto hidden items-center gap-1.5 border-l border-[var(--border)] px-3 font-mono text-[8px] uppercase text-[var(--text-muted)] sm:flex">
            <Layers3 size={10} />
            All tracks
          </span>
        </div>

        {/* Music timeline */}
        <div className="bg-[var(--bg-timeline)]">
          <div className="grid grid-cols-[92px_minmax(0,1fr)] sm:grid-cols-[150px_minmax(0,1fr)]">
            <div className="border-r border-b border-[var(--border)] bg-[var(--bg-panel-raised)]" />
            <div className="grid h-6 grid-cols-4 border-b border-[var(--border)] px-2 font-mono text-[7px] text-[var(--text-muted)] sm:text-[8px]">
              {["1", "5", "9", "13"].map((bar) => (
                <span key={bar} className="border-l border-white/[0.04] pl-1 pt-1.5">{bar}</span>
              ))}
            </div>
            {TIMELINE_TRACKS.map((timelineTrack, trackIndex) => (
              <div key={timelineTrack.name} className="contents">
                <div className="flex h-8 items-center gap-2 border-r border-b border-[var(--border-subtle)] bg-[var(--bg-panel-raised)] px-2 sm:h-9">
                  <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: timelineTrack.color }} />
                  <span className="truncate text-[7px] text-[var(--text-3)] sm:text-[9px]">{timelineTrack.name}</span>
                </div>
                <div
                  className="relative h-8 overflow-hidden border-b border-[var(--border-subtle)] sm:h-9"
                  style={{
                    backgroundImage:
                      "linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px)",
                    backgroundSize: "25% 100%",
                  }}
                >
                  {timelineTrack.clips.map((clip, clipIndex) => (
                    <span
                      key={`${clip.label}-${clipIndex}`}
                      className="absolute top-1 bottom-1 overflow-hidden rounded-[2px] border border-white/10 px-1.5 pt-1 font-mono text-[6px] text-white/60 sm:text-[7px]"
                      style={{
                        left: clip.left,
                        width: clip.width,
                        backgroundColor: `${timelineTrack.color}b8`,
                        backgroundImage: "waveform" in clip && clip.waveform
                          ? "repeating-linear-gradient(90deg, transparent 0 3px, rgba(255,255,255,.28) 3px 4px, transparent 4px 7px)"
                          : undefined,
                      }}
                    >
                      <span className={"waveform" in clip && clip.waveform ? "bg-black/25 px-1" : ""}>{clip.label}</span>
                    </span>
                  ))}
                  {trackIndex === 0 && (
                    <span className="absolute inset-y-0 left-[43%] z-10 w-px bg-[var(--accent)] shadow-[0_0_6px_var(--accent)]" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function VisualExamples() {
  return (
    <section aria-label="Examples made with Cabin Visuals" className="w-full bg-black">
      {VISUAL_EXAMPLES.map((visual) => (
        <div
          key={visual.id}
          className="relative h-[100svh] w-full overflow-hidden bg-black"
        >
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${visual.id}?autoplay=1&mute=1&loop=1&playlist=${visual.id}&controls=0&modestbranding=1&rel=0&playsinline=1&disablekb=1&iv_load_policy=3&showinfo=0&fs=0`}
            title={visual.title}
            tabIndex={-1}
            loading="lazy"
            allow="autoplay; encrypted-media"
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2 scale-[1.04] border-0"
            style={{
              width: "max(100vw, 177.7778vh)",
              height: "max(56.25vw, 100vh)",
            }}
          />
        </div>
      ))}
    </section>
  )
}

export default function LandingPage() {
  const router = useRouter()
  // Shared cached auth (not a private per-mount fetch), so navigating back to
  // the landing page renders the known sign-in state instead of re-running the
  // login/signup -> profile flip.
  const { user } = useAuth()

  return (
    <MotionConfig reducedMotion="user">
    <div className="flex min-h-screen flex-col bg-[var(--bg-page)] text-[var(--text)] font-sans">
      {/* Nav - 64px, hairline border (shared SiteHeader) */}
      <SiteHeader>
        <Link
          href="/pricing"
          onClick={() => track('nav_clicked', { from: 'landing', to: 'pricing' })}
          className="px-3 text-[13px] text-[var(--text-3)] transition-colors hover:text-[var(--text)] cursor-pointer"
        >
          Pricing
        </Link>
        {user && !user.is_anonymous ? (
          // Real account: the shared profile menu (anonymous sessions get
          // the sign-in affordances instead).
          <ProfileMenu />
        ) : (
          // Show login/signup buttons if not logged in
          <>
            <Link
              href="/login"
              onClick={() => track('nav_clicked', { from: 'landing', to: 'login' })}
              className="inline-flex h-8 items-center rounded-[5px] border border-[var(--border)] px-3.5 text-[13px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] cursor-pointer"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              onClick={() => track('nav_clicked', { from: 'landing', to: 'signup' })}
              className="inline-flex h-8 items-center rounded-[5px] bg-[var(--accent)] px-3.5 text-[13px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)] cursor-pointer"
            >
              Sign up
            </Link>
          </>
        )}
      </SiteHeader>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto flex w-full max-w-[1200px] flex-col items-center gap-8 px-5 pt-14 pb-14 text-center sm:gap-11 sm:px-6 sm:pt-24 sm:pb-20">
          <Appear className="flex flex-col items-center gap-6">
            <CabinLogo className="block h-[104px] w-auto sm:h-[150px]" />
            <h1 className="m-0 max-w-[880px] text-[34px] font-bold leading-[1.06] tracking-[-0.03em] text-[var(--text)] sm:text-[44px] md:text-[64px]">
              <span>Create insanely great visuals for music</span>
            </h1>
            <p className="m-0 max-w-[620px] text-[15px] leading-[1.55] tracking-[-0.01em] text-[var(--text-3)] sm:text-[17px]">
              The best workstation for music-synced visuals
            </p>
          </Appear>
          <Appear delay={0.1} className="flex flex-col items-center gap-[18px]">
            {user ? (
              // Logged in: straight back into the last project they opened
              // on this device; /projects only when there's nothing to resume.
              <CtaGlow>
                <button
                  onClick={() => {
                    const last = getLastProjectId(user.id)
                    track('continue_creating_clicked', { destination: last ? 'editor' : 'projects' })
                    router.push(last ? `/editor?project=${last}` : '/projects')
                  }}
                  className={CTA_CLASSES}
                >
                  Continue creating
                </button>
              </CtaGlow>
            ) : (
              // Not logged in: pick a template first (/start), which creates a
              // real project on an anonymous session - the Lyric Video pipeline
              // needs one to upload the song at all.
              <CtaGlow>
                <Link
                  href="/start"
                  onClick={() => track('try_it_out_clicked')}
                  className={CTA_CLASSES}
                >
                  Start creating
                </Link>
              </CtaGlow>
            )}
          </Appear>
        </section>

        {/* Product showcase */}
        <section className="mx-auto flex w-full max-w-[1240px] justify-center px-4 pb-24 sm:px-6">
          <Reveal className="w-full">
            <AppShowcase />
          </Reveal>
        </section>

        <VisualExamples />
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border-subtle)]">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col items-center justify-between gap-3 px-6 py-7 md:flex-row md:gap-2">
          <p className="m-0 text-[13px] text-[var(--text-muted)]">© {new Date().getFullYear()} Cabin Visuals. All rights reserved. Made with ♥ for musicians and visual artists</p>
          <div className="flex items-center gap-5">
            {SOCIAL_LINKS.map((social) => (
              <a
                key={social.label}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={social.label}
                className="group relative text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-[18px] w-[18px]">
                  <path d={social.path} />
                </svg>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--bg-panel)] px-2 py-1 text-[11px] text-[var(--text-2)] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                >
                  {social.label}
                </span>
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
    </MotionConfig>
  )
}

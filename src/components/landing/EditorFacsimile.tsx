"use client"

// A faithful, lightweight facsimile of Cabin's editor in the "DAW Console 1a"
// design (design_handoff_daw_console): transport bar / library / preview /
// plugin-style knob inspector / timeline with section markers. Kept entirely
// in the page (instead of embedding the real editor) so the landing page
// stays fast and the controls cannot accidentally modify a project. The
// handoff palette is hardcoded on purpose - this mock always shows the
// intended design, whatever theme the surrounding page wears.

// Handoff tokens (README "Design Tokens").
const C = {
  bg: "#0c0d12",
  stage: "#0a0b10",
  raised: "#10131c",
  text: "#e9edf4",
  soft: "#b8c0d0",
  muted: "#8a93a6",
  faint: "#5a6274",
  accent: "#a5d8f3",
  bright: "#dff2fb",
  button: "#bfe6f7",
  deep: "#4a7ea6",
  wave: "#6fa8c9",
  hairline: "rgba(255,255,255,0.06)",
  rowline: "rgba(255,255,255,0.04)",
}

const LIBRARY_GROUPS = [
  { title: "Objects", items: ["Laser Sphere", "Text", "Photo"], selected: "Laser Sphere" },
  { title: "Movement", items: ["Orbit", "Tunnel", "Audio Pulse"] },
  { title: "Effects", items: ["Bloom", "Strobe", "Grain"] },
]

// Knob values as fractions of the 270° sweep (Radius 64/128, Thickness 18/64,
// Points 96/256, Audio gain 72%).
const KNOBS = [
  { label: "Radius", value: "64", f: 0.5 },
  { label: "Thickness", value: "18", f: 0.28 },
  { label: "Points", value: "96", f: 0.375 },
  { label: "Audio gain", value: "72%", f: 0.72 },
]

/** One plugin knob: conic value arc (225° start, 270° max sweep), inset dark
 *  cap, rotated tick, mono value + sans label below. Static - display only. */
function Knob({ label, value, f }: { label: string; value: string; f: number }) {
  const sweep = 270 * f
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="relative h-12 w-12 rounded-full"
        style={{
          background: `conic-gradient(from 225deg, ${C.accent} 0deg ${sweep}deg, rgba(255,255,255,0.08) ${sweep}deg 270deg, transparent 270deg 360deg)`,
        }}
      >
        <div
          className="absolute inset-[5px] rounded-full"
          style={{
            background: "linear-gradient(145deg, #1c202c, #0f121b)",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 10px rgba(0,0,0,0.5)",
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 h-[10px] w-[2px] rounded-full"
          style={{
            background: C.bright,
            transform: `translate(-50%, -50%) rotate(${-135 + sweep}deg) translateY(-11px)`,
          }}
        />
      </div>
      <span className="font-mono text-[10px]" style={{ color: C.accent }}>{value}</span>
      <span className="text-[9.5px] leading-none" style={{ color: C.muted }}>{label}</span>
    </div>
  )
}

// Static waveform bar heights (percent) - enough texture to read as audio.
const WAVE_BARS = [
  38, 62, 45, 78, 55, 90, 48, 66, 82, 40, 70, 58, 88, 50, 74, 44, 92, 60, 52, 80,
  46, 68, 84, 42, 76, 56, 94, 49, 64, 72, 54, 86, 47, 69, 79, 41, 73, 59, 87, 51,
]

// MIDI note bars inside clips: [left%, top%, width%] - neutral white per the
// handoff (notes are NOT colored).
const NOTE_ROWS: Record<string, [number, number, number][]> = {
  intro: [[6, 25, 14], [26, 55, 10], [42, 30, 16], [64, 60, 12], [80, 35, 13]],
  chorus: [[5, 55, 12], [22, 25, 14], [42, 60, 10], [58, 30, 16], [80, 50, 12]],
  outro: [[8, 35, 16], [34, 60, 12], [56, 28, 14], [76, 55, 14]],
  title: [[6, 30, 20], [32, 58, 14], [52, 30, 18], [76, 55, 16]],
  orbit: [[8, 28, 14], [30, 58, 12], [50, 32, 14], [72, 55, 16]],
  flight: [[6, 55, 14], [28, 28, 12], [48, 58, 16], [72, 32, 14]],
}

function Clip({
  left,
  width,
  label,
  notes,
  selected = false,
}: {
  left: string
  width: string
  label: string
  notes: [number, number, number][]
  selected?: boolean
}) {
  return (
    <span
      className="absolute top-[5px] bottom-[5px] overflow-hidden rounded-[5px]"
      style={{
        left,
        width,
        border: `1px solid ${selected ? C.accent : "rgba(165,216,243,0.4)"}`,
        backgroundColor: `rgba(165,216,243,${selected ? 0.22 : 0.1})`,
      }}
    >
      <span
        className="absolute left-[8px] top-[4px] font-mono text-[8px] sm:text-[9px]"
        style={{ color: selected ? C.bright : "#8fa5b8" }}
      >
        {label}
      </span>
      {notes.map(([noteLeft, noteTop, noteWidth], index) => (
        <span
          key={index}
          className="absolute h-[13%] rounded-[2px]"
          style={{
            left: `${noteLeft}%`,
            top: `${noteTop + 30}%`,
            width: `${noteWidth}%`,
            background: "rgba(235,240,247,0.85)",
          }}
        />
      ))}
    </span>
  )
}

const TIMELINE_ROWS: {
  name: string
  tint: string
  clips: { left: string; width: string; label: string; notes: [number, number, number][]; selected?: boolean }[]
}[] = [
  { name: "Audio", tint: C.wave, clips: [] },
  {
    name: "Laser Sphere",
    tint: C.accent,
    clips: [
      { left: "0%", width: "24.5%", label: "Intro", notes: NOTE_ROWS.intro },
      { left: "25%", width: "24.5%", label: "Chorus", notes: NOTE_ROWS.chorus, selected: true },
      { left: "75%", width: "24.5%", label: "Outro", notes: NOTE_ROWS.outro },
    ],
  },
  {
    name: "Title",
    tint: C.accent,
    clips: [{ left: "25%", width: "49.5%", label: "MIDNIGHT DRIVE", notes: NOTE_ROWS.title }],
  },
  {
    name: "Tunnel",
    tint: C.accent,
    clips: [
      { left: "12.5%", width: "24.5%", label: "Orbit", notes: NOTE_ROWS.orbit },
      { left: "56.25%", width: "31%", label: "Flight", notes: NOTE_ROWS.flight },
    ],
  },
]

const SECTIONS = ["Verse", "Chorus", "Bridge", "Main"]

export function EditorFacsimile({ className = "" }: { className?: string }) {
  return (
    <div
      aria-label="Preview of the Cabin Visuals music visualization editor"
      className={`overflow-hidden text-left ${className}`}
      style={{ backgroundColor: C.bg, border: "1px solid rgba(255,255,255,0.07)" }}
    >
      {/* Transport bar */}
      <div
        className="flex h-11 items-center gap-3 px-3 sm:h-[52px] sm:gap-5 sm:px-5"
        style={{ borderBottom: `1px solid ${C.hairline}` }}
      >
        <span className="italic text-[15px] leading-none [font-family:var(--font-display)] sm:text-[17px]" style={{ color: C.accent }}>
          Cabin
        </span>
        <span className="truncate text-[11px] font-bold uppercase tracking-[0.1em] leading-none [font-family:var(--font-archivo)] sm:text-[12.5px]" style={{ color: C.text }}>
          Midnight Drive
        </span>

        <span
          className="ml-auto rounded-full px-4 py-1.5 text-[12px] font-semibold sm:px-5"
          style={{ background: C.button, color: C.bg }}
        >
          Export
        </span>
      </div>

      {/* Library / preview / inspector */}
      <div className="grid min-h-[280px] grid-cols-1 md:min-h-[360px] md:grid-cols-[172px_minmax(0,1fr)_236px]">
        {/* Library */}
        <div className="hidden flex-col gap-3.5 py-3.5 md:flex" style={{ borderRight: `1px solid ${C.hairline}` }}>
          <span className="px-4 font-mono text-[9.5px] uppercase tracking-[0.14em]" style={{ color: C.faint }}>
            Library
          </span>
          {LIBRARY_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="m-0 px-4 pb-1 text-[13px] italic [font-family:var(--font-display)]" style={{ color: C.muted }}>
                {group.title}
              </p>
              {group.items.map((item) => (
                <div
                  key={item}
                  className="mx-2 rounded-[6px] px-2 py-[5px] text-[11.5px]"
                  style={
                    item === group.selected
                      ? { color: C.bright, backgroundColor: "rgba(165,216,243,0.12)" }
                      : { color: "#9aa3b5" }
                  }
                >
                  {item}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Preview stage */}
        <div className="flex flex-col" style={{ backgroundColor: C.stage }}>
          <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
            <div
              className="relative w-full max-w-[560px] overflow-hidden rounded-[6px]"
              style={{ aspectRatio: "16 / 9", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <div
                className="absolute inset-0"
                style={{ background: "radial-gradient(ellipse 65% 75% at 50% 55%, #17222c 0%, #0a0c11 70%)" }}
              />
              <span
                className="absolute inset-0 flex items-center justify-center italic [font-family:var(--font-display)] text-[clamp(28px,5vw,52px)] tracking-[0.06em]"
                style={{ color: C.accent, textShadow: "0 0 40px rgba(165,216,243,0.45)" }}
              >
                MIDNIGHT
              </span>
            </div>
          </div>
          {/* 4a: transport lives under the preview - aspect left, play +
              timecode centered, BPM on the right against the timeline. */}
          <div className="relative flex h-11 items-center justify-between px-5 font-mono text-[10px]" style={{ color: C.faint }}>
            <span>16:9</span>
            <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-3">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full"
                style={{ border: "1px solid rgba(165,216,243,0.45)" }}
              >
                <span
                  className="ml-[2px] inline-block"
                  style={{
                    width: 0,
                    height: 0,
                    borderTop: "5px solid transparent",
                    borderBottom: "5px solid transparent",
                    borderLeft: `8px solid ${C.accent}`,
                  }}
                />
              </span>
              <span className="hidden font-mono text-[12px] sm:inline" style={{ color: C.text }}>00:00.0</span>
            </div>
            <span style={{ color: C.muted }}>124 BPM</span>
          </div>
        </div>

        {/* Inspector */}
        <div className="hidden flex-col gap-3.5 p-4 md:flex" style={{ borderLeft: `1px solid ${C.hairline}` }}>
          <span className="text-[18px] leading-none [font-family:var(--font-display)]" style={{ color: C.text }}>
            Laser Sphere
          </span>
          <div className="flex gap-4 text-[11.5px]" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            <span className="pb-1.5" style={{ color: C.text, borderBottom: `2px solid ${C.accent}` }}>
              Instrument
            </span>
            <span className="pb-1.5" style={{ color: C.faint }}>Effects</span>
          </div>
          <div
            className="flex items-center justify-between rounded-[8px] px-3 py-[7px]"
            style={{ border: "1px solid rgba(255,255,255,0.1)", backgroundColor: C.raised }}
          >
            <span className="font-mono text-[10.5px]" style={{ color: "#c3cad8" }}>Init — Wide</span>
            <span className="font-mono text-[10.5px]" style={{ color: C.faint }}>‹ ›</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-4 pt-1">
            {KNOBS.map((knob) => (
              <Knob key={knob.label} {...knob} />
            ))}
          </div>
          <div className="mt-auto flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px]" style={{ color: C.soft }}>Blend</span>
              <span
                className="rounded-[6px] px-2.5 py-1 font-mono text-[10.5px]"
                style={{ color: C.text, border: "1px solid rgba(255,255,255,0.12)" }}
              >
                In front
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px]" style={{ color: C.soft }}>Color</span>
              <span
                className="h-[18px] w-9 rounded-[6px]"
                style={{
                  background: `linear-gradient(90deg, ${C.accent}, ${C.deep})`,
                  border: "1px solid rgba(255,255,255,0.15)",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ borderTop: `1px solid ${C.hairline}` }}>
        <div className="grid grid-cols-[92px_minmax(0,1fr)] sm:grid-cols-[130px_minmax(0,1fr)]">
          {/* Section markers */}
          <div style={{ borderRight: `1px solid ${C.hairline}` }} />
          <div className="relative flex h-7">
            {SECTIONS.map((section) => (
              <span
                key={section}
                className="flex w-1/4 items-center pl-2 text-[12px] italic [font-family:var(--font-display)] sm:text-[13px]"
                style={{ color: C.accent, borderLeft: "1px solid rgba(165,216,243,0.3)" }}
              >
                {section}
              </span>
            ))}
          </div>

          {TIMELINE_ROWS.map((row, rowIndex) => (
            <div key={row.name} className="contents">
              <div
                className="flex h-9 items-center gap-2 px-2.5 sm:h-10 sm:px-3.5"
                style={{
                  borderRight: `1px solid ${C.hairline}`,
                  borderBottom: `1px solid ${C.rowline}`,
                }}
              >
                <span className="h-4 w-1 flex-shrink-0 rounded-full" style={{ backgroundColor: row.tint }} />
                <span className="truncate text-[10px] sm:text-[11.5px]" style={{ color: C.soft }}>{row.name}</span>
              </div>
              <div className="relative h-9 sm:h-10" style={{ borderBottom: `1px solid ${C.rowline}` }}>
                {rowIndex === 0 ? (
                  // Audio region: full-width tint with a static waveform.
                  <div className="absolute inset-x-0 top-[5px] bottom-[5px] overflow-hidden rounded-[5px]" style={{ backgroundColor: "rgba(165,216,243,0.05)" }}>
                    <div className="flex h-full items-center gap-px px-1">
                      {WAVE_BARS.map((height, index) => (
                        <span
                          key={index}
                          className="min-w-0 flex-1 rounded-[1px]"
                          style={{ height: `${height}%`, backgroundColor: C.wave, opacity: 0.75 }}
                        />
                      ))}
                    </div>
                    <span
                      className="absolute left-[8px] top-[4px] rounded px-1 font-mono text-[8px] sm:text-[9px]"
                      style={{ color: C.muted, backgroundColor: "rgba(12,13,18,0.7)" }}
                    >
                      Midnight Drive.wav
                    </span>
                  </div>
                ) : (
                  row.clips.map((clip) => <Clip key={clip.label} {...clip} />)
                )}
                {/* Playhead on the first row spans visually via glow; keep one line per row for simplicity. */}
                {rowIndex === 0 && (
                  <span
                    className="absolute inset-y-0 left-[43%] z-10 w-px"
                    style={{ backgroundColor: C.bright, boxShadow: "0 0 8px rgba(165,216,243,0.8)" }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

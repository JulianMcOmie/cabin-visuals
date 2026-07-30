'use client'

/**
 * /dev/panel-header-lab — styling options for the inspector's identity header.
 *
 * The name header was removed from TrackEditor (docs/instrument-panel-design-guide.md
 * deprecated it); this lab brings it back as a real design decision. Tyler picked the
 * direction: identity lives ON THE TAB RAIL — merged into the row the panel already
 * has, so it costs no vertical space. R1-R8 are that family; A-F below are the earlier
 * (taller, separate-header) directions kept for contrast.
 *
 * Throwaway prototype: everything is faked locally, no stores, no engine.
 */

import { useState } from 'react'
import { Sparkles, SlidersHorizontal } from 'lucide-react'

/* ------------------------------------------------------------------ */
/* Subjects — the three things the inspector can be pointed at.        */
/* ------------------------------------------------------------------ */

type Subject = {
  key: string
  /** What it IS: the instrument/mover/scene kind. */
  kind: string
  /** What the user called it. */
  name: string
  /** Its display color (resolveTrackDisplayColor in the real panel). */
  color: string
}

const SUBJECTS: Subject[] = [
  { key: 'instrument', kind: 'Laser Sphere', name: 'Lead Sphere', color: '#35a7e6' },
  { key: 'mover', kind: 'Meteor Impact', name: 'Impact', color: '#e6a13a' },
  { key: 'long', kind: 'Text Display', name: 'Chorus Lyrics Big', color: '#b56ce0' },
  { key: 'scene', kind: 'Scene', name: 'Chorus', color: '#4ad6a8' },
]

/** `hex` at `alpha` — headers tint with the subject's own color, never a theme hue. */
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

type Tab = 'instrument' | 'effects'
type RailProps = { subject: Subject; tab: Tab; setTab: (t: Tab) => void }

/* ------------------------------------------------------------------ */
/* Shared rail pieces                                                  */
/* ------------------------------------------------------------------ */

const RAIL = 'flex flex-shrink-0 items-center gap-1 border-b border-[var(--border)] px-3 py-1.5'

function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <span
      className="flex-shrink-0 rounded-full"
      style={{ width: size, height: size, background: color, boxShadow: `0 0 6px ${withAlpha(color, 0.55)}` }}
    />
  )
}

/** The panel's current tab pair as short pills — today's chrome, compacted. */
function PillTabs({ tab, setTab, labels, accent }: {
  tab: Tab; setTab: (t: Tab) => void; labels: [string, string]; accent?: string
}) {
  return (
    <>
      {(['instrument', 'effects'] as const).map((id, i) => {
        const active = tab === id
        return (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`h-6 flex-shrink-0 rounded-full px-2.5 text-[11px] transition-colors cursor-pointer ${
              active
                ? accent
                  ? 'font-semibold'
                  : 'bg-[var(--bg-elevated)] font-semibold text-[var(--text)]'
                : 'bg-transparent font-medium text-[var(--text-muted)] hover:bg-white/[0.05] hover:text-[var(--text-2)]'
            }`}
            style={active && accent ? { background: withAlpha(accent, 0.18), color: accent } : undefined}
          >
            {labels[i]}
          </button>
        )
      })}
    </>
  )
}

/** Icon-only tabs — the most compact possible tab pair. */
function IconTabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const items = [
    { id: 'instrument' as const, Icon: SlidersHorizontal, title: 'Instrument' },
    { id: 'effects' as const, Icon: Sparkles, title: 'Effects' },
  ]
  return (
    <>
      {items.map(({ id, Icon, title }) => (
        <button
          key={id}
          onClick={() => setTab(id)}
          title={title}
          aria-label={title}
          className={`flex h-6 w-7 flex-shrink-0 items-center justify-center rounded-full transition-colors cursor-pointer ${
            tab === id
              ? 'bg-[var(--bg-elevated)] text-[var(--text)]'
              : 'text-[var(--text-muted)] hover:bg-white/[0.05] hover:text-[var(--text-2)]'
          }`}
        >
          <Icon size={13} />
        </button>
      ))}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* R1-R8 — the tab-rail family                                        */
/* ------------------------------------------------------------------ */

/** R1 — Dot + name, short pills. The plainest merge: identity reads first,
 *  tabs shrink to fit beside it. */
function RailDotShortPills({ subject, tab, setTab }: RailProps) {
  return (
    <div className={RAIL}>
      <Dot color={subject.color} />
      <span className="truncate text-[11px] font-semibold text-[var(--text)]" title={subject.kind}>
        {subject.name}
      </span>
      <span className="ml-auto flex items-center gap-1">
        <PillTabs tab={tab} setTab={setTab} labels={['Inst', 'FX']} />
      </span>
    </div>
  )
}

/** R2 — Name + kind on one line, icon tabs. Both facts survive because the
 *  tabs give back all their width; the kind truncates first. */
function RailNameKindIcons({ subject, tab, setTab }: RailProps) {
  return (
    <div className={RAIL}>
      <Dot color={subject.color} size={7} />
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="flex-shrink-0 text-[11px] font-semibold text-[var(--text)]">{subject.name}</span>
        <span className="truncate text-[10px] text-[var(--text-muted)]">{subject.kind}</span>
      </span>
      <span className="ml-auto flex items-center gap-0.5">
        <IconTabs tab={tab} setTab={setTab} />
      </span>
    </div>
  )
}

/** R3 — Color spine + segmented capsule. The tabs become one grouped control
 *  (a real segmented switch) so the row reads as title | switch, not three pills. */
function RailSpineSegmented({ subject, tab, setTab }: RailProps) {
  return (
    <div className={RAIL}>
      <span className="h-4 w-[3px] flex-shrink-0 rounded-full" style={{ background: subject.color }} />
      <span className="truncate text-[11.5px] font-semibold text-[var(--text)]" title={subject.kind}>
        {subject.name}
      </span>
      <span className="ml-auto flex flex-shrink-0 items-center gap-0.5 rounded-full bg-[var(--bg-app)] p-0.5">
        {(['instrument', 'effects'] as const).map((id, i) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`h-5 rounded-full px-2 text-[10.5px] transition-colors cursor-pointer ${
              tab === id
                ? 'bg-[var(--bg-elevated)] font-semibold text-[var(--text)]'
                : 'font-medium text-[var(--text-muted)] hover:text-[var(--text-2)]'
            }`}
          >
            {['Inst', 'FX'][i]}
          </button>
        ))}
      </span>
    </div>
  )
}

/** R4 — Underline tabs. No pills at all: the tabs are text with an accent
 *  underline, so the only filled shape in the row is the identity dot. */
function RailUnderline({ subject, tab, setTab }: RailProps) {
  return (
    <div className="flex flex-shrink-0 items-center gap-1 border-b border-[var(--border)] px-3 pt-1.5">
      <Dot color={subject.color} />
      <span className="truncate text-[11px] font-semibold text-[var(--text)]" title={subject.kind}>
        {subject.name}
      </span>
      <span className="ml-auto flex items-center gap-3">
        {(['instrument', 'effects'] as const).map((id, i) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`relative h-6 pb-1.5 text-[11px] transition-colors cursor-pointer ${
              tab === id ? 'font-semibold text-[var(--text)]' : 'font-medium text-[var(--text-muted)] hover:text-[var(--text-2)]'
            }`}
          >
            {['Inst', 'FX'][i]}
            {tab === id && (
              <span
                className="absolute inset-x-0 -bottom-px h-[2px] rounded-full"
                style={{ background: subject.color }}
              />
            )}
          </button>
        ))}
      </span>
    </div>
  )
}

/** R5 — Identity as readout. Tabs keep the left (where the eye already goes for
 *  navigation); the name sits right in mono micro-caps like a device readout. */
function RailReadout({ subject, tab, setTab }: RailProps) {
  return (
    <div className={RAIL}>
      <span className="flex flex-shrink-0 items-center gap-1">
        <PillTabs tab={tab} setTab={setTab} labels={['Inst', 'FX']} />
      </span>
      <span className="ml-auto flex min-w-0 items-center gap-1.5">
        <span
          className="truncate font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-3)]"
          title={subject.kind}
        >
          {subject.name}
        </span>
        <Dot color={subject.color} size={7} />
      </span>
    </div>
  )
}

/** R6 — Device title bar. Same single strip, two steps taller (34px): the name
 *  gets real display weight and the kind rides under it, tabs as icons. */
function RailDeviceBar({ subject, tab, setTab }: RailProps) {
  return (
    <div className="flex flex-shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-1.5">
      <span className="h-6 w-[3px] flex-shrink-0 rounded-full" style={{ background: subject.color }} />
      <span className="min-w-0">
        <span className="block truncate text-[12px] font-semibold leading-tight text-[var(--text)]">
          {subject.name}
        </span>
        <span className="block truncate text-[9.5px] leading-tight text-[var(--text-muted)]">
          {subject.kind}
        </span>
      </span>
      <span className="ml-auto flex items-center gap-0.5">
        <IconTabs tab={tab} setTab={setTab} />
      </span>
    </div>
  )
}

/** R7 — Tinted name chip. The identity wears its own color as a wash, so the
 *  panel's top-left is unmistakably this track even at a glance. */
function RailTintedChip({ subject, tab, setTab }: RailProps) {
  return (
    <div className={RAIL}>
      <span
        className="flex min-w-0 items-center gap-1.5 rounded-full px-2 py-1"
        style={{ background: withAlpha(subject.color, 0.14), border: `1px solid ${withAlpha(subject.color, 0.28)}` }}
        title={subject.kind}
      >
        <span className="truncate text-[11px] font-semibold leading-none" style={{ color: subject.color }}>
          {subject.name}
        </span>
      </span>
      <span className="ml-auto flex items-center gap-1">
        <PillTabs tab={tab} setTab={setTab} labels={['Inst', 'FX']} />
      </span>
    </div>
  )
}

/** R8 — Colored active tab. Identity is plain ink; the subject's color lives in
 *  the ACTIVE tab pill instead, so the row is lit by the track without a chip. */
function RailColoredTab({ subject, tab, setTab }: RailProps) {
  return (
    <div className={RAIL}>
      <span className="truncate text-[11.5px] font-semibold text-[var(--text)]" title={subject.kind}>
        {subject.name}
      </span>
      <span className="ml-auto flex items-center gap-1">
        <PillTabs tab={tab} setTab={setTab} labels={['Inst', 'FX']} accent={subject.color} />
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* A-F — the earlier separate-header directions (kept for contrast)   */
/* ------------------------------------------------------------------ */

function StandardRail({ subject, tab, setTab }: RailProps) {
  const first = subject.key === 'scene' ? 'Settings' : 'Instrument'
  return (
    <div className={RAIL}>
      {(['instrument', 'effects'] as const).map((id, i) => (
        <button
          key={id}
          onClick={() => setTab(id)}
          className={`h-6 flex-1 rounded-full text-[11px] transition-colors cursor-pointer ${
            tab === id
              ? 'bg-[var(--bg-elevated)] font-semibold text-[var(--text)]'
              : 'bg-transparent font-medium text-[var(--text-muted)] hover:bg-white/[0.05] hover:text-[var(--text-2)]'
          }`}
        >
          {[first, 'Effects'][i]}
        </button>
      ))}
    </div>
  )
}

function HeaderEtched({ subject }: { subject: Subject }) {
  return (
    <div className="px-3 pt-3 pb-2.5">
      <div
        className="text-[15px] font-bold uppercase leading-none tracking-[0.14em] select-none"
        style={{ color: 'rgba(255,255,255,0.13)', textShadow: '0 1px 0 rgba(255,255,255,0.05), 0 -1px 0 rgba(0,0,0,0.6)' }}
      >
        {subject.name}
      </div>
      <div className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
        {subject.kind}
      </div>
    </div>
  )
}

function HeaderSpine({ subject }: { subject: Subject }) {
  return (
    <div className="flex items-stretch gap-2.5 px-3 py-2.5">
      <div className="w-[3px] flex-shrink-0 rounded-full" style={{ background: subject.color }} />
      <div className="min-w-0">
        <div className="truncate text-[12.5px] font-semibold leading-tight text-[var(--text)]">{subject.name}</div>
        <div className="mt-0.5 truncate text-[10px] leading-tight text-[var(--text-muted)]">{subject.kind}</div>
      </div>
    </div>
  )
}

function HeaderEditorial({ subject }: { subject: Subject }) {
  return (
    <div className="px-3 pb-3 pt-3.5">
      <div className="text-[9.5px] font-bold uppercase leading-none tracking-[0.16em]" style={{ color: subject.color }}>
        {subject.kind}
      </div>
      <div className="mt-2 truncate text-[17px] font-semibold leading-none tracking-[-0.01em] text-[var(--text)]">
        {subject.name}
      </div>
    </div>
  )
}

function HeaderLit({ subject }: { subject: Subject }) {
  return (
    <div
      className="relative px-3 pb-3 pt-3"
      style={{ background: `radial-gradient(80% 34px at 12% 0, ${withAlpha(subject.color, 0.22)}, transparent)` }}
    >
      <div className="truncate text-[13px] font-semibold leading-tight text-[var(--text)]">{subject.name}</div>
      <div className="mt-1 truncate text-[10px] leading-tight text-[var(--text-3)]">{subject.kind}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

type Option = {
  id: string
  title: string
  note: string
  /** Renders the whole tab row (identity included) — the tab-rail family. */
  Rail?: (props: RailProps) => React.ReactElement
  /** Renders a block above the standard tab row — the earlier directions. */
  Header?: (props: { subject: Subject }) => React.ReactElement
}

const RAIL_OPTIONS: Option[] = [
  { id: 'R1', title: 'Dot + short pills', note: 'The plainest merge: dot, name, tabs compacted to Inst / FX.', Rail: RailDotShortPills },
  { id: 'R2', title: 'Name + kind, icon tabs', note: 'Icons give back enough width to keep the kind on the same line.', Rail: RailNameKindIcons },
  { id: 'R3', title: 'Spine + segmented switch', note: 'Tabs become one grouped switch, so the row reads title | control.', Rail: RailSpineSegmented },
  { id: 'R4', title: 'Underline tabs', note: 'No pills — the only filled shape in the row is the identity dot.', Rail: RailUnderline },
  { id: 'R5', title: 'Identity as readout', note: 'Tabs keep the left; the name sits right in mono caps like a device readout.', Rail: RailReadout },
  { id: 'R6', title: 'Device title bar', note: 'One strip, ~34px: display-weight name with the kind under it, icon tabs.', Rail: RailDeviceBar },
  { id: 'R7', title: 'Tinted name chip', note: 'The name wears the track color as a wash — unmistakable at a glance.', Rail: RailTintedChip },
  { id: 'R8', title: 'Colored active tab', note: 'Name in plain ink; the track color lights the active tab instead.', Rail: RailColoredTab },
]

const HEADER_OPTIONS: Option[] = [
  { id: 'A', title: 'Etched wordmark', note: 'Name engraved into the panel — material, not label.', Header: HeaderEtched },
  { id: 'B', title: 'Color spine', note: 'Hairline of track color + name/kind stack, above the tabs.', Header: HeaderSpine },
  { id: 'E', title: 'Editorial', note: 'Name at display size, kind as an accent micro-label.', Header: HeaderEditorial },
  { id: 'F', title: 'Lit from within', note: 'Color spills from the top edge as light; text stays neutral.', Header: HeaderLit },
]

// The real inspector is a resizable panel (App.tsx: 55% default, 15% min), so a
// tab-rail header has to survive both ends of that range - the whole family lives
// or dies on how it truncates.
const WIDTHS = [
  { key: 'narrow', label: 'Narrow (240)', px: 240 },
  { key: 'default', label: 'Typical (320)', px: 320 },
  { key: 'wide', label: 'Wide (440)', px: 440 },
]

function MockPanel({ option, subject, width }: { option: Option; subject: Subject; width: number }) {
  const [tab, setTab] = useState<Tab>('instrument')
  const Rail = option.Rail ?? StandardRail
  return (
    <div
      className="flex h-[268px] flex-col overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg-panel)]"
      style={{ width }}
    >
      {option.Header && (
        <>
          <option.Header subject={subject} />
          <div className="h-px flex-shrink-0 bg-[var(--border-subtle)]" />
        </>
      )}
      <Rail subject={subject} tab={tab} setTab={setTab} />

      {/* Stand-in controls: enough panel body to judge the header against. */}
      <div className="flex-1 overflow-hidden p-3">
        <div
          className="-mx-3 -mt-3 mb-3 h-[86px] w-[calc(100%+1.5rem)]"
          style={{
            background: `radial-gradient(60% 70% at 50% 45%, ${withAlpha(subject.color, 0.35)}, #05070c 70%)`,
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
        />
        {[
          { label: 'Size', value: 0.62 },
          { label: 'Glow', value: 0.34 },
          { label: 'Speed', value: 0.8 },
        ].map((row) => (
          <div key={row.label} className="mb-3 grid grid-cols-[70px_1fr] items-center gap-2.5">
            <span className="text-[11px] text-[var(--text-3)]">{row.label}</span>
            <div className="h-[3px] rounded-full bg-[var(--border)]">
              <div className="h-full rounded-full" style={{ width: `${row.value * 100}%`, background: subject.color, opacity: 0.75 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function OptionGrid({ options, subject, width }: { options: Option[]; subject: Subject; width: number }) {
  return (
    <div className="flex flex-wrap gap-6">
      {options.map((option) => (
        <div key={option.id} style={{ width }}>
          <div className="mb-2 flex items-baseline gap-2">
            <span className="font-mono text-[11px] text-[var(--accent)]">{option.id}</span>
            <span className="text-[12px] font-semibold text-[var(--text)]">{option.title}</span>
          </div>
          <MockPanel option={option} subject={subject} width={width} />
          <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--text-muted)]">{option.note}</p>
        </div>
      ))}
    </div>
  )
}

export default function PanelHeaderLab() {
  const [subjectKey, setSubjectKey] = useState(SUBJECTS[0].key)
  const [widthKey, setWidthKey] = useState(WIDTHS[1].key)
  const subject = SUBJECTS.find((s) => s.key === subjectKey) ?? SUBJECTS[0]
  const width = (WIDTHS.find((w) => w.key === widthKey) ?? WIDTHS[1]).px

  return (
    <div className="min-h-screen bg-[var(--bg-shell)] p-8 text-[var(--text)]">
      <header className="mb-6">
        <h1 className="text-[15px] font-semibold">Inspector header — on the tab rail</h1>
        <p className="mt-1 max-w-[80ch] text-[12px] leading-relaxed text-[var(--text-3)]">
          Identity merged into the row the panel already has, so it costs no vertical space. Switch
          the subject to see how each one survives a long name, a mover, and a scene.
        </p>
        <div className="mt-3 flex items-center gap-1.5">
          {SUBJECTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSubjectKey(s.key)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] cursor-pointer ${
                s.key === subjectKey
                  ? 'bg-[var(--bg-elevated)] font-semibold text-[var(--text)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-2)]'
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.name}
            </button>
          ))}
          <span className="mx-2 h-4 w-px bg-[var(--border)]" />
          {WIDTHS.map((w) => (
            <button
              key={w.key}
              onClick={() => setWidthKey(w.key)}
              className={`rounded-full px-3 py-1 text-[11px] cursor-pointer ${
                w.key === widthKey
                  ? 'bg-[var(--bg-elevated)] font-semibold text-[var(--text)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-2)]'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </header>

      <OptionGrid options={RAIL_OPTIONS} subject={subject} width={width} />

      <h2 className="mb-4 mt-10 text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
        Earlier directions — separate header above the tabs
      </h2>
      <OptionGrid options={HEADER_OPTIONS} subject={subject} width={width} />
    </div>
  )
}

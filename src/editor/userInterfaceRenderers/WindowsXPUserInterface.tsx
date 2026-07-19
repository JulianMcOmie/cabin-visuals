'use client'

import { isNumberParam } from '../instruments/types'
import { ParamControl, ParamSlider, ParamToggle } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Windows XP desktop-chaos settings, framed as a window itself: titlebar with the
// four-square flag and faux min/max/close buttons, the window-sizing group drawn
// as nested window outlines, and a taskbar footer that houses the spring toggle.
// Console palette throughout - the Luna blue is only hinted via --accent washes.

function find(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((p) => p.definition.key === key)
}

function num(bound: UserInterfaceParameter | undefined, fallback: number): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

/** Standard console slider row driven straight off a bound param. */
function SliderRow({ bound, label }: { bound?: UserInterfaceParameter; label?: string }) {
  if (!bound || !isNumberParam(bound.definition) || typeof bound.value !== 'number') return null
  const d = bound.definition
  return <ParamSlider label={label ?? d.label} value={bound.value} min={d.min} max={d.max} step={d.step} onChange={bound.setValue} />
}

/** Anything not explicitly placed still renders - nothing silently disappears. */
function Leftovers({ parameters, placed }: { parameters: readonly UserInterfaceParameter[]; placed: readonly string[] }) {
  const placedSet = new Set(placed)
  const rest = parameters.filter((p) => !placedSet.has(p.definition.key))
  if (rest.length === 0) return null
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      {rest.map((p) => {
        const numeric = typeof p.value === 'number'
        return (
          <ParamControl
            key={p.definition.key}
            param={p.definition}
            numValue={numeric ? (p.value as number) : undefined}
            strValue={numeric ? undefined : (p.value as string)}
            onNum={p.setValue}
            onStr={p.setValue}
          />
        )
      })}
    </div>
  )
}

/** The four-square "flag" mark, desaturated for the console. */
function FlagGlyph() {
  return (
    <span aria-hidden="true" className="grid flex-shrink-0 grid-cols-2 gap-[1.5px] opacity-70">
      <span className="h-[5px] w-[5px] rounded-[1px] bg-[#c25b52]" />
      <span className="h-[5px] w-[5px] rounded-[1px] bg-[#5b93c9]" />
      <span className="h-[5px] w-[5px] rounded-[1px] bg-[#7ba85a]" />
      <span className="h-[5px] w-[5px] rounded-[1px] bg-[#c9a94f]" />
    </span>
  )
}

/** Decorative min/max/close cluster - purely chrome, not buttons. */
function ChromeButtons() {
  return (
    <span aria-hidden="true" className="flex items-center gap-[3px]">
      {['–', '□', '×'].map((glyph) => (
        <span
          key={glyph}
          className="flex h-[13px] w-[13px] items-center justify-center rounded-[2px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[8px] leading-none text-[var(--text-muted)]"
        >
          {glyph}
        </span>
      ))}
    </span>
  )
}

/** Nested min/max window outlines, live from the four sizing params. */
function WindowSizePreview({ minW, maxW, minH, maxH }: { minW: number; maxW: number; minH: number; maxH: number }) {
  // Full ranges of the params (windowMinW 200-800 etc.) map into the preview box.
  const scaleW = (w: number) => Math.min(100, (w / 1200) * 100)
  const scaleH = (h: number) => Math.min(100, (h / 900) * 100)
  const frame = (w: number, h: number, cls: string, tag: string) => (
    <div
      className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ${cls}`}
      style={{ width: `${scaleW(w)}%`, height: `${scaleH(h)}%` }}
    >
      {/* mini titlebar so the outlines read as windows, not just rects */}
      <div className="flex h-[9px] items-center justify-between border-b border-inherit px-[3px]">
        <span className="text-[6px] leading-none tracking-[0.08em] opacity-80">{tag}</span>
        <span className="text-[6px] leading-none opacity-60">×</span>
      </div>
    </div>
  )
  return (
    <div className="relative mb-2 h-[92px] overflow-hidden rounded-[2px] border border-[var(--border)] bg-[var(--bg-canvas)]">
      {frame(maxW, maxH, 'rounded-[2px] border border-dashed border-[var(--accent-muted)] text-[var(--accent)]', 'MAX')}
      {frame(minW, minH, 'rounded-[2px] border border-[var(--border-strong)] bg-[var(--bg-panel)]/60 text-[var(--text-3)]', 'MIN')}
    </div>
  )
}

export const WindowsXPUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const minW = find(parameters, 'windowMinW')
  const maxW = find(parameters, 'windowMaxW')
  const minH = find(parameters, 'windowMinH')
  const maxH = find(parameters, 'windowMaxH')
  const drift = find(parameters, 'driftSpeed')
  const spawnX = find(parameters, 'spawnX')
  const iconScale = find(parameters, 'iconScale')
  const opacity = find(parameters, 'opacity')
  const spring = find(parameters, 'springAnim')
  const placed = ['windowMinW', 'windowMaxW', 'windowMinH', 'windowMaxH', 'driftSpeed', 'spawnX', 'iconScale', 'opacity', 'springAnim']

  const springOn = num(spring, 1) >= 0.5

  return (
    <section data-testid="windowsxp-user-interface" className="overflow-hidden rounded-[3px] border border-[var(--border-strong)] bg-[var(--bg-panel)]">
      {/* Titlebar */}
      <header
        className="flex h-7 items-center justify-between border-b border-[var(--border)] px-2"
        style={{ background: 'linear-gradient(180deg, rgba(53,167,230,0.20), rgba(53,167,230,0.05))' }}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <FlagGlyph />
          <span className="truncate text-[10px] font-semibold tracking-[0.04em] text-[var(--text-2)]">desktop.settings</span>
        </div>
        <ChromeButtons />
      </header>

      <div className="p-2.5">
        {/* Window sizing, framed like window chrome */}
        <p className="mb-1.5 text-[9px] font-semibold tracking-[0.08em] text-[var(--text-muted)] select-none">SPAWNED WINDOWS</p>
        <WindowSizePreview minW={num(minW, 350)} maxW={num(maxW, 850)} minH={num(minH, 250)} maxH={num(maxH, 600)} />
        <SliderRow bound={minW} label="Min Width" />
        <SliderRow bound={maxW} label="Max Width" />
        <SliderRow bound={minH} label="Min Height" />
        <SliderRow bound={maxH} label="Max Height" />

        <p className="mb-1.5 mt-3 text-[9px] font-semibold tracking-[0.08em] text-[var(--text-muted)] select-none">DESKTOP</p>
        <SliderRow bound={drift} label="Drift Speed" />
        <SliderRow bound={spawnX} label="Spawn X" />
        <SliderRow bound={iconScale} label="Icon Scale" />
        <SliderRow bound={opacity} label="Opacity" />

        <Leftovers parameters={parameters} placed={placed} />
      </div>

      {/* Taskbar footer: start block + the spring toggle living in the "tray" */}
      <footer
        className="flex h-8 items-center justify-between border-t border-[var(--border)] pr-2"
        style={{ background: 'linear-gradient(180deg, rgba(53,167,230,0.14), rgba(53,167,230,0.04))' }}
      >
        <span
          aria-hidden="true"
          className="flex h-full items-center rounded-r-[8px] px-2.5 text-[10px] font-bold italic text-[var(--text-2)]"
          style={{ background: 'linear-gradient(180deg, rgba(96,168,88,0.38), rgba(96,168,88,0.16))' }}
        >
          start
        </span>
        {spring && (
          <div className="flex items-center gap-2" title="Windows pop open with a spring bounce">
            <span className="text-[9px] font-semibold tracking-[0.08em] text-[var(--text-muted)] select-none">SPRING OPEN</span>
            <ParamToggle on={springOn} onChange={(v) => spring.setValue(v ? 1 : 0)} label="Spring animation" />
          </div>
        )}
      </footer>
    </section>
  )
}

'use client'

import { useEffect, type ReactNode } from 'react'
import { ensureFont } from '../core/visual/fonts'
import { isNumberParam } from '../instruments/types'
import { useProjectStore } from '../store/ProjectStore'
import { ParamControl, ParamSlider, ParamToggle } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Bespoke settings for the Text Display instrument: the lyric sheet front and
// center, fonts as specimen buttons, then the animation controls grouped the
// way you think about them (Type / Color / Motion / Echo / Flight). Gated
// params (showIf) never reach this component - each group renders whatever of
// its members are present, so headers stay honest when a toggle is off.

function findParam(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

function numberOf(bound: UserInterfaceParameter | undefined, fallback = 0): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

/** Preview families for the font select's option values - presentation-only
 *  mirrors of the instrument's internal FONT_STACKS. */
const FONT_PREVIEWS: Record<number, { family: string; short: string; load?: string }> = {
  0: { family: '"Arial Black", Impact, sans-serif', short: 'IMPACT' },
  1: { family: 'Georgia, "Times New Roman", serif', short: 'SERIF' },
  2: { family: '"Courier New", monospace', short: 'MONO' },
  3: { family: 'Arial, Helvetica, sans-serif', short: 'SANS' },
  4: { family: '"IM Fell English SC", Georgia, serif', short: 'FELL SC', load: 'IM Fell English SC' },
  5: { family: '"IM Fell English", Georgia, serif', short: 'FELL', load: 'IM Fell English' },
  6: { family: '"Playfair Display", Georgia, serif', short: 'DIDONE', load: 'Playfair Display' },
  7: { family: '"Bebas Neue", "Arial Narrow", sans-serif', short: 'POSTER', load: 'Bebas Neue' },
  8: { family: 'Righteous, "Arial Black", sans-serif', short: 'NEON', load: 'Righteous' },
  9: { family: '"Abril Fatface", Georgia, serif', short: 'NOIR', load: 'Abril Fatface' },
  10: { family: '"Comic Sans MS", "Chalkboard SE", cursive', short: 'COMIC' },
  11: { family: '"Brush Script MT", "Snell Roundhand", cursive', short: 'SCRIPT' },
  12: { family: '"Palatino Linotype", Palatino, "Book Antiqua", serif', short: 'PROPER' },
  13: { family: '"Times New Roman", Times, serif', short: 'NEWS' },
  14: { family: 'Consolas, "Lucida Console", Menlo, monospace', short: 'TERMINAL' },
}

function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <span className="text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">{children}</span>
      {right}
    </div>
  )
}

/** A numeric param as the shared console slider; renders nothing if the param
 *  is absent (hidden by showIf) or not numeric. */
function BoundSlider({ bound }: { bound: UserInterfaceParameter | undefined }) {
  if (!bound) return null
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null
  return (
    <ParamSlider
      label={definition.label}
      value={bound.value}
      min={definition.min}
      max={definition.max}
      step={definition.step}
      onChange={bound.setValue}
    />
  )
}

/** A boolean param as a labelled toggle row. */
function BoundToggleRow({ bound }: { bound: UserInterfaceParameter | undefined }) {
  if (!bound || typeof bound.value !== 'number') return null
  const on = bound.value >= 0.5
  return (
    <div className="mb-[13px] grid grid-cols-[100px_1fr] items-center gap-2.5">
      <span className="truncate text-[11px] text-[var(--text-3)]" title={bound.definition.label}>{bound.definition.label}</span>
      <div className="flex justify-end">
        <ParamToggle on={on} onChange={(v) => bound.setValue(v ? 1 : 0)} label={bound.definition.label} />
      </div>
    </div>
  )
}

function ColorWell({ bound, label, dimmed }: { bound: UserInterfaceParameter | undefined; label: string; dimmed: boolean }) {
  if (!bound || typeof bound.value !== 'string') return null
  return (
    <label className={`flex cursor-pointer items-center gap-2 transition-opacity ${dimmed ? 'opacity-35' : ''}`}>
      <span
        className="relative h-6 w-10 flex-shrink-0 overflow-hidden rounded border border-[var(--border-strong)]"
        style={{ background: bound.value }}
      >
        <input
          type="color"
          aria-label={bound.definition.label}
          value={bound.value}
          onChange={(event) => bound.setValue(event.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </span>
      <span className="text-[10px] text-[var(--text-3)]">{label}</span>
    </label>
  )
}

export const TextDisplayUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ targetId, parameters }) => {
  // The template faces are lazy-loaded; kick them off so the specimen buttons
  // (and the lyric-sheet preview) render in the real face, not the fallback.
  useEffect(() => {
    for (const preview of Object.values(FONT_PREVIEWS)) {
      if (preview.load) ensureFont(preview.load)
    }
  }, [])
  // Word-by-word vs whole-lines display, for EVERY Text Display track. The
  // active side is the instrument's own Advance By param; transcribed tracks
  // additionally get their notes + sheet regrouped from the sung timing.
  const hasTiming = useProjectStore((s) => !!s.tracks[targetId]?.lyricTiming?.length)
  const setLyricGrouping = useProjectStore((s) => s.setLyricGrouping)
  const advanceUnit = findParam(parameters, 'advanceUnit')
  const lyricGrouping: 'words' | 'lines' = numberOf(advanceUnit) >= 0.5 ? 'lines' : 'words'
  const text = findParam(parameters, 'text')
  const font = findParam(parameters, 'font')
  const colorMode = findParam(parameters, 'colorMode')
  const fontIndex = Math.round(numberOf(font))
  const invertBehind = numberOf(colorMode) >= 0.5

  const placed = new Set([
    'text', 'advanceUnit', 'font', 'fontSize', 'sizeMode', 'strokeWidth', 'shadow', 'opacity',
    'colorMode', 'color', 'strokeColor', 'hue', 'rainbowEnabled', 'rainbowCycleLength',
    'posX', 'posY', 'posMode',
    'onsetBounce', 'zoomFlash', 'sustain', 'releaseDuration', 'heightAmount',
    'delayTaps', 'delayTime', 'delayScaleFalloff', 'delayOpacityFalloff', 'pingPongEnabled', 'pingPongWidth',
    'flightEnabled', 'flightSpeed', 'flightMaxDepth', 'flightDrift', 'flightTumble', 'flightSubdivRate',
    'particleEnabled', 'particleCount', 'particleSize', 'particleGlow', 'particleOpaque', 'particleMorphBeats',
    'particleFillGap', 'particleStagger', 'particleVariation', 'particlePulse',
  ])
  const leftovers = parameters.filter((bound) => !placed.has(bound.definition.key))

  return (
    <section data-testid="text-display-user-interface" className="mb-3">
      {/* --- The lyric sheet: the reason this track exists --- */}
      <SectionLabel>TEXT</SectionLabel>
      {text && typeof text.value === 'string' && (
        <>
          <textarea
            value={text.value}
            onChange={(event) => text.setValue(event.target.value)}
            rows={5}
            spellCheck={false}
            aria-label="Words to display, in order"
            placeholder="Type the words, in order…"
            style={{ fontFamily: FONT_PREVIEWS[fontIndex]?.family }}
            className="min-h-[96px] w-full resize-y rounded border border-[var(--border)] bg-[var(--bg-app)] px-2.5 py-2 text-[13px] leading-snug text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <p className="mb-3 mt-1 text-[9px] leading-relaxed text-[var(--text-muted)]">
            space = next word · <span className="font-mono">|syl|la|bles|</span> · <span className="font-mono">!kept together!</span>
          </p>
        </>
      )}

      {/* --- Lyrics: how the words hit the screen --- */}
      <div className="mt-1 border-t border-[var(--border-subtle)] pt-3">
        <SectionLabel>LYRICS</SectionLabel>
        <div className="grid grid-cols-2 overflow-hidden rounded border border-[var(--border)]">
          {([
            { id: 'words', label: 'Word by word' },
            { id: 'lines', label: 'Whole lines' },
          ] as const).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setLyricGrouping(targetId, id)}
              aria-pressed={lyricGrouping === id}
              className={`h-7 text-[11px] font-medium transition-colors cursor-pointer ${
                lyricGrouping === id
                  ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                  : 'bg-[var(--bg-app)] text-[var(--text-3)] hover:text-[var(--text)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mb-3 mt-1 text-[9px] leading-relaxed text-[var(--text-muted)]">
          {lyricGrouping === 'lines'
            ? hasTiming
              ? 'One line per note, grouped from the sung timing. Edit line breaks freely.'
              : 'Each line of the sheet shows whole - one note advance per line.'
            : hasTiming
              ? 'One word per note, timed to the singing.'
              : 'One word per note advance.'}
        </p>
      </div>

      {/* --- Type: font specimens + the glyph sliders --- */}
      {font && font.definition.type === 'select' && (
        <div className="mb-2 grid grid-cols-4 gap-1">
          {font.definition.options.map((option) => {
            const preview = FONT_PREVIEWS[option.value]
            const active = fontIndex === option.value
            return (
              <button
                key={option.value}
                onClick={() => font.setValue(option.value)}
                aria-pressed={active}
                title={option.label}
                className={`flex flex-col items-center gap-0.5 rounded border py-1.5 transition-colors cursor-pointer ${active
                  ? 'border-[var(--accent-muted)] bg-[var(--bg-elevated)] text-[var(--text)]'
                  : 'border-[var(--border)] bg-[var(--bg-panel)] text-[var(--text-muted)] hover:text-[var(--text-3)]'}`}
              >
                <span className="text-[15px] leading-none" style={{ fontFamily: preview?.family }}>Ag</span>
                <span className="text-[7px] font-semibold tracking-[0.08em]">{preview?.short ?? option.label}</span>
              </button>
            )
          })}
        </div>
      )}
      <BoundSlider bound={findParam(parameters, 'fontSize')} />
      {(() => {
        // Directly under the Size slider, for the same reason posMode sits under
        // the placement sliders: it decides whether automating Size resizes every
        // word live or latches each word at its onset.
        const mode = findParam(parameters, 'sizeMode')
        if (!mode || typeof mode.value !== 'number') return null
        return (
          <ParamControl
            param={mode.definition}
            numValue={mode.value}
            strValue={undefined}
            onNum={mode.setValue}
          />
        )
      })()}
      <BoundSlider bound={findParam(parameters, 'strokeWidth')} />
      <BoundSlider bound={findParam(parameters, 'shadow')} />
      <BoundSlider bound={findParam(parameters, 'opacity')} />

      {/* --- Color --- */}
      <div className="mt-1 border-t border-[var(--border-subtle)] pt-3">
        <SectionLabel>COLOR</SectionLabel>
        {colorMode && colorMode.definition.type === 'select' && (
          <div className="mb-2.5 flex rounded border border-[var(--border)] p-0.5">
            {colorMode.definition.options.map((option) => {
              const active = Math.round(numberOf(colorMode)) === option.value
              return (
                <button
                  key={option.value}
                  onClick={() => colorMode.setValue(option.value)}
                  aria-pressed={active}
                  className={`flex-1 rounded-[2px] py-1 text-[10px] transition-colors cursor-pointer ${active
                    ? 'bg-[var(--bg-elevated)] text-[var(--text)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-3)]'}`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        )}
        <div className="mb-3 flex items-center gap-5" title={invertBehind ? 'Colors are ignored while inverting what is behind the text' : undefined}>
          <ColorWell bound={findParam(parameters, 'color')} label="Text" dimmed={invertBehind} />
          <ColorWell bound={findParam(parameters, 'strokeColor')} label="Stroke" dimmed={invertBehind} />
        </div>
        <BoundSlider bound={findParam(parameters, 'hue')} />
        <BoundToggleRow bound={findParam(parameters, 'rainbowEnabled')} />
        <BoundSlider bound={findParam(parameters, 'rainbowCycleLength')} />
      </div>

      {/* --- Placement: where on the frame the words land. Right-click either
              slider to automate it - that is how words get moved per line or
              along a path, and the reason these are params not an effect. --- */}
      <div className="border-t border-[var(--border-subtle)] pt-3">
        <SectionLabel>PLACEMENT</SectionLabel>
        <BoundSlider bound={findParam(parameters, 'posX')} />
        <BoundSlider bound={findParam(parameters, 'posY')} />
        {(() => {
          // Belongs directly under the two sliders it modifies - it decides whether
          // they move every word live or latch per word, and reading it at the
          // bottom of the panel with the generic leftovers gives no hint of that.
          const mode = findParam(parameters, 'posMode')
          if (!mode || typeof mode.value !== 'number') return null
          return (
            <ParamControl
              param={mode.definition}
              numValue={mode.value}
              strValue={undefined}
              onNum={mode.setValue}
            />
          )
        })()}
      </div>

      {/* --- Motion --- */}
      <div className="border-t border-[var(--border-subtle)] pt-3">
        <SectionLabel>MOTION</SectionLabel>
        <BoundSlider bound={findParam(parameters, 'onsetBounce')} />
        <BoundSlider bound={findParam(parameters, 'zoomFlash')} />
        <BoundToggleRow bound={findParam(parameters, 'sustain')} />
        <BoundSlider bound={findParam(parameters, 'releaseDuration')} />
        <BoundSlider bound={findParam(parameters, 'heightAmount')} />
      </div>

      {/* --- Echo (delay taps) - children appear once taps >= 1 --- */}
      <div className="border-t border-[var(--border-subtle)] pt-3">
        <SectionLabel>ECHO</SectionLabel>
        <BoundSlider bound={findParam(parameters, 'delayTaps')} />
        <BoundSlider bound={findParam(parameters, 'delayTime')} />
        <BoundSlider bound={findParam(parameters, 'delayScaleFalloff')} />
        <BoundSlider bound={findParam(parameters, 'delayOpacityFalloff')} />
        <BoundToggleRow bound={findParam(parameters, 'pingPongEnabled')} />
        <BoundSlider bound={findParam(parameters, 'pingPongWidth')} />
      </div>

      {/* --- Flight - the toggle lives in the header, sliders appear with it --- */}
      <div className="border-t border-[var(--border-subtle)] pt-3">
        {(() => {
          const flight = findParam(parameters, 'flightEnabled')
          return (
            <SectionLabel
              right={flight && typeof flight.value === 'number'
                ? <ParamToggle on={flight.value >= 0.5} onChange={(v) => flight.setValue(v ? 1 : 0)} label="Flight mode" />
                : undefined}
            >
              FLIGHT
            </SectionLabel>
          )
        })()}
        <BoundSlider bound={findParam(parameters, 'flightSpeed')} />
        <BoundSlider bound={findParam(parameters, 'flightMaxDepth')} />
        <BoundSlider bound={findParam(parameters, 'flightDrift')} />
        <BoundSlider bound={findParam(parameters, 'flightTumble')} />
        <BoundSlider bound={findParam(parameters, 'flightSubdivRate')} />
      </div>

      {/* --- Particle words - words become a morphing particle cloud; the
              sliders appear with the toggle (showIf) --- */}
      <div className="border-t border-[var(--border-subtle)] pt-3">
        {(() => {
          const particle = findParam(parameters, 'particleEnabled')
          return (
            <SectionLabel
              right={particle && typeof particle.value === 'number'
                ? <ParamToggle on={particle.value >= 0.5} onChange={(v) => particle.setValue(v ? 1 : 0)} label="Particle words" />
                : undefined}
            >
              PARTICLES
            </SectionLabel>
          )
        })()}
        <BoundSlider bound={findParam(parameters, 'particleCount')} />
        <BoundSlider bound={findParam(parameters, 'particleSize')} />
        <BoundSlider bound={findParam(parameters, 'particleGlow')} />
        <BoundToggleRow bound={findParam(parameters, 'particleOpaque')} />
        <BoundSlider bound={findParam(parameters, 'particleMorphBeats')} />
        <BoundToggleRow bound={findParam(parameters, 'particleFillGap')} />
        <BoundSlider bound={findParam(parameters, 'particleStagger')} />
        <BoundSlider bound={findParam(parameters, 'particleVariation')} />
        <BoundSlider bound={findParam(parameters, 'particlePulse')} />
      </div>

      {/* Anything the layout does not know about still gets a control. */}
      {leftovers.length > 0 && (
        <div className="border-t border-[var(--border-subtle)] pt-3">
          {leftovers.map((bound) => {
            const numeric = typeof bound.value === 'number'
            return (
              <ParamControl
                key={bound.definition.key}
                param={bound.definition}
                numValue={numeric ? (bound.value as number) : undefined}
                strValue={numeric ? undefined : (bound.value as string)}
                onNum={bound.setValue}
                onStr={bound.setValue}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

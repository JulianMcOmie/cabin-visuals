import { midiNoteBaseColor } from '../../utils/midiEditorPalette'

/**
 * The roll's blank state for the rare track whose declared MIDI vocabulary
 * resolves to ZERO rows (e.g. a Scene Switcher with no scenes to bind). The
 * grid stands down entirely — the caller swaps this in for MidiEditor — so
 * the state reads as deliberate instead of an empty scroller with nothing to
 * draw on. Chosen from a three-way in-app mock (glyph mark / ghost sketch /
 * type-only), 2026-08-15.
 */

/** A ghost of the editor the lane will become: row hairlines with dashed
 *  note slivers, fading out radially so it reads as an impression, never as
 *  rows you could click. */
function SketchMark({ hue }: { hue: string }) {
  const rows = [
    [{ x: 14, w: 34 }, { x: 92, w: 20 }],
    [{ x: 52, w: 22 }, { x: 128, w: 34 }],
    [{ x: 26, w: 18 }, { x: 106, w: 26 }],
    [{ x: 70, w: 30 }],
  ]
  return (
    <div
      aria-hidden="true"
      className="mb-4"
      style={{
        width: 200,
        maskImage: 'radial-gradient(ellipse 100% 90% at 50% 50%, black 30%, transparent 78%)',
        WebkitMaskImage: 'radial-gradient(ellipse 100% 90% at 50% 50%, black 30%, transparent 78%)',
      }}
    >
      {rows.map((notes, i) => (
        <div key={i} className="relative h-[15px] border-t border-white/[0.06] last:border-b">
          {notes.map(({ x, w }, j) => (
            <div
              key={j}
              className="absolute top-1/2 -translate-y-1/2 rounded-full"
              style={{ left: x, width: w, height: 3, backgroundColor: hue, opacity: 0.22 - i * 0.03 }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Fills the grid's slot. Copy sits just above center — dead center reads as
 *  floating, slightly high reads as composed. */
export function EmptyRollBlank({ trackColor }: { trackColor: string }) {
  const hue = midiNoteBaseColor(trackColor)
  return (
    <div className="flex flex-1 min-h-0 flex-col items-center justify-center pb-[6%] select-none">
      <div className="flex flex-col items-center text-center">
        <SketchMark hue={hue} />
        <p className="text-[19px] italic leading-[1.3] [font-family:var(--font-display)] text-[var(--text)]">
          This instrument doesn&apos;t respond to MIDI
        </p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--text-muted)]">
          Add a child track or adjust the instrument&apos;s settings to change its output.
        </p>
      </div>
    </div>
  )
}

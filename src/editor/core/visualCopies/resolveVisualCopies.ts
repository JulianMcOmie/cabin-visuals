import { identityVisualCopy } from './identityVisualCopy'
import type { MoverOrSplitter, VisualCopy } from './types'

/**
 * Hard maximum copy count. Chained splitters multiply, so an accidental
 * exponential explosion is one typo away; the cap bounds every step's output.
 * Overflow keeps the FIRST `MAX_VISUAL_COPIES` copies in pipeline order and
 * drops the rest - the next step sees the truncated count. Applied per step so
 * later steps never fan out from an over-cap intermediate result.
 */
export const MAX_VISUAL_COPIES = 1024

/**
 * Evaluates an ordered mover-and-splitter chain at one beat.
 *
 * Ordering rules (all deterministic):
 *  1. Chain entries execute strictly top to bottom.
 *  2. A step processes input copies in their existing order.
 *  3. A splitter emits slots in its own declared slot order.
 *  4. Nested output order is input-major, then splitter-slot order.
 *  5. The next step receives `index`/`count` for the complete result of the
 *     previous step.
 *
 * No MIDI, automation, envelope, project-track, React, or instrument logic
 * belongs here - definitions close over whatever resolved data they need.
 */
export function resolveVisualCopies(
  moverAndSplitterChain: MoverOrSplitter[],
  beat: number,
): VisualCopy[] {
  let visualCopies = [identityVisualCopy()]

  for (const moverOrSplitter of moverAndSplitterChain) {
    const previousVisualCopies = visualCopies
    const count = previousVisualCopies.length

    visualCopies = previousVisualCopies.flatMap((visualCopy, index) =>
      moverOrSplitter.apply(visualCopy, {
        beat,
        index,
        count,
      }),
    )

    if (visualCopies.length > MAX_VISUAL_COPIES) {
      visualCopies = visualCopies.slice(0, MAX_VISUAL_COPIES)
    }
  }

  return visualCopies
}

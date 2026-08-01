export const TRACK_LABEL_WIDTH = 168

/**
 * Half-width (px) of the ruler playhead triangle. The grid reserves a gutter of
 * this width to the left of the timeline (right of the label column) so the
 * triangle's left half shows at beat 0 instead of being clipped by the label.
 */
export const PLAYHEAD_TRIANGLE_HALF = 6

/**
 * Edge grab zones (the loop band's, a block's resize/loop handles) are SCREEN
 * space - CSS px, not content space - so a handle stays the same size under the
 * pointer at every zoom level; what zoom changes is how wide the THING it sits
 * on renders. Zoomed out that thing can get narrower than two handles plus a
 * middle, so the zone is capped at this share of the width: the middle always
 * survives as a move target and the handles degrade gently. Keep the share well
 * under 0.5 - at 0.5 the handles meet and the move zone disappears.
 */
const EDGE_HIT_MAX_SHARE = 0.4
export function edgeHitPx(widthPx: number, hitPx: number): number {
  return Math.min(hitPx, widthPx * EDGE_HIT_MAX_SHARE)
}

/** Inset from each loop-band edge that remains outside the draggable middle. */
export const LOOP_MOVE_EDGE_INSET = 10

/** Grab zone on each edge of a timeline block: the left/right resize handles and
 *  the top-right loop handle. Size it through edgeHitPx so a narrow block (deep
 *  zoom-out) keeps a usable target instead of collapsing to a couple of pixels. */
export const BLOCK_EDGE_HIT = 10
/** Shared loop-band fills, also used by its drag-alignment guides. Enabled is
 *  the accent blue; disabled is a plain grey - off reads as off. */
export const LOOP_REGION_ENABLED_COLOR = '#4da3d9'
export const LOOP_REGION_DISABLED_COLOR = 'rgba(155, 155, 155, 0.3)'

/**
 * Window-resize hit area (px) of the bottom panel's top Separator. Half of it
 * reaches down into the top of the tracks ruler; that strip is reserved for
 * resizing, so ruler scrubbing only starts below it (RULER_SCRUB_TOP_INSET).
 * Keeping the two coupled guarantees you can't resize and scrub at once.
 */
export const PANEL_RESIZE_HIT = 10
export const RULER_SCRUB_TOP_INSET = PANEL_RESIZE_HIT / 2

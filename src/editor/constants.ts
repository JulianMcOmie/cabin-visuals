export const TRACK_LABEL_WIDTH = 168

/**
 * Half-width (px) of the ruler playhead triangle. The grid reserves a gutter of
 * this width to the left of the timeline (right of the label column) so the
 * triangle's left half shows at beat 0 instead of being clipped by the label.
 */
export const PLAYHEAD_TRIANGLE_HALF = 6

/** Inset from each loop-band edge that remains outside the draggable middle. */
export const LOOP_MOVE_EDGE_INSET = 10
/** Shared loop-band fills, also used by its drag-alignment guides. */
export const LOOP_REGION_ENABLED_COLOR = '#4da3d9'
export const LOOP_REGION_DISABLED_COLOR = '#52525b'

/**
 * Window-resize hit area (px) of the bottom panel's top Separator. Half of it
 * reaches down into the top of the tracks ruler; that strip is reserved for
 * resizing, so ruler scrubbing only starts below it (RULER_SCRUB_TOP_INSET).
 * Keeping the two coupled guarantees you can't resize and scrub at once.
 */
export const PANEL_RESIZE_HIT = 10
export const RULER_SCRUB_TOP_INSET = PANEL_RESIZE_HIT / 2

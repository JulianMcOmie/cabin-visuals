export const TRACK_LABEL_WIDTH = 160

/** Playhead scrubbing snaps to this beat resolution (1/4 beat) everywhere. */
export const PLAYHEAD_SNAP_BEATS = 0.25

/**
 * Half-width (px) of the ruler playhead triangle. The grid reserves a gutter of
 * this width to the left of the timeline (right of the label column) so the
 * triangle's left half shows at beat 0 instead of being clipped by the label.
 */
export const PLAYHEAD_TRIANGLE_HALF = 10

/**
 * Window-resize hit area (px) of the bottom panel's top Separator. Half of it
 * reaches down into the top of the tracks ruler; that strip is reserved for
 * resizing, so ruler scrubbing only starts below it (RULER_SCRUB_TOP_INSET).
 * Keeping the two coupled guarantees you can't resize and scrub at once.
 */
export const PANEL_RESIZE_HIT = 10
export const RULER_SCRUB_TOP_INSET = PANEL_RESIZE_HIT / 2

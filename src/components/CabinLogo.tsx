// Inline version of /logo.svg (the "Console" redesign's tuned geometry) so the
// smoke puffs can be animated on hover. Tuning vs. the original drawing: even
// stroke weight (110 default), round caps/joins, true-vertical walls and
// chimney, roof/door apexes meet exactly (the tiny "dab" filler paths are
// gone), smoke carets centered on the chimney with even spacing. The billow
// animation lives in globals.css (.cabin-logo:hover .puff).

export function CabinLogo({ className, strokeWidth = 110 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 -65 5828 5815"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`cabin-logo ${className ?? ''}`}
    >
      <g stroke="white" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        {/* Walls */}
        <path d="M569.5 2580 V5684" />
        <path d="M5258.5 2580 V5684" />
        {/* Roof */}
        <path d="M9.4 2869.8 L2914 1421 L5818.6 2869.8" />
        {/* Door */}
        <path d="M2374.5 4189 V5684" />
        <path d="M3453.5 4189 V5684" />
        <path d="M2104.5 4328.6 L2914 3936.5 L3723.5 4328.6" />
        {/* Chimney (static) + its bottom caret */}
        <path d="M4107.7 978 V2016" />
        <path d="M5018 978 V2470" />
        <path d="M4002.8 1041.9 L4562.85 771.5 L5122.9 1041.9" />
        {/* Smoke — animated on hover (lower puff first: emits bottom→top) */}
        <g className="smoke">
          <g className="puff puff-1">
            <path d="M4002.8 660.6 L4562.85 390.2 L5122.9 660.6" />
          </g>
          <g className="puff puff-2">
            <path d="M4002.8 279.4 L4562.85 9 L5122.9 279.4" />
          </g>
        </g>
      </g>
    </svg>
  )
}

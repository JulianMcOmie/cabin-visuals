// Inline version of /logo.svg so the smoke puffs can be animated on hover.
// The smoke is the three caret-shaped line pairs above the chimney, each with its
// round-capped "filler" dabs kept in the same .puff group. The billow animation
// lives in globals.css (.cabin-logo:hover .puff). The chimney (two verticals) is static.

export function CabinLogo({ className, strokeWidth = 70 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 5828 5685"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`cabin-logo ${className ?? ''}`}
    >
      {/* Cabin walls + roof */}
      <line y1="-10.5" x2="3104.34" y2="-10.5" transform="matrix(0.000233141 1 -1 0.000232052 569.496 2580.1)" stroke="white" strokeWidth={strokeWidth} />
      <line y1="-10.5" x2="3245.42" y2="-10.5" transform="matrix(0.894845 -0.446376 0.448052 0.894007 9.40918 2869.84)" stroke="white" strokeWidth={strokeWidth} />
      <line y1="-10.5" x2="3104.34" y2="-10.5" transform="matrix(-0.000233141 1 1 0.000232052 5257.63 2580.1)" stroke="white" strokeWidth={strokeWidth} />
      <line y1="-10.5" x2="3245.42" y2="-10.5" transform="matrix(-0.894845 -0.446376 -0.448052 0.894007 5817.71 2869.84)" stroke="white" strokeWidth={strokeWidth} />

      {/* Door */}
      <line y1="-10.5" x2="1495.4" y2="-10.5" transform="matrix(0.000111384 1 -1 0.000485717 2374.1 4189.04)" stroke="white" strokeWidth={strokeWidth} />
      <line y1="-10.5" x2="887.331" y2="-10.5" transform="matrix(0.90005 -0.435787 0.701551 0.712619 2104.55 4328.61)" stroke="white" strokeWidth={strokeWidth} />
      <line y1="-10.5" x2="1495.4" y2="-10.5" transform="matrix(-0.000111384 1 1 0.000485717 3453.02 4189.04)" stroke="white" strokeWidth={strokeWidth} />
      <line y1="-10.5" x2="887.331" y2="-10.5" transform="matrix(-0.90005 -0.435787 -0.701551 0.712619 3701.83 4328.61)" stroke="white" strokeWidth={strokeWidth} />

      {/* Chimney (static) — verticals + the bottom caret and its filler dabs */}
      <line x1="4107.66" y1="977.86" x2="4106.47" y2="1992" stroke="white" strokeWidth={strokeWidth} />
      <line x1="5018" y1="977.989" x2="4998.18" y2="2448.49" stroke="white" strokeWidth={strokeWidth} />
      <line y1="-10.5" x2="621.993" y2="-10.5" transform="matrix(0.900471 -0.434916 0.702431 0.711752 3992.25 1046.46)" stroke="white" strokeWidth={strokeWidth} />
      <line y1="-10.5" x2="621.993" y2="-10.5" transform="matrix(-0.900471 -0.434916 -0.702431 0.711752 5112.42 1046.46)" stroke="white" strokeWidth={strokeWidth} />
      <path d="M4559.99 768.462C4559.88 768.449 4559.5 768.422 4559.11 768.225C4558.65 767.995 4558.19 767.774 4557.83 767.643C4557.41 767.491 4557.1 767.243 4556.76 766.984C4556.23 766.591 4555.79 766.567 4555.39 766.476C4555.04 766.396 4554.75 766.212 4554.42 766.072C4554.09 765.927 4553.8 765.789 4553.64 765.709C4553.56 765.667 4553.49 765.624 4553.41 765.561" stroke="white" strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M4544.54 768.492C4544.61 768.428 4544.95 768.288 4545.3 768.175C4545.67 768.055 4546.06 767.786 4546.5 767.593C4546.9 767.419 4547.31 767.234 4547.66 767.003C4547.99 766.78 4548.38 766.612 4548.85 766.4C4549.37 766.165 4549.86 765.907 4550.25 765.745C4550.66 765.572 4551.1 765.45 4551.52 765.314C4551.62 765.281 4551.71 765.258 4551.8 765.239C4551.88 765.22 4551.96 765.206 4552.05 765.192" stroke="white" strokeWidth={strokeWidth} strokeLinecap="round" />

      {/* Centre detail dabs (not smoke) */}
      <path d="M2918.38 1412.12C2918.17 1412.08 2917.59 1411.91 2917.04 1411.64C2916.46 1411.35 2915.96 1410.92 2915.39 1410.69C2915.24 1410.65 2915.1 1410.61 2914.95 1410.56C2914.81 1410.51 2914.67 1410.44 2914.15 1410.19" stroke="white" strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M2908.47 1411.82C2908.7 1411.77 2909.26 1411.51 2909.82 1411.2C2910.36 1410.89 2910.96 1410.71 2911.51 1410.45C2911.79 1410.35 2912.07 1410.23 2912.35 1410.11C2912.48 1410.04 2912.61 1409.96 2912.81 1409.88" stroke="white" strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M2910.49 3934.55C2910.41 3934.52 2910.08 3934.42 2909.79 3934.22C2909.45 3933.99 2909.17 3933.77 2908.87 3933.61C2908.49 3933.41 2908.13 3933.21 2907.84 3932.99C2907.56 3932.79 2907.25 3932.6 2906.97 3932.39C2906.67 3932.17 2906.34 3931.95 2906.04 3931.8C2905.71 3931.64 2905.44 3931.38 2905.18 3931.14C2905.11 3931.08 2905.04 3931.04 2904.96 3931.01C2904.89 3930.97 2904.81 3930.93 2904.72 3930.88" stroke="white" strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M2895.91 3934.04C2896 3934 2896.31 3933.85 2896.67 3933.76C2896.99 3933.67 2897.3 3933.56 2897.67 3933.46C2898.05 3933.36 2898.35 3933.17 2898.68 3933C2898.99 3932.83 2899.34 3932.68 2899.69 3932.53C2900.03 3932.39 2900.43 3932.23 2900.8 3932.07C2901.18 3931.94 2901.71 3931.66 2902.12 3931.46C2902.21 3931.43 2902.28 3931.39 2902.4 3931.33" stroke="white" strokeWidth={strokeWidth} strokeLinecap="round" />

      {/* Smoke — the two upper caret pairs + their filler dabs. Lower puff first
          so it emits bottom→top. */}
      <g className="smoke">
        <g className="puff puff-1">
          <line y1="-10.5" x2="621.993" y2="-10.5" transform="matrix(0.900471 -0.434916 0.702431 0.711752 3992.25 665.221)" stroke="white" strokeWidth={strokeWidth} />
          <line y1="-10.5" x2="621.993" y2="-10.5" transform="matrix(-0.900471 -0.434916 -0.702431 0.711752 5112.42 665.221)" stroke="white" strokeWidth={strokeWidth} />
          <path d="M4559.65 387.206C4559.5 387.126 4559.06 386.854 4558.32 386.476C4557.6 386.11 4556.97 385.783 4556.28 385.468C4555.72 385.227 4555.31 384.983 4555.02 384.84C4554.87 384.776 4554.71 384.731 4554.52 384.654" stroke="white" strokeWidth={strokeWidth} strokeLinecap="round" />
          <path d="M4544.73 386.909C4544.87 386.874 4545.36 386.685 4545.85 386.433C4546.36 386.176 4546.77 385.826 4547.28 385.714C4547.87 385.585 4548.5 385.307 4549.01 385.116C4549.5 384.934 4550.04 384.881 4550.61 384.725C4551.22 384.615 4551.64 384.55 4551.91 384.446C4552.07 384.408 4552.28 384.398 4552.35 384.72" stroke="white" strokeWidth={strokeWidth} strokeLinecap="round" />
        </g>
        <g className="puff puff-2">
          <line y1="-10.5" x2="621.993" y2="-10.5" transform="matrix(0.900471 -0.434916 0.702431 0.711752 3992.25 291.83)" stroke="white" strokeWidth={strokeWidth} />
          <line y1="-10.5" x2="621.993" y2="-10.5" transform="matrix(-0.900471 -0.434916 -0.702431 0.711752 5112.42 291.83)" stroke="white" strokeWidth={strokeWidth} />
          <path d="M4546.06 13.4989C4546.06 13.457 4546.32 13.2516 4546.83 12.9045C4547.1 12.7411 4547.37 12.6036 4547.64 12.4578C4547.92 12.3121 4548.19 12.1621 4548.73 12.0077" stroke="white" strokeWidth={strokeWidth} strokeLinecap="round" />
          <path d="M4561.1 12.9316C4560.72 12.764 4559.67 12.0729 4558.36 11.4905C4557.04 10.9014 4555.81 10.5708 4553.48 10.5282C4551.41 11.1477 4549.98 11.7523 4548.36 12.5296C4547.99 12.7473 4547.73 12.9492 4547.37 13.3154" stroke="white" strokeWidth={strokeWidth} strokeLinecap="round" />
        </g>
      </g>
    </svg>
  )
}

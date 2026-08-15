import type { ReactNode } from 'react'
import { getMoverOrSplitterDefinition } from '../../core/visualCopies/registry'
import { isSceneTrackId } from '../../core/sceneTrack'
import { normalizeFundamentalGeometry, type FundamentalGeometryId } from '../../instruments/FundamentalGeometry'
import type { Track } from '../../types'

/**
 * The track-row glyph family: one small mark per instrument / device / lane
 * kind, drawn MONOTONE in `currentColor` so the row can tint it with the
 * track's display color.
 *
 * Deliberately NOT the library's icon set (LeftSidebar's `ALL_OBJECT_INSTRUMENTS`).
 * Those are 12px full-color miniatures - four fill opacities, per-element hues -
 * which is right for a card that is selling the instrument and wrong here: a
 * multi-tone mark cannot be tinted (there is no single color to replace), and at
 * a 44px row's scale the color does the identifying, so thirty differently-hued
 * marks in one column read as confetti. Here the COLOR is the track's and the
 * SHAPE is the instrument's, which is the only split that lets both be read.
 *
 * Drawing rules for a new glyph, so the column stays even:
 * - 16x16 viewBox, everything inside a 12px optical box (x/y 2..14).
 * - Stroke 1.3 (set once on the <svg>), round caps and joins; `fill="none"`
 *   inherited, so a filled element declares `fill="currentColor"` itself.
 * - One idea per mark. Two or three elements; four is already too busy at 14px.
 * - Silhouette first: the mark must survive being read at a glance in a column
 *   of thirty. Two instruments sharing an outer shape is the failure mode (see
 *   the library tab marks, which hit exactly that).
 */

const G = {
  // ─── Object instruments ────────────────────────────────────────────────────
  // (3D Shape has no entry here on purpose - it resolves through SOLIDS below,
  // by the geometry the track is set to.)
  kaleidoSolid: (
    <>
      <circle cx="8" cy="8" r="5.4" />
      <path d="M8 2.6V8l4.7 2.7M8 8 3.3 10.7" />
    </>
  ),
  circle: <circle cx="8" cy="8" r="5.4" />,
  triangle: <path d="M8 2.6 13.6 12.6H2.4Z" />,
  icosahedronBurst: (
    <>
      <path d="M8 5.6 10.4 8 8 10.4 5.6 8Z" />
      <path d="M8 2 14 8l-6 6-6-6Z" strokeDasharray="2.2 2" strokeOpacity="0.75" />
    </>
  ),
  textDisplay: (
    <>
      <path d="M3.4 4.2h9.2" />
      <path d="M8 4.2v8.2M6 12.4h4" />
    </>
  ),
  stars: (
    <>
      <path d="M8 2.6 9.2 6.4 13 7.6 9.2 8.8 8 12.6 6.8 8.8 3 7.6 6.8 6.4Z" />
      <circle cx="12.8" cy="3.4" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="3.4" cy="12.4" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  particleBurst: (
    <>
      <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
      <path d="M8 4.4V2.2M8 11.6v2.2M4.4 8H2.2M11.6 8h2.2M5.3 5.3 3.8 3.8M10.7 10.7l1.5 1.5M10.7 5.3l1.5-1.5M5.3 10.7l-1.5 1.5" />
    </>
  ),
  fractalTunnel: (
    <>
      <circle cx="8" cy="8" r="1.6" />
      <circle cx="8" cy="8" r="3.6" />
      <circle cx="8" cy="8" r="5.6" strokeOpacity="0.6" />
    </>
  ),
  neonPolar: <path d="M8 2.4c3.4 1.4 2.6 3.6 1.8 5 1.6 1.6 1 3.6-1.8 4.6-2.8-1-3.4-3-1.8-4.6-.8-1.4-1.6-3.6 1.8-5Z" />,
  hopfFibration: (
    <>
      <ellipse cx="8" cy="8" rx="5.6" ry="2.6" />
      <ellipse cx="8" cy="8" rx="2.6" ry="5.6" />
    </>
  ),
  shapeFlight: (
    <>
      <path d="M8 2.4 13.4 8 8 13.6 2.6 8Z" />
      <path d="M8 5.6 10.4 8 8 10.4 5.6 8Z" strokeOpacity="0.7" />
    </>
  ),
  dotField: (
    <g fill="currentColor" stroke="none">
      <circle cx="3.4" cy="5" r="1" /><circle cx="8" cy="4.2" r="1" /><circle cx="12.6" cy="5" r="1" />
      <circle cx="3.4" cy="9" r="1" /><circle cx="8" cy="8.2" r="1.3" /><circle cx="12.6" cy="9" r="1" />
      <circle cx="5.6" cy="12.4" r="1" /><circle cx="10.4" cy="12.4" r="1" />
    </g>
  ),
  metronomeBalls: (
    <>
      <path d="M8 3.2 4 11.4M8 3.2l4 8.2M8 3.2v8.2" />
      <g fill="currentColor" stroke="none">
        <circle cx="4" cy="12" r="1.2" /><circle cx="8" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" />
      </g>
    </>
  ),
  emojiDisplay: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <path d="M5.6 9.6a3 3 0 0 0 4.8 0" />
      <g fill="currentColor" stroke="none"><circle cx="6" cy="6.4" r="0.9" /><circle cx="10" cy="6.4" r="0.9" /></g>
    </>
  ),
  filmStock: (
    <>
      <rect x="2.4" y="2.8" width="11.2" height="10.4" rx="1.2" />
      <path d="M5.2 2.8v10.4M10.8 2.8v10.4" strokeDasharray="1.6 1.6" strokeOpacity="0.8" />
    </>
  ),
  filmGrain: (
    <>
      <rect x="2.6" y="2.6" width="10.8" height="10.8" rx="1.2" strokeDasharray="2.4 1.8" />
      <g fill="currentColor" stroke="none">
        <circle cx="6" cy="6" r="0.75" /><circle cx="10" cy="5.4" r="0.6" /><circle cx="8.2" cy="9" r="0.8" />
        <circle cx="5.4" cy="10.2" r="0.6" /><circle cx="10.6" cy="9.8" r="0.7" />
      </g>
    </>
  ),
  scribble: <path d="M2.6 10.6c2.6 2.6 5.4 1 6-1.2.6-2.2-2-2-1.4-4C7.8 3.4 10.6 3 13.4 5" />,
  filmCard: (
    <>
      <rect x="2.4" y="3.4" width="11.2" height="9.2" rx="1" />
      <path d="M4.8 8h6.4" />
    </>
  ),
  pixelBlast: (
    <g fill="currentColor" stroke="none">
      <rect x="6.8" y="6.8" width="2.4" height="2.4" />
      <rect x="2.6" y="7" width="2" height="2" /><rect x="11.4" y="7" width="2" height="2" />
      <rect x="7" y="2.6" width="2" height="2" /><rect x="7" y="11.4" width="2" height="2" />
      <rect x="4" y="4" width="1.4" height="1.4" /><rect x="10.6" y="10.6" width="1.4" height="1.4" />
    </g>
  ),
  video: (
    <>
      <rect x="2.4" y="3.6" width="11.2" height="8.8" rx="1.2" />
      <path d="M6.8 6.4 10 8l-3.2 1.6Z" fill="currentColor" />
    </>
  ),
  photo: (
    <>
      <rect x="2.4" y="3.6" width="11.2" height="8.8" rx="1.2" />
      <path d="M2.9 11.4 6.4 8l2 1.7L10.4 8l2.7 3.4" />
      <circle cx="5.6" cy="6.2" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  oscilloscope: <path d="M1.8 8h1.9l1.3-4.6 2 9.2 1.9-6.6 1.6 4.4L13 8h1.2" />,
  colorFilters: (
    <>
      <circle cx="6.2" cy="6.4" r="3.6" />
      <circle cx="9.8" cy="6.4" r="3.6" strokeOpacity="0.75" />
      <circle cx="8" cy="9.8" r="3.6" strokeOpacity="0.5" />
    </>
  ),
  bassRipple: (
    <>
      <path d="M2 4.6q2.6-2.6 5.2 0t5.2 0" strokeOpacity="0.6" />
      <path d="M2 8q2.6-2.6 5.2 0T12.4 8" />
      <path d="M2 11.4q2.6-2.6 5.2 0t5.2 0" strokeOpacity="0.6" />
    </>
  ),
  impactWarp: (
    <>
      <rect x="5.6" y="5.6" width="4.8" height="4.8" rx="0.6" />
      <path d="M4.4 4.4 2 2M11.6 4.4 14 2M4.4 11.6 2 14M11.6 11.6 14 14" />
    </>
  ),
  strobe: <path d="M9.2 1.8 4.2 8.8h3.2l-.6 5.4 5.4-7.4H8.6Z" fill="currentColor" strokeLinejoin="round" />,
  laserSphere: (
    <>
      <circle cx="8" cy="8" r="5.4" strokeOpacity="0.55" />
      <circle cx="8" cy="8" r="2.4" fill="currentColor" stroke="none" />
    </>
  ),
  laserLine: (
    <>
      <path d="M2 8h12" strokeWidth="3.4" strokeOpacity="0.25" />
      <path d="M2 8h12" />
    </>
  ),
  wormhole: (
    <>
      <ellipse cx="8" cy="8" rx="5.8" ry="4.4" strokeOpacity="0.45" />
      <ellipse cx="8.6" cy="8" rx="3.4" ry="2.6" strokeOpacity="0.75" />
      <circle cx="9.4" cy="8" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  particleSphere: (
    <g fill="currentColor" stroke="none">
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
        const rad = (deg * Math.PI) / 180
        return <circle key={deg} cx={8 + Math.cos(rad) * 5} cy={8 + Math.sin(rad) * 5} r="1.05" />
      })}
      <circle cx="8" cy="8" r="1.2" fillOpacity="0.5" />
    </g>
  ),
  photoSlot: (
    <>
      <path d="M2.6 5.4V3.4h2M11.4 3.4h2v2M13.4 10.6v2h-2M4.6 12.6h-2v-2" />
      <rect x="5.8" y="6" width="4.4" height="4" rx="0.6" fill="currentColor" fillOpacity="0.35" />
    </>
  ),
  polyFx: (
    <>
      <path d="M2.4 13.6 13.6 2.4" strokeWidth="2.4" />
      <path d="M2.4 2.4 13.6 13.6" strokeOpacity="0.6" />
    </>
  ),
  midiRoll: (
    <>
      <path d="M2.2 4.4h4.6M9 8h4.8M4.6 11.6h4.2" strokeWidth="1.8" strokeOpacity="0.8" />
      <path d="M8 6.4 9.6 8 8 9.6 6.4 8Z" fill="currentColor" stroke="none" />
    </>
  ),
  waterDrop: (
    <>
      <path d="M8 2.4c2.2 2.6 3.4 4.2 3.4 5.8a3.4 3.4 0 0 1-6.8 0c0-1.6 1.2-3.2 3.4-5.8Z" />
      <path d="M3 12.6q5-2.2 10 0" strokeOpacity="0.55" />
    </>
  ),
  flashWall: (
    <g fill="currentColor" stroke="none">
      <rect x="2" y="3" width="2.4" height="10" rx="0.7" fillOpacity="0.3" />
      <rect x="5.2" y="3" width="2.4" height="10" rx="0.7" />
      <rect x="8.4" y="3" width="2.4" height="10" rx="0.7" fillOpacity="0.5" />
      <rect x="11.6" y="3" width="2.4" height="10" rx="0.7" fillOpacity="0.25" />
    </g>
  ),
  overlapShape: (
    <>
      <circle cx="6" cy="8" r="4" />
      <circle cx="10" cy="8" r="4" />
    </>
  ),
  overlapSolid: (
    <>
      <rect x="2.4" y="4.4" width="7.2" height="7.2" rx="1" />
      <rect x="6.4" y="4.4" width="7.2" height="7.2" rx="1" />
    </>
  ),
  crop: (
    <>
      <path d="M5.6 2.4 3.4 13.6" strokeWidth="2.6" />
      <path d="M11.4 2.4 9.2 13.6" strokeWidth="2.6" strokeOpacity="0.45" />
    </>
  ),
  wireframe: (
    <>
      <path d="M8 2.4 13 5.2v5.6L8 13.6 3 10.8V5.2Z" />
      <path d="M3 5.2 13 10.8M13 5.2 3 10.8M8 2.4v11.2" strokeOpacity="0.6" />
    </>
  ),
  cameraControl: (
    <>
      <rect x="2" y="4.6" width="8.4" height="6.8" rx="1.2" />
      <path d="M10.4 6.8 14 5v6l-3.6-1.8Z" />
    </>
  ),
  cameraOrbit: (
    <>
      <ellipse cx="8" cy="9.4" rx="5.8" ry="2.8" />
      <circle cx="8" cy="9.4" r="1.2" fill="currentColor" stroke="none" />
      <rect x="9.8" y="1.8" width="4.2" height="3.2" rx="0.8" />
    </>
  ),

  // ─── Movers ────────────────────────────────────────────────────────────────
  mover: (
    <>
      <path d="M2.6 8h10.8" />
      <path d="M10.6 5 13.4 8l-2.8 3M5.4 5 2.6 8l2.8 3" />
    </>
  ),
  motion: (
    <>
      <path d="M2 10q2.6-4 5.2 0t5.2 0" />
      <path d="M11.2 2.6 14 5.4l-2.8 2.8" />
    </>
  ),
  physics: (
    <>
      <path d="M2.4 12.6c1.6-6.4 5-9 9.4-9.6" strokeDasharray="2.4 1.8" />
      <circle cx="11.6" cy="3.4" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  waypoints: (
    <>
      <path d="M3.2 12q1.6-6 5.4-6t4.2 4" strokeDasharray="2 1.8" />
      <g fill="currentColor" stroke="none">
        <circle cx="3.2" cy="12" r="1.4" /><circle cx="8.6" cy="6" r="1.4" /><circle cx="12.8" cy="10" r="1.4" />
      </g>
    </>
  ),
  impactPulse: (
    <>
      <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
      <path d="M4.4 4.4a5 5 0 0 0 0 7.2M11.6 4.4a5 5 0 0 1 0 7.2" />
    </>
  ),
  impactScatter: (
    <>
      <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
      <g fill="currentColor" stroke="none" fillOpacity="0.85">
        <circle cx="3" cy="4.6" r="1" /><circle cx="13" cy="5.4" r="1" />
        <circle cx="4.2" cy="12.4" r="1" /><circle cx="12.4" cy="11.6" r="1" />
      </g>
    </>
  ),
  forceFieldPush: (
    <>
      <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
      <path d="M8 4.6V2M8 11.4V14M4.6 8H2M11.4 8H14" strokeOpacity="0.85" />
      <circle cx="8" cy="8" r="4.6" strokeDasharray="1.6 2" strokeOpacity="0.6" />
    </>
  ),
  freeze: (
    <>
      <path d="M8 2v12M2.8 5 13.2 11M13.2 5 2.8 11" />
      <path d="M6.4 3.4 8 4.8l1.6-1.4M6.4 12.6 8 11.2l1.6 1.4" strokeOpacity="0.7" />
    </>
  ),
  conveyor: (
    <>
      <path d="M2.2 11.4h11.6" />
      <g fill="currentColor" stroke="none"><circle cx="4" cy="13" r="1.1" /><circle cx="12" cy="13" r="1.1" /></g>
      <path d="M5.4 6.4h5.2M9 4.2l2.2 2.2L9 8.6" />
    </>
  ),
  approach: (
    <>
      <path d="M4.4 2.6 8 6.2l3.6-3.6" strokeOpacity="0.45" />
      <path d="M4.4 6.6 8 10.2l3.6-3.6" strokeOpacity="0.75" />
      <path d="M4.4 10.4 8 14l3.6-3.6" />
    </>
  ),
  contour: (
    <>
      <path d="M2 11.6q3-6.4 6-6.4t6 6.4" />
      <path d="M4.4 13.4q3.6-4.4 7.2 0" strokeOpacity="0.55" />
      <path d="M8 5.2V2.4" strokeOpacity="0.7" />
    </>
  ),
  radialMotion: (
    <>
      <circle cx="8" cy="8" r="2" />
      <circle cx="8" cy="8" r="5.4" strokeDasharray="3.2 2.4" />
      <path d="M11.6 3.6 13.6 4l-.4 2" strokeOpacity="0.85" />
    </>
  ),
  symmetricMotion: (
    <>
      <path d="M8 2.4v11.2" strokeDasharray="1.8 1.8" strokeOpacity="0.6" />
      <path d="M6.4 8H2.6M4.4 5.8 2.2 8l2.2 2.2M9.6 8h3.8M11.6 5.8 13.8 8l-2.2 2.2" />
    </>
  ),
  allMovers: (
    <>
      <path d="M8 2.4v11.2M2.4 8h11.2M4 4l8 8M12 4l-8 8" strokeOpacity="0.8" />
      <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  visibility: (
    <>
      <path d="M1.8 8s2.4-4.2 6.2-4.2S14.2 8 14.2 8s-2.4 4.2-6.2 4.2S1.8 8 1.8 8Z" />
      <circle cx="8" cy="8" r="1.7" fill="currentColor" stroke="none" />
    </>
  ),
  meteorImpact: (
    <>
      <path d="M2.4 2.4 8.6 8.6" strokeOpacity="0.6" />
      <circle cx="9.8" cy="9.8" r="2" fill="currentColor" stroke="none" />
      <path d="M4.6 13.8q5.2-2 9.2 0" strokeOpacity="0.7" />
    </>
  ),
  bypass: (
    <>
      <path d="M8 2.4v5.2" />
      <path d="M4.4 4.6a5 5 0 1 0 7.2 0" />
    </>
  ),

  // ─── Splitters ─────────────────────────────────────────────────────────────
  radial: (
    <>
      <circle cx="8" cy="8" r="1.4" />
      <g fill="currentColor" stroke="none">
        <circle cx="8" cy="2.6" r="1.3" /><circle cx="12.7" cy="5.3" r="1.3" /><circle cx="12.7" cy="10.7" r="1.3" />
        <circle cx="8" cy="13.4" r="1.3" /><circle cx="3.3" cy="10.7" r="1.3" /><circle cx="3.3" cy="5.3" r="1.3" />
      </g>
    </>
  ),
  line: (
    <>
      <rect x="1.8" y="5.4" width="5.2" height="5.2" rx="0.8" />
      <rect x="7.8" y="6.4" width="3.6" height="3.6" rx="0.6" strokeOpacity="0.75" />
      <rect x="12" y="7.2" width="2.2" height="2.2" rx="0.4" strokeOpacity="0.5" />
    </>
  ),
  grid: (
    <g strokeOpacity="0.95">
      <rect x="2.2" y="2.2" width="3.4" height="3.4" rx="0.5" />
      <rect x="6.3" y="2.2" width="3.4" height="3.4" rx="0.5" />
      <rect x="10.4" y="2.2" width="3.4" height="3.4" rx="0.5" />
      <rect x="2.2" y="6.3" width="3.4" height="3.4" rx="0.5" />
      <rect x="6.3" y="6.3" width="3.4" height="3.4" rx="0.5" />
      <rect x="10.4" y="6.3" width="3.4" height="3.4" rx="0.5" />
      <rect x="2.2" y="10.4" width="3.4" height="3.4" rx="0.5" />
      <rect x="6.3" y="10.4" width="3.4" height="3.4" rx="0.5" />
      <rect x="10.4" y="10.4" width="3.4" height="3.4" rx="0.5" />
    </g>
  ),
  symmetry: (
    <>
      <path d="M8 1.8v12.4" strokeDasharray="1.8 1.8" strokeOpacity="0.6" />
      <path d="M6.4 3.6 2.2 8l4.2 4.4ZM9.6 3.6 13.8 8l-4.2 4.4Z" />
    </>
  ),
  polyhedron: (
    <>
      <path d="M8 2 13.6 6.2 11.4 12.8H4.6L2.4 6.2Z" />
      <g fill="currentColor" stroke="none" fillOpacity="0.9">
        <circle cx="8" cy="2" r="1.1" /><circle cx="13.6" cy="6.2" r="1.1" /><circle cx="11.4" cy="12.8" r="1.1" />
        <circle cx="4.6" cy="12.8" r="1.1" /><circle cx="2.4" cy="6.2" r="1.1" />
      </g>
    </>
  ),
  tunnel: (
    <>
      <rect x="1.8" y="1.8" width="12.4" height="12.4" rx="1.6" strokeOpacity="0.45" />
      <rect x="4.4" y="4.4" width="7.2" height="7.2" rx="1.2" strokeOpacity="0.75" />
      <rect x="6.8" y="6.8" width="2.4" height="2.4" rx="0.6" />
    </>
  ),
  duplicateTrail: (
    <>
      <rect x="2" y="2" width="7" height="7" rx="1" strokeOpacity="0.45" />
      <rect x="4.4" y="4.4" width="7" height="7" rx="1" strokeOpacity="0.7" />
      <rect x="6.8" y="6.8" width="7" height="7" rx="1" />
    </>
  ),
  parametricPattern: (
    <>
      <path d="M2.6 8c0-3 2.4-5.4 5.4-5.4S13.4 5 13.4 8 11 13.4 8 13.4 2.6 11 2.6 8Z" strokeDasharray="2.6 2.2" strokeOpacity="0.6" />
      <path d="M3.4 10.6q4.6-8 9.2 0" />
    </>
  ),
  waveTerrain: (
    <>
      <path d="M1.8 6q3-3 6.2 0t6.2 0" />
      <path d="M1.8 9.4q3-3 6.2 0t6.2 0" strokeOpacity="0.75" />
      <path d="M1.8 12.8q3-3 6.2 0t6.2 0" strokeOpacity="0.5" />
    </>
  ),
  symmetricRotation: (
    <>
      <path d="M4.4 4.4a5 5 0 0 1 7.2 0" />
      <path d="M11.6 11.6a5 5 0 0 1-7.2 0" />
      <path d="M11.6 2.4v2.6H9M4.4 13.6V11H7" />
    </>
  ),

  // ─── Colorizers ────────────────────────────────────────────────────────────
  hueRotate: (
    <>
      <circle cx="8" cy="8" r="5.4" strokeDasharray="4.2 2.6" />
      <circle cx="8" cy="8" r="1.8" fill="currentColor" stroke="none" />
    </>
  ),
  gradient: (
    <>
      <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.4" />
      <path d="M4.4 11.8 11.8 4.4M6.8 12.6l5.8-5.8M4 9.4l5.4-5.4" strokeOpacity="0.55" />
    </>
  ),
  cosinePalette: (
    <>
      <path d="M1.8 9.6q3.1-6.4 6.2 0t6.2 0" />
      <g fill="currentColor" stroke="none">
        <circle cx="4.9" cy="6.4" r="1.1" /><circle cx="11.1" cy="6.4" r="1.1" /><circle cx="8" cy="9.6" r="1.1" fillOpacity="0.6" />
      </g>
    </>
  ),
  riso: (
    <>
      <circle cx="6.2" cy="7.4" r="4.2" />
      <circle cx="9.8" cy="8.6" r="4.2" strokeDasharray="1.6 1.6" />
    </>
  ),

  // ─── Lane / container kinds ────────────────────────────────────────────────
  automation: (
    <>
      <path d="M2.2 11.6q3.4 0 4.4-4.4t4.4-2.6h2.8" />
      <g fill="currentColor" stroke="none">
        <circle cx="2.6" cy="11.6" r="1.3" /><circle cx="6.6" cy="7.2" r="1.3" /><circle cx="13" cy="4.6" r="1.3" />
      </g>
    </>
  ),
  envelope: <path d="M2 13 5 3.4l2.6 6.2h2.4L14 13" />,
  ability: (
    <>
      <path d="M8 2 9.4 6.6 14 8l-4.6 1.4L8 14l-1.4-4.6L2 8l4.6-1.4Z" />
    </>
  ),
  group: <path d="M2.2 12.6V4.2a1 1 0 0 1 1-1h3l1.6 2h5a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1H3.2a1 1 0 0 1-1-1Z" />,
  switcher: (
    <>
      <rect x="1.8" y="3.2" width="12.4" height="4" rx="2" />
      <circle cx="4" cy="5.2" r="1.2" fill="currentColor" stroke="none" />
      <rect x="1.8" y="8.8" width="12.4" height="4" rx="2" strokeOpacity="0.6" />
      <circle cx="12" cy="10.8" r="1.2" fill="currentColor" stroke="none" fillOpacity="0.6" />
    </>
  ),
  audio: (
    <g strokeLinecap="round">
      <path d="M2.4 6.6v2.8M5.2 4.4v7.2M8 2.6v10.8M10.8 5.2v5.6M13.6 7v2" />
    </g>
  ),
  composition: (
    <>
      <rect x="2" y="4.6" width="8.4" height="8.4" rx="1.2" />
      <path d="M5.6 3h6.2a2 2 0 0 1 2 2v6.2" strokeOpacity="0.6" />
    </>
  ),
  // Composition instruments (core/directors) - `base` tracks on the Composite
  // scene, so they resolve through the same instrumentId lookup.
  scene: (
    <>
      <rect x="2.2" y="3.4" width="11.6" height="9.2" rx="1.2" />
      <path d="M2.2 10.2 6 6.8l2.4 2 2-1.6 3.4 3" strokeOpacity="0.7" />
    </>
  ),
  sceneSwitcher: (
    <>
      <rect x="2" y="2.4" width="7.6" height="7.6" rx="1.1" strokeOpacity="0.5" />
      <rect x="6.4" y="6" width="7.6" height="7.6" rx="1.1" />
    </>
  ),
  cut: (
    <>
      <rect x="2.2" y="2.6" width="11.6" height="10.8" rx="1.2" />
      <path d="M10.2 2.6 5.8 13.4" strokeWidth="1.6" />
    </>
  ),
  radialCut: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <circle cx="8" cy="8" r="2.6" strokeOpacity="0.7" />
      <path d="M8 2.4V13.6" strokeOpacity="0.5" />
    </>
  ),
  unknown: <circle cx="8" cy="8" r="4.6" strokeDasharray="2.2 2" />,
} satisfies Record<string, ReactNode>

/**
 * 3D Shape follows its GEOMETRY picker: one mark per solid in the
 * `FundamentalGeometry` vocabulary, so a track set to Torus wears a torus.
 *
 * The vocabulary is append-only (a track stores the id string), so this record
 * is keyed by `FundamentalGeometryId` and TypeScript will name a new solid the
 * day it is added rather than letting it silently fall back to a cube.
 *
 * All twelve are drawn in the same three-quarter view with a lit top face and
 * one visible side, so switching geometry reads as the same object changing
 * shape rather than as twelve unrelated pictures.
 */
const SOLIDS: Record<FundamentalGeometryId, ReactNode> = {
  cube: (
    <>
      <path d="M8 2.4 13 5.2v5.6L8 13.6 3 10.8V5.2Z" />
      <path d="M3 5.2 8 8l5-2.8M8 8v5.6" />
    </>
  ),
  tetrahedron: (
    <>
      <path d="M8 2.2 13.4 12.4H2.6Z" />
      <path d="M8 2.2v7.4M8 9.6 2.6 12.4M8 9.6l5.4 2.8" strokeOpacity="0.7" />
    </>
  ),
  octahedron: (
    <>
      <path d="M8 1.8 13.4 8 8 14.2 2.6 8Z" />
      <path d="M2.6 8h10.8M8 1.8v12.4" strokeOpacity="0.6" />
    </>
  ),
  dodecahedron: (
    <>
      <path d="M8 1.9 14 6.3l-2.3 7.1H4.3L2 6.3Z" />
      <path d="M8 5.4 10.9 7.5l-1.1 3.4H6.2L5.1 7.5Z" strokeOpacity="0.6" />
    </>
  ),
  icosahedron: (
    <>
      <path d="M8 1.9 13.7 5.2v6.6L8 15.1 2.3 11.8V5.2Z" />
      <path d="M8 1.9 4.8 8l3.2 6.1M8 1.9 11.2 8 8 14.1M2.3 5.2 4.8 8l-2.5 3.8M13.7 5.2 11.2 8l2.5 3.8M4.8 8h6.4" strokeOpacity="0.55" />
    </>
  ),
  sphere: (
    <>
      <circle cx="8" cy="8" r="5.6" />
      <ellipse cx="8" cy="8" rx="5.6" ry="2.2" strokeOpacity="0.6" />
    </>
  ),
  cylinder: (
    <>
      <ellipse cx="8" cy="4.2" rx="4.4" ry="1.8" />
      <path d="M3.6 4.2v7.6M12.4 4.2v7.6" />
      <path d="M3.6 11.8a4.4 1.8 0 0 0 8.8 0" />
    </>
  ),
  prism: (
    <>
      <path d="M5.4 2.6 10.8 5v5.4l-5.4 2.4Z" />
      <path d="M5.4 2.6 2.2 5.6v5.4l3.2-3.2M2.2 5.6 5.4 8.2" strokeOpacity="0.7" />
    </>
  ),
  cone: (
    <>
      <path d="M8 2.2 12.4 11.4M8 2.2 3.6 11.4" />
      <ellipse cx="8" cy="11.4" rx="4.4" ry="1.8" />
    </>
  ),
  capsule: (
    <>
      <path d="M5.2 6.4a2.8 2.8 0 0 1 5.6 0v3.2a2.8 2.8 0 0 1-5.6 0Z" />
      <ellipse cx="8" cy="6.4" rx="2.8" ry="1.2" strokeOpacity="0.6" />
    </>
  ),
  // The hole carries most of the width: a SMALL inner ellipse inside a wide
  // outer one is an eye, not a donut - and the Visibility mover's mark is an
  // eye, so a tight hole here collides with it at 15px.
  torus: (
    <>
      <ellipse cx="8" cy="8" rx="6.1" ry="3.5" />
      <ellipse cx="8" cy="8" rx="3.5" ry="1.7" strokeOpacity="0.8" />
    </>
  ),
  torusKnot: (
    <>
      <path d="M8 2.4c3.6 0 5.2 3.4 3.4 6.2s-6.8 2.6-6.8-1 4.6-4.6 6.4-1.6 0 7.6-3 7.6-4.6-2.4-4.6-4.4" />
    </>
  ),
}

/** Aliases: ids that share a mark with one already drawn above. */
const ALIAS: Record<string, keyof typeof G> = {
  // The 2026-08 mover consolidation retired these ids from the registry, but a
  // legacy track can still carry one until its project is upgraded.
  burst: 'mover',
  rotateBurst: 'symmetricRotation',
  orbitBurst: 'radialMotion',
  constantRotate: 'symmetricRotation',
  constantOrbit: 'radialMotion',
  translationOscillator: 'motion',
  // Colorizer definition ids → their family marks.
  calmHueRotate: 'hueRotate',
  colorizer: 'hueRotate',
}

/** Family fallback for a device id with no mark of its own. */
const FAMILY: Record<string, keyof typeof G> = {
  mover: 'mover',
  splitter: 'radial',
  colorizer: 'hueRotate',
  parentGate: 'bypass',
}

function glyphFor(id: string | undefined): ReactNode | undefined {
  if (!id) return undefined
  const key = (ALIAS[id] ?? id) as keyof typeof G
  return G[key]
}

/**
 * The mark a track wears, as the CHILDREN of a 16x16 `currentColor` svg
 * (TrackIcon draws the svg itself, so a look can size and weight it).
 *
 * Pure function of the track - no store read - so it costs a memoized row
 * nothing and cannot make one re-render (see the render budget in this
 * directory's guide).
 */
export function trackGlyph(track: Track, isCompositionTrack = false): ReactNode {
  // The scene instrument (core/sceneTrack.ts) materializes as a `group` track,
  // but it is the SCENE exposed as a device - a folder mark would say the one
  // thing it is not, since its children are only its own lanes and the scene's
  // objects stay at root beside it.
  if (isSceneTrackId(track.id)) return G.scene
  switch (track.type) {
    case 'audio':
      return G.audio
    case 'group':
      return G.group
    case 'switcher':
      return G.switcher
    case 'automation':
      return G.automation
    case 'envelope':
      return G.envelope
    case 'ability':
      return G.ability
    case 'mover':
    case 'splitter': {
      const id = track.moverId ?? track.splitterId
      const own = glyphFor(id)
      if (own) return own
      const def = getMoverOrSplitterDefinition(id)
      const family = def?.parentGate ? 'parentGate' : def?.kind
      return G[FAMILY[family ?? ''] ?? 'unknown']
    }
    default:
      // 3D Shape is the one instrument whose mark is not fixed: it follows the
      // solid the track is actually set to, so a row reads as the thing on
      // screen. Free to keep current - the row re-renders whenever its own
      // track changes, which a geometry edit is.
      if (track.instrumentId === 'cube') {
        return SOLIDS[normalizeFundamentalGeometry(track.stringParams?.geometry)]
      }
      // A composition track is `base` with an instrumentId naming a director
      // def, so the instrument registry has no mark for it.
      return glyphFor(track.instrumentId) ?? (isCompositionTrack ? G.composition : G.unknown)
  }
}

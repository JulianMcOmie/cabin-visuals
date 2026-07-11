import { Color, type Group, type Material } from 'three'

// The Color mover's material pass, mirroring animatedOpacity.ts: the placement
// wrapper (ObjectRenderer) offsets every material's color in HSL space by the
// mover's output, deriving from a BASE color remembered in userData - never
// from the current color, or per-frame offsets would compound.
//
// Base capture is lazy (first frame the mover output is non-zero) and released
// when it returns to zero: while no color mover is acting, instruments own
// their material colors outright, and the moment one acts again the base is
// re-captured fresh. Instruments that animate color per frame WHILE a color
// mover is active should write through setAnimatedColor so the mover offsets
// their animation instead of overwriting it (same contract as opacity).

const BASE_COLOR_KEY = '__cabinBaseColor'

type ColoredMaterial = Material & { color?: Color }

/** Instrument-side per-frame color write: sets the material's color AND its
 *  recorded base so the wrapper's mover pass offsets rather than overwrites. */
export function setAnimatedColor(material: Material, color: Color): void {
  const m = material as ColoredMaterial
  if (!m.color) return
  m.color.copy(color)
  const base = m.userData[BASE_COLOR_KEY] as Color | undefined
  if (base) base.copy(color)
}

/** Wrapper-side pass: offset every material's base color by the mover's HSL
 *  output. Zero output restores bases (once) and stands down entirely. */
export function applyMaterialHueShift(root: Group, hueShift: number, satShift: number, lightShift: number): void {
  const active = Math.abs(hueShift) + Math.abs(satShift) + Math.abs(lightShift) > 0.0001
  root.traverse((obj) => {
    const maybeMesh = obj as { material?: Material | Material[] }
    if (!maybeMesh.material) return
    const materials = Array.isArray(maybeMesh.material) ? maybeMesh.material : [maybeMesh.material]
    for (const material of materials) {
      const m = material as ColoredMaterial
      if (!m.color || !(m.color instanceof Color)) continue
      let base = m.userData[BASE_COLOR_KEY] as Color | undefined
      if (!active) {
        // Mover at rest: restore the authored color and hand ownership back.
        if (base) {
          m.color.copy(base)
          delete m.userData[BASE_COLOR_KEY]
        }
        continue
      }
      if (!base) {
        base = m.color.clone()
        m.userData[BASE_COLOR_KEY] = base
      }
      m.color.copy(base).offsetHSL(hueShift, satShift, lightShift)
    }
  })
}

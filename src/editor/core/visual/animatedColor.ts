import { Color, type Group, type Material } from 'three'

type ColoredMaterial = Material & { color?: Color }

// Kept for the isolated hover-preview renderer, which evaluates its visual-copy
// chain outside VisualEngine. Real scene occurrences transform declared color
// parameters before the instrument renders instead of tinting final materials.
const BASE_COLOR_KEY = '__cabinPreviewBaseColor'

/** Instrument-side per-frame color write. In the real renderer, colorizers
 * transform declared instrument params. The base bookkeeping here only keeps
 * the isolated hover-preview material pass from compounding. */
export function setAnimatedColor(material: Material, color: Color): void {
  const m = material as ColoredMaterial
  if (!m.color) return
  m.color.copy(color)
  const base = m.userData[BASE_COLOR_KEY] as Color | undefined
  if (base) base.copy(color)
}

/** Preview-only fallback for the standalone project-element hover canvas. */
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

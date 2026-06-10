export function lighten(color: string, amount: number): string {
  const hslMatch = color.match(/^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/)
  if (hslMatch) {
    const h = parseFloat(hslMatch[1])
    const s = parseFloat(hslMatch[2])
    const l = Math.min(100, parseFloat(hslMatch[3]) + amount)
    return `hsl(${h}, ${s}%, ${l}%)`
  }
  const hex = color.replace('#', '')
  const r = Math.min(255, parseInt(hex.substring(0, 2), 16) + Math.round(amount))
  const g = Math.min(255, parseInt(hex.substring(2, 4), 16) + Math.round(amount))
  const b = Math.min(255, parseInt(hex.substring(4, 6), 16) + Math.round(amount))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/** Display units and exact entry are paired explicitly; never invert a rounded
 * display formatter or snap typed values to the drag grid. */
export interface KnobValueCodec {
  edit: (value: number) => string
  parse: (text: string) => number | null
}

export function parseKnobNumber(text: string): number | null {
  const token = text.trim().replace(/−/g, '-')
  const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?'
  if (!new RegExp(`^${number}(?:\\s*/\\s*${number})?$`, 'i').test(token)) return null
  const [a, b] = token.split('/').map(Number)
  const value = b === undefined ? a : a / b
  return Number.isFinite(value) ? value : null
}

export function numberEntry(unit = '', scale = 1): KnobValueCodec {
  return {
    edit: value => String(value * scale),
    parse: text => {
      let token = text.trim()
      const units = ['b', 'beat', 'beats'].includes(unit) ? ['beats', 'beat', 'b']
        : ['/b', '/beat'].includes(unit) ? ['/beat', '/b'] : unit === '×' ? ['×', 'x'] : [unit]
      const suffix = units.find(candidate => candidate && token.endsWith(candidate))
      if (suffix) token = token.slice(0, -suffix.length).trim()
      const value = parseKnobNumber(token)
      return value === null ? null : value / scale
    },
  }
}
export const percentEntry = numberEntry('%', 100)
export const turnsEntry = numberEntry('°', 360)
export const growthEntry: KnobValueCodec = {
  edit: value => String(2 ** value),
  parse: text => {
    const value = parseKnobNumber(text.trim().replace(/^[×x]|[×x]$/g, ''))
    return value !== null && value > 0 ? Math.log2(value) : null
  },
}
/** Musical readouts are signed beat periods; zero means stopped. A unit on
 * an off-grid readout explicitly selects stored rates instead. */
export function periodEntry(cycle: number, onGrid: boolean, rawUnit = ''): KnobValueCodec {
  return {
    edit: value => String(onGrid && value !== 0 ? cycle / value : value),
    parse: text => {
      const token = text.trim()
      if (rawUnit && token.endsWith(rawUnit)) return numberEntry(rawUnit).parse(token)
      const beats = token.endsWith('b') || onGrid
      const value = numberEntry('b').parse(token)
      return value === null ? null : beats && value !== 0 ? cycle / value : value
    },
  }
}

export function exactKnobValue(text: string, codec: KnobValueCodec, min: number, max: number, integer = false): number | null {
  const value = codec.parse(text)
  return value !== null && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)) ? value : null
}

/** Scene FX shows whole-note divisions (one beat is a quarter note). */
export const noteRateEntry: KnobValueCodec = {
  edit: value => String(1 / (4 * value)),
  parse: text => {
    const note = parseKnobNumber(text)
    return note !== null && note > 0 ? 1 / (4 * note) : null
  },
}

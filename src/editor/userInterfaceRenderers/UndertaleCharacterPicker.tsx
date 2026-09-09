import type { UserInterfaceParameter } from './types'
import { UNDERTALE_CHARACTERS, undertaleCharacterIndex } from '../instruments/undertaleCore'
import { UNDERTALE_SPRITES } from '../instruments/undertaleSprites'

// One path per palette color, shared with the actual model blueprints.
const portraits = UNDERTALE_SPRITES.map(sprite => {
  const paths: Record<string, string> = {}
  sprite.rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const code = row[x], start = x
      while (row[x] === code) x++
      if (code === '.') continue
      paths[code] = (paths[code] ?? '') + `M${start} ${y}h${x-start}v1h${start-x}z`
    }
  })
  return { width: Math.max(...sprite.rows.map(row => row.length)), height: sprite.rows.length,
    paths: Object.entries(paths).map(([code, d]) => ({ d, color: sprite.palette[code] })) }
})

export function UndertaleCharacterPicker({ parameters }: { parameters: readonly UserInterfaceParameter[] }) {
  const parameter = parameters.find(p => p.definition.key === 'character')
  if (!parameter) return null
  const selected = undertaleCharacterIndex(Number(parameter.value))
  return (
    <div className="px-3 pt-3">
      <div className="mb-2 text-[9px] tracking-[0.15em] text-white/40">CHARACTER</div>
      <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Undertale character">
        {UNDERTALE_CHARACTERS.map((name, index) => {
          const portrait = portraits[index]
          return (
            <button key={name} type="button" aria-label={name} aria-pressed={selected === index}
              onClick={() => parameter.setValue(index)}
              className="flex min-w-0 cursor-pointer flex-col items-center gap-2 rounded-md border px-1 py-2 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-red-400"
              style={{ borderColor: selected === index ? '#f0474c' : '#ffffff12', background: selected === index ? '#f0474c18' : '#00000030' }}>
              <svg viewBox={`0 0 ${portrait.width} ${portrait.height}`} className="h-12 w-full" shapeRendering="crispEdges" aria-hidden="true">
                {portrait.paths.map(({d,color}) => <path key={color} d={d} fill={color} />)}
              </svg>
              <span className="w-full truncate text-center text-[9px] text-white/75" title={name}>{name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

'use client'

import { ColorWheelPill } from '../userInterfaceRenderers/colorWheel'

interface SceneColorSwatchProps {
  background: string
  colors: { label: string; value: string; onChange: (hex: string) => void }[]
}

/** Scene background and gradient stops use Colorizer's shared color controls. */
export function SceneColorSwatch({ background, colors }: SceneColorSwatchProps) {
  return (
    <div className="px-4 pb-3">
      {colors.length > 1 && <div className="mb-3 h-3 rounded border border-white/15" style={{ background }} />}
      <div className="flex items-center justify-around gap-3">
        {colors.map((color) => (
          <ColorWheelPill
            key={color.label}
            value={color.value}
            onChange={color.onChange}
            label={color.label.toUpperCase()}
            ariaLabel={`${color.label} color`}
            pillTestId="scene-color-swatch"
            wheelTestId="scene-color-popover"
          />
        ))}
      </div>
    </div>
  )
}

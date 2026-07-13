'use client'

import { ParamControl } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

/** The current flat parameter list, preserved exactly behind the renderer boundary. */
export function ParameterList({ parameters }: { parameters: readonly UserInterfaceParameter[] }) {
  if (parameters.length === 0) {
    return <p className="text-[11px] text-[var(--text-muted)]">No parameters</p>
  }

  return (
    <>
      <p className="mb-3 text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">PARAMETERS</p>
      {parameters.map((parameter) => {
        const numeric = typeof parameter.value === 'number'
        return (
          <ParamControl
            key={parameter.definition.key}
            param={parameter.definition}
            numValue={numeric ? parameter.value as number : undefined}
            strValue={numeric ? undefined : parameter.value as string}
            onNum={parameter.setValue}
            onStr={parameter.setValue}
          />
        )
      })}
    </>
  )
}

export const parametersUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => (
  <ParameterList parameters={parameters} />
)

import type { ComponentType } from 'react'
import type { ParamDef } from '../instruments/types'

/** One parameter with its current displayed value and canonical update path bound. */
export interface UserInterfaceParameter {
  definition: ParamDef
  value: number | string
  setValue: (value: number | string) => void
}

/** A registered settings UI. `targetId` identifies the thing whose UI is rendered. */
export type UserInterfaceRendererDefinition = ComponentType<{
  targetId: string
  parameters: readonly UserInterfaceParameter[]
}>

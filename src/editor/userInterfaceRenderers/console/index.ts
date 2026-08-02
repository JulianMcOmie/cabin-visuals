// The console kit: the shared building blocks of a guide-built settings panel
// (docs/instrument-panel-design-guide.md). A panel built from these states its
// accent once on <Console> and composes:
//
//   <Console accent={accent}>
//     <PreviewWindow>…the instrument's real look…</PreviewWindow>
//     <ControlRow spill>
//       <Knob b={size} label="SIZE" large /> … <ColorPill b={color} …/>
//     </ControlRow>
//     <More parameters={b.rest()} />
//   </Console>
//
// with bindings from `bindPanel(parameters)`. The plain-number primitives
// (LaserKnob, ColorWheelPill) and the accent formulas are re-exported so a
// kit panel imports from one place.

export { bindPanel } from './bindings'
export type { PanelBindings, NumBinding, SelectBinding, BooleanBinding, ColorBinding, StringBinding } from './bindings'
export { shadeOf, spillOf, emitterHalo } from './accent'
export { Console, ControlRow, GutterRow, useConsoleAccent } from './Console'
export { Knob, ColorPill } from './Knob'
export { Segmented } from './Segmented'
export type { SegmentOption } from './Segmented'
export { PreviewWindow } from './Window'
export { More } from './More'
export { consolePanel } from './spec'
export type { PanelSpec, PanelRowSpec, KnobItem, KnobSpec, PillSpec, PanelPreviewProps } from './spec'

export { LaserKnob, formatKnobValue } from '../laserKnob'
export { ColorWheelPill, ColorWheelPopover, hexToHsv, hsvToHex, towardWhite, withAlpha } from '../colorWheel'
export { ParameterList } from '../ParametersUserInterface'

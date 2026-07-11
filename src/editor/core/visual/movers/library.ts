import { Quaternion, Vector3 } from 'three'
import { cloneSVInto } from '../stateVector'
import type { StateVector } from '../types'
import type { MoverDef } from './types'

const TAU = Math.PI * 2
const _axis = new Vector3()
const _delta = new Quaternion()
const _current = new Quaternion()
const _next = new Quaternion()
const _pos = new Vector3()
const _pivot = new Vector3()

function quatFromAxisAngleVector(rot: [number, number, number], out: Quaternion): Quaternion {
  const angle = Math.hypot(rot[0], rot[1], rot[2])
  if (angle < 0.000001) return out.identity()
  _axis.set(rot[0] / angle, rot[1] / angle, rot[2] / angle)
  return out.setFromAxisAngle(_axis, angle)
}

function axisAngleVectorFromQuat(q: Quaternion, out: [number, number, number]): void {
  if (q.w > 1) q.normalize()
  const angle = 2 * Math.acos(q.w)
  const s = Math.sqrt(1 - q.w * q.w)
  if (s < 0.00001 || angle < 0.00001) {
    out[0] = 0
    out[1] = 0
    out[2] = 0
    return
  }
  out[0] = (q.x / s) * angle
  out[1] = (q.y / s) * angle
  out[2] = (q.z / s) * angle
}

function copyBase(inState: StateVector, out: StateVector): void {
  if (out !== inState) cloneSVInto(out, inState)
}

export const translateMover: MoverDef = {
  id: 'translate',
  label: 'Translate',
  amountInputs: ['dx', 'dy', 'dz'],
  inputs: {
    dx: { default: 0, min: -10, max: 10, semantic: 'amount' },
    dy: { default: 0, min: -10, max: 10, semantic: 'amount' },
    dz: { default: 0, min: -10, max: 10, semantic: 'amount' },
  },
  apply: (inState, inputs, _ctx, out) => {
    copyBase(inState, out)
    out.pos[0] += inputs.dx ?? 0
    out.pos[1] += inputs.dy ?? 0
    out.pos[2] += inputs.dz ?? 0
  },
}

export const spinMover: MoverDef = {
  id: 'spin',
  label: 'Spin',
  amountInputs: ['angle', 'rate'],
  inputs: {
    space: {
      default: 0,
      min: 0,
      max: 1,
      type: 'select',
      label: 'Spin Space',
      options: [
        { value: 0, label: 'Orbit' },
        { value: 1, label: 'Self' },
      ],
    },
    angle: { default: 0, min: -Math.PI * 2, max: Math.PI * 2, label: 'Angle', semantic: 'angle' },
    rate: { default: 0, min: -8, max: 8, label: 'Rate', semantic: 'rate' },
    axisX: { default: 0, min: -1, max: 1, label: 'Axis X / Nod', semantic: 'amount' },
    axisY: { default: 1, min: -1, max: 1, label: 'Axis Y / Turn', semantic: 'amount' },
    axisZ: { default: 0, min: -1, max: 1, label: 'Axis Z / Roll', semantic: 'amount' },
    pivotX: { default: 0, min: -10, max: 10, semantic: 'amount', hidden: true },
    pivotY: { default: 0, min: -10, max: 10, semantic: 'amount', hidden: true },
    pivotZ: { default: 0, min: -10, max: 10, semantic: 'amount', hidden: true },
  },
  apply: (inState, inputs, ctx, out) => {
    copyBase(inState, out)
    const ax = inputs.axisX ?? 0
    const ay = inputs.axisY ?? 1
    const az = inputs.axisZ ?? 0
    const len = Math.hypot(ax, ay, az)
    const angle = (inputs.angle ?? 0) + TAU * (inputs.rate ?? 0) * ctx.beat
    if (len < 0.000001 || Math.abs(angle) < 0.000001) return

    _axis.set(ax / len, ay / len, az / len)
    _delta.setFromAxisAngle(_axis, angle)
    quatFromAxisAngleVector(inState.rot, _current)
    const selfSpace = Math.round(inputs.space ?? 0) === 1
    if (selfSpace) _next.multiplyQuaternions(_current, _delta)
    else _next.multiplyQuaternions(_delta, _current)
    axisAngleVectorFromQuat(_next, out.rot)

    if (selfSpace) return

    _pivot.set(inputs.pivotX ?? 0, inputs.pivotY ?? 0, inputs.pivotZ ?? 0)
    _pos.set(inState.pos[0], inState.pos[1], inState.pos[2])
      .sub(_pivot)
      .applyQuaternion(_delta)
      .add(_pivot)
    out.pos[0] = _pos.x
    out.pos[1] = _pos.y
    out.pos[2] = _pos.z
  },
}

export const breatheMover: MoverDef = {
  id: 'breathe',
  label: 'Breathe',
  amountInputs: ['amount'],
  inputs: {
    amount: { default: 0, min: -2, max: 2, semantic: 'amount' },
    rate: { default: 1, min: -8, max: 8, semantic: 'rate' },
    phase: { default: 0, min: -4, max: 4, semantic: 'phase' },
  },
  apply: (inState, inputs, ctx, out) => {
    copyBase(inState, out)
    out.logScale += (inputs.amount ?? 0) * Math.sin(TAU * ((inputs.rate ?? 1) * ctx.beat + (inputs.phase ?? 0)))
  },
}

export const orbitMover: MoverDef = {
  id: 'orbit',
  label: 'Orbit',
  amountInputs: ['radius'],
  inputs: {
    radius: { default: 0, min: -10, max: 10, semantic: 'amount' },
    rate: { default: 1, min: -8, max: 8, semantic: 'rate' },
    phase: { default: 0, min: -4, max: 4, semantic: 'phase' },
    tilt: { default: 0, min: -Math.PI, max: Math.PI, semantic: 'angle' },
  },
  apply: (inState, inputs, ctx, out) => {
    copyBase(inState, out)
    const theta = TAU * ((inputs.rate ?? 1) * ctx.beat + (inputs.phase ?? 0))
    const radius = inputs.radius ?? 0
    const tilt = inputs.tilt ?? 0
    out.pos[0] += radius * Math.cos(theta)
    out.pos[1] += radius * Math.sin(theta) * Math.cos(tilt)
    out.pos[2] += radius * Math.sin(theta) * Math.sin(tilt)
  },
}

export const dotWaveMover: MoverDef = {
  id: 'dotWave',
  label: 'Dot Wave',
  amountInputs: ['amount'],
  inputs: {
    amount: { default: 0, min: -5, max: 5, semantic: 'amount' },
    rate: { default: 1, min: -8, max: 8, semantic: 'rate' },
    indexStep: { default: 0.15, min: -2, max: 2, semantic: 'index' },
    phase: { default: 0, min: -4, max: 4, semantic: 'phase' },
  },
  apply: (inState, inputs, ctx, out) => {
    copyBase(inState, out)
    const amount = inputs.amount ?? 0
    const theta = TAU * ((inputs.rate ?? 1) * ctx.beat + (inputs.phase ?? 0) + (inputs.indexStep ?? 0.15) * ctx.i)
    out.pos[0] += amount * Math.cos(theta)
    out.pos[1] += amount * Math.sin(theta)
  },
}

export const opacityMover: MoverDef = {
  id: 'opacity',
  label: 'Opacity',
  amountInputs: ['opacity'],
  inputs: {
    opacity: { default: 1, min: 0, max: 1, label: 'Opacity', semantic: 'amount' },
  },
  apply: (inState, inputs, _ctx, out) => {
    copyBase(inState, out)
    out.opacity *= Math.max(0, Math.min(1, inputs.opacity ?? 1))
  },
}

export const colorMover: MoverDef = {
  id: 'color',
  label: 'Color',
  amountInputs: ['hue'],
  inputs: {
    // Hue in full turns of the wheel (0.5 = complementary color); rate spins the
    // wheel per beat; saturation/lightness offset in HSL space. All ride the
    // StateVector's aux bag, so depth/weights/MIDI modes compose them like any
    // transform - a ballistic Color mover pops the hue on every note.
    hue: { default: 0, min: -1, max: 1, label: 'Hue Shift', semantic: 'amount' },
    rate: { default: 0, min: -8, max: 8, label: 'Rate', semantic: 'rate' },
    saturation: { default: 0, min: -1, max: 1, label: 'Saturation', semantic: 'amount' },
    lightness: { default: 0, min: -1, max: 1, label: 'Lightness', semantic: 'amount' },
  },
  apply: (inState, inputs, ctx, out) => {
    copyBase(inState, out)
    out.aux.hueShift = (out.aux.hueShift ?? 0) + (inputs.hue ?? 0) + (inputs.rate ?? 0) * ctx.beat
    out.aux.satShift = (out.aux.satShift ?? 0) + (inputs.saturation ?? 0)
    out.aux.lightShift = (out.aux.lightShift ?? 0) + (inputs.lightness ?? 0)
  },
}

export const MOVERS: Record<string, MoverDef> = {
  [translateMover.id]: translateMover,
  [spinMover.id]: spinMover,
  [breatheMover.id]: breatheMover,
  [orbitMover.id]: orbitMover,
  [dotWaveMover.id]: dotWaveMover,
  [opacityMover.id]: opacityMover,
  [colorMover.id]: colorMover,
}

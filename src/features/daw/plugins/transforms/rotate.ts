import * as THREE from 'three';
import { VisualPlugin } from '../types';

const _euler = new THREE.Euler();

export const RotatePlugin: VisualPlugin = {
  id: 'rotate',
  name: 'Rotate',
  description: 'Continuously rotate and/or set static orientation',
  category: 'transform',

  defaultSettings: {
    speedX: 0,
    speedY: 0,
    speedZ: 0.5,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
  },

  settingsSchema: {
    speedX: {
      type: 'number',
      label: 'Spin X',
      min: -5,
      max: 5,
      step: 0.1,
      default: 0,
    },
    speedY: {
      type: 'number',
      label: 'Spin Y',
      min: -5,
      max: 5,
      step: 0.1,
      default: 0,
    },
    speedZ: {
      type: 'number',
      label: 'Spin Z',
      min: -5,
      max: 5,
      step: 0.1,
      default: 0.5,
    },
    offsetX: {
      type: 'number',
      label: 'Orientation X',
      min: -180,
      max: 180,
      step: 5,
      default: 0,
    },
    offsetY: {
      type: 'number',
      label: 'Orientation Y',
      min: -180,
      max: 180,
      step: 5,
      default: 0,
    },
    offsetZ: {
      type: 'number',
      label: 'Orientation Z',
      min: -180,
      max: 180,
      step: 5,
      default: 0,
    },
  },

  applyTransform: (group: THREE.Group, settings: Record<string, unknown>, time: number) => {
    const speedX = (settings.speedX as number) ?? 0;
    const speedY = (settings.speedY as number) ?? 0;
    const speedZ = (settings.speedZ as number) ?? 0.5;
    const offsetX = (settings.offsetX as number) ?? 0;
    const offsetY = (settings.offsetY as number) ?? 0;
    const offsetZ = (settings.offsetZ as number) ?? 0;

    const deg2rad = Math.PI / 180;
    group.rotation.x = time * speedX + offsetX * deg2rad;
    group.rotation.y = time * speedY + offsetY * deg2rad;
    group.rotation.z = time * speedZ + offsetZ * deg2rad;
  },
};

import * as THREE from 'three';
import { VisualPlugin } from '../types';

export const OffsetPlugin: VisualPlugin = {
  id: 'offset',
  name: 'Offset',
  description: 'Shift the visual position on X, Y, and Z axes',
  category: 'transform',

  defaultSettings: {
    x: 0,
    y: 0,
    z: 0,
  },

  settingsSchema: {
    x: {
      type: 'number',
      label: 'X',
      min: -10,
      max: 10,
      step: 0.1,
      default: 0,
    },
    y: {
      type: 'number',
      label: 'Y',
      min: -10,
      max: 10,
      step: 0.1,
      default: 0,
    },
    z: {
      type: 'number',
      label: 'Z',
      min: -10,
      max: 10,
      step: 0.1,
      default: 0,
    },
  },

  applyTransform: (group: THREE.Group, settings: Record<string, unknown>) => {
    const x = (settings.x as number) ?? 0;
    const y = (settings.y as number) ?? 0;
    const z = (settings.z as number) ?? 0;
    group.position.x += x;
    group.position.y += y;
    group.position.z += z;
  },
};

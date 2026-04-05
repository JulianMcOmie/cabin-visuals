import * as THREE from 'three';
import { VisualPlugin } from '../types';

export const ScalePlugin: VisualPlugin = {
  id: 'scale',
  name: 'Scale',
  description: 'Scale the visual up or down',
  category: 'transform',

  defaultSettings: {
    scale: 1,
    pulseAmount: 0,
    pulseSpeed: 1,
  },

  settingsSchema: {
    scale: {
      type: 'number',
      label: 'Base Scale',
      min: 0.1,
      max: 3,
      step: 0.1,
      default: 1,
    },
    pulseAmount: {
      type: 'number',
      label: 'Pulse Amount',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0,
    },
    pulseSpeed: {
      type: 'number',
      label: 'Pulse Speed',
      min: 0.1,
      max: 5,
      step: 0.1,
      default: 1,
    },
  },

  applyTransform: (group: THREE.Group, settings: Record<string, unknown>, time: number) => {
    const baseScale = (settings.scale as number) ?? 1;
    const pulseAmount = (settings.pulseAmount as number) ?? 0;
    const pulseSpeed = (settings.pulseSpeed as number) ?? 1;

    const pulse = Math.sin(time * pulseSpeed * Math.PI * 2) * pulseAmount;
    const finalScale = baseScale + pulse;

    group.scale.setScalar(finalScale);
  },
};

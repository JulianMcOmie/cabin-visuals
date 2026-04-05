import * as THREE from 'three';
import { VisualPlugin } from '../types';

export const RadialSymmetryPlugin: VisualPlugin = {
  id: 'radialSymmetry',
  name: 'Radial Symmetry',
  description: 'Duplicate and rotate around center',
  category: 'clone',

  defaultSettings: {
    folds: 4,
    radius: 0,
    rotation: 0,
    includeOriginal: true,
    spin: 0,
  },

  settingsSchema: {
    folds: {
      type: 'number',
      label: 'Folds',
      min: 2,
      max: 16,
      step: 1,
      default: 4,
    },
    radius: {
      type: 'number',
      label: 'Radius',
      min: 0,
      max: 10,
      step: 0.1,
      default: 0,
    },
    rotation: {
      type: 'number',
      label: 'Rotation',
      min: 0,
      max: 6.28,
      step: 0.05,
      default: 0,
    },
    includeOriginal: {
      type: 'boolean',
      label: 'Include Original',
      default: true,
    },
    spin: {
      type: 'number',
      label: 'Spin Speed',
      min: -1,
      max: 1,
      step: 0.05,
      default: 0,
    },
  },

  getClones: (settings: Record<string, unknown>) => {
    const folds = (settings.folds as number) ?? 4;
    const includeOriginal = (settings.includeOriginal as boolean) ?? true;
    const count = includeOriginal ? folds : folds - 1;

    return {
      count,
      getTransform: (
        index: number,
        settings: Record<string, unknown>,
        time: number
      ): THREE.Matrix4 => {
        const matrix = new THREE.Matrix4();
        const folds = (settings.folds as number) ?? 4;
        const radius = (settings.radius as number) ?? 0;
        const rotation = (settings.rotation as number) ?? 0;
        const includeOriginal = (settings.includeOriginal as boolean) ?? true;
        const spin = (settings.spin as number) ?? 0;

        // If including original, index 0 is identity (but still offset by radius)
        const effectiveIndex = includeOriginal ? index : index + 1;
        const angleStep = (Math.PI * 2) / folds;
        const angle = effectiveIndex * angleStep + rotation + time * spin * Math.PI * 2;

        if (includeOriginal && index === 0) {
          if (radius === 0) return matrix.identity();
          // Offset along the angle direction
          matrix.makeTranslation(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
          return matrix;
        }

        // Rotate around Z axis, then offset outward by radius
        matrix.makeRotationZ(angle);
        if (radius !== 0) {
          const offset = new THREE.Matrix4().makeTranslation(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
          matrix.premultiply(offset);
        }

        return matrix;
      },
    };
  },
};

import * as THREE from 'three';
import { VisualPlugin } from '../types';

export const LinearDuplicatePlugin: VisualPlugin = {
  id: 'linearDuplicate',
  name: 'Linear Duplicate',
  description: 'Spread copies evenly along an axis with optional center exclusion and per-copy scale/opacity falloff',
  category: 'clone',

  defaultSettings: {
    totalCopies: 3,
    axis: 'x',
    spacing: 1.0,
    excludeCenter: false,
    scaleFalloff: 0,
    opacityFalloff: 0,
  },

  settingsSchema: {
    totalCopies: {
      type: 'number',
      label: 'Total Copies',
      min: 2,
      max: 16,
      step: 1,
      default: 3,
    },
    axis: {
      type: 'select',
      label: 'Axis',
      options: [
        { value: 'x', label: 'X (Horizontal)' },
        { value: 'y', label: 'Y (Vertical)' },
        { value: 'z', label: 'Z (Depth)' },
      ],
      default: 'x',
    },
    spacing: {
      type: 'number',
      label: 'Spacing',
      min: 0.1,
      max: 10,
      step: 0.1,
      default: 1.0,
    },
    excludeCenter: {
      type: 'boolean',
      label: 'Exclude Center',
      default: false,
    },
    scaleFalloff: {
      type: 'number',
      label: 'Scale Falloff',
      min: 0,
      max: 0.5,
      step: 0.02,
      default: 0,
    },
    opacityFalloff: {
      type: 'number',
      label: 'Opacity Falloff',
      min: 0,
      max: 0.5,
      step: 0.02,
      default: 0,
    },
  },

  getClones: (settings: Record<string, unknown>) => {
    const totalCopies = (settings.totalCopies as number) ?? 3;

    return {
      count: totalCopies,
      getTransform: (
        index: number,
        settings: Record<string, unknown>,
        _time: number
      ): THREE.Matrix4 => {
        const total = (settings.totalCopies as number) ?? 3;
        const axis = (settings.axis as string) ?? 'x';
        const spacing = (settings.spacing as number) ?? 1.0;
        const exclude = (settings.excludeCenter as boolean) ?? false;
        const scaleFalloff = (settings.scaleFalloff as number) ?? 0;

        const matrix = new THREE.Matrix4();

        // Standard centering: total copies from -(total-1)/2 to (total-1)/2
        // E.g., 3 copies at spacing 1 → positions: -1, 0, 1
        const posIndex = index - (total - 1) / 2;
        const offset = posIndex * spacing;

        // excludeCenter: hide the center copy (only exists for odd total)
        if (exclude && posIndex === 0) {
          return matrix.makeScale(0, 0, 0);
        }

        // Distance from center for falloff (0 at center, 1 at outermost)
        const maxDist = ((total - 1) / 2) * spacing;
        const dist = Math.abs(offset);
        const normalizedDist = maxDist > 0 ? dist / maxDist : 0;

        const scale = Math.max(0.05, 1 - scaleFalloff * normalizedDist * total);

        // Build transform
        const tx = axis === 'x' ? offset : 0;
        const ty = axis === 'y' ? offset : 0;
        const tz = axis === 'z' ? offset : 0;

        const scaleMatrix = new THREE.Matrix4().makeScale(scale, scale, scale);
        const translateMatrix = new THREE.Matrix4().makeTranslation(tx, ty, tz);

        matrix.multiplyMatrices(translateMatrix, scaleMatrix);
        return matrix;
      },
    };
  },
};

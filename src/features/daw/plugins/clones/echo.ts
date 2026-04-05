import * as THREE from 'three';
import { VisualPlugin } from '../types';

export const EchoPlugin: VisualPlugin = {
  id: 'echo',
  name: 'Echo',
  description: 'Create trailing copies with rotating offset and scale falloff',
  category: 'clone',

  defaultSettings: {
    copies: 4,
    separationX: 0,
    separationY: 0,
    separationZ: -0.5,
    scaleFalloff: 0.15,
    opacityFalloff: 0.2,
    rotationSpeed: 0,
    rotationAxis: 'z',
    phaseDelay: 0.2,
    phaseOscillate: false,
    phaseOscillateSpeed: 1,
    phaseOscillateAmount: 0.5,
  },

  settingsSchema: {
    copies: {
      type: 'number',
      label: 'Copies',
      min: 1,
      max: 12,
      step: 1,
      default: 4,
    },
    separationX: {
      type: 'number',
      label: 'X Offset',
      min: -2,
      max: 2,
      step: 0.1,
      default: 0,
    },
    separationY: {
      type: 'number',
      label: 'Y Offset',
      min: -2,
      max: 2,
      step: 0.1,
      default: 0,
    },
    separationZ: {
      type: 'number',
      label: 'Z Offset',
      min: -2,
      max: 2,
      step: 0.1,
      default: -0.5,
    },
    scaleFalloff: {
      type: 'number',
      label: 'Scale Falloff',
      min: 0,
      max: 0.5,
      step: 0.02,
      default: 0.15,
    },
    opacityFalloff: {
      type: 'number',
      label: 'Opacity Falloff',
      min: 0,
      max: 0.5,
      step: 0.02,
      default: 0.2,
    },
    rotationSpeed: {
      type: 'number',
      label: 'Orbit Speed',
      min: -3,
      max: 3,
      step: 0.1,
      default: 0,
    },
    rotationAxis: {
      type: 'select',
      label: 'Orbit Axis',
      options: [
        { value: 'x', label: 'X' },
        { value: 'y', label: 'Y' },
        { value: 'z', label: 'Z' },
      ],
      default: 'z',
    },
    phaseDelay: {
      type: 'number',
      label: 'Phase Delay',
      min: 0,
      max: 2,
      step: 0.05,
      default: 0.2,
    },
    phaseOscillate: {
      type: 'boolean',
      label: 'Oscillate Phase',
      default: false,
    },
    phaseOscillateSpeed: {
      type: 'number',
      label: 'Oscillate Speed',
      min: 0.1,
      max: 5,
      step: 0.1,
      default: 1,
    },
    phaseOscillateAmount: {
      type: 'number',
      label: 'Oscillate Amount',
      min: 0,
      max: 2,
      step: 0.1,
      default: 0.5,
    },
  },

  getClones: (settings: Record<string, unknown>) => {
    const copies = (settings.copies as number) ?? 4;

    return {
      count: copies + 1, // +1 for original
      getTransform: (
        index: number,
        settings: Record<string, unknown>,
        time: number
      ): THREE.Matrix4 => {
        const matrix = new THREE.Matrix4();

        if (index === 0) {
          // Original - no transform
          return matrix.identity();
        }

        const separationX = (settings.separationX as number) ?? 0;
        const separationY = (settings.separationY as number) ?? 0;
        const separationZ = (settings.separationZ as number) ?? -0.5;
        const scaleFalloff = (settings.scaleFalloff as number) ?? 0.15;
        const rotationSpeed = (settings.rotationSpeed as number) ?? 0;
        const rotationAxis = (settings.rotationAxis as string) ?? 'z';
        const basePhaseDelay = (settings.phaseDelay as number) ?? 0.2;
        const phaseOscillate = (settings.phaseOscillate as boolean) ?? false;
        const phaseOscillateSpeed = (settings.phaseOscillateSpeed as number) ?? 1;
        const phaseOscillateAmount = (settings.phaseOscillateAmount as number) ?? 0.5;

        // Calculate effective phase delay (with optional oscillation)
        let phaseDelay = basePhaseDelay;
        if (phaseOscillate) {
          // Oscillate the phase delay over time
          const oscillation = Math.sin(time * phaseOscillateSpeed * Math.PI * 2) * phaseOscillateAmount;
          phaseDelay = basePhaseDelay + oscillation;
        }

        // Base offset vector
        const offset = new THREE.Vector3(separationX, separationY, separationZ);

        // Apply rotation to offset vector based on time and phase delay
        // Each copy has a phase offset, creating a spiral/trail effect
        const phaseOffset = phaseDelay * index;
        const angle = (time - phaseOffset) * rotationSpeed * Math.PI * 2;

        if (rotationSpeed !== 0) {
          // Create rotation matrix for the offset vector
          const rotMatrix = new THREE.Matrix4();
          if (rotationAxis === 'x') {
            rotMatrix.makeRotationX(angle);
          } else if (rotationAxis === 'y') {
            rotMatrix.makeRotationY(angle);
          } else {
            rotMatrix.makeRotationZ(angle);
          }
          offset.applyMatrix4(rotMatrix);
        }

        // Multiply offset by index to stack copies
        offset.multiplyScalar(index);

        // Scale decreases with each copy
        const scale = Math.max(0.1, 1 - scaleFalloff * index);

        // Build final transform matrix
        // Scale first, then position
        const scaleMatrix = new THREE.Matrix4().makeScale(scale, scale, scale);
        const translateMatrix = new THREE.Matrix4().makeTranslation(
          offset.x,
          offset.y,
          offset.z
        );

        matrix.multiplyMatrices(translateMatrix, scaleMatrix);

        return matrix;
      },
    };
  },
};

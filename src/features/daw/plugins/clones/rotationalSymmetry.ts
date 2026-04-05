import * as THREE from 'three';
import { VisualPlugin } from '../types';

export const RotationalSymmetryPlugin: VisualPlugin = {
  id: 'rotationalSymmetry',
  name: 'Rotational Symmetry',
  description: 'Create 3D rotationally symmetric copies of objects',
  category: 'clone',

  defaultSettings: {
    copies: 6,
    mode: 'sphere',
    radius: 2.5,
    includeOriginal: true,
    spin: 0,
    // Sphere mode settings
    latitudeSpan: 1.0, // 0-1, how much of sphere to cover (1 = full sphere)
    // Ring mode settings
    zSpread: 1.0, // Spread copies along Z for 3D ring
    tiltX: 0,
    tiltY: 0,
    // Individual rotation
    faceCenter: true,
  },

  settingsSchema: {
    copies: {
      type: 'number',
      label: 'Copies',
      min: 2,
      max: 24,
      step: 1,
      default: 6,
    },
    mode: {
      type: 'select',
      label: 'Mode',
      options: [
        { value: 'sphere', label: 'Sphere' },
        { value: 'ring3d', label: '3D Ring' },
        { value: 'helix', label: 'Helix' },
        { value: 'random3d', label: 'Random 3D' },
      ],
      default: 'sphere',
    },
    radius: {
      type: 'number',
      label: 'Radius',
      min: 0.5,
      max: 10,
      step: 0.25,
      default: 2.5,
    },
    includeOriginal: {
      type: 'boolean',
      label: 'Include Center',
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
    latitudeSpan: {
      type: 'number',
      label: 'Latitude Span',
      min: 0.2,
      max: 1.0,
      step: 0.1,
      default: 1.0,
    },
    zSpread: {
      type: 'number',
      label: 'Z Spread',
      min: 0,
      max: 4,
      step: 0.25,
      default: 1.0,
    },
    tiltX: {
      type: 'number',
      label: 'Tilt X',
      min: -1.57,
      max: 1.57,
      step: 0.1,
      default: 0,
    },
    tiltY: {
      type: 'number',
      label: 'Tilt Y',
      min: -1.57,
      max: 1.57,
      step: 0.1,
      default: 0,
    },
    faceCenter: {
      type: 'boolean',
      label: 'Face Center',
      default: true,
    },
  },

  getClones: (settings: Record<string, unknown>) => {
    const copies = (settings.copies as number) ?? 6;
    const includeOriginal = (settings.includeOriginal as boolean) ?? true;
    const count = includeOriginal ? copies + 1 : copies;

    return {
      count,
      getTransform: (
        index: number,
        settings: Record<string, unknown>,
        time: number
      ): THREE.Matrix4 => {
        const matrix = new THREE.Matrix4();
        const copies = (settings.copies as number) ?? 6;
        const mode = (settings.mode as string) ?? 'sphere';
        const radius = (settings.radius as number) ?? 2.5;
        const includeOriginal = (settings.includeOriginal as boolean) ?? true;
        const spin = (settings.spin as number) ?? 0;
        const latitudeSpan = (settings.latitudeSpan as number) ?? 1.0;
        const zSpread = (settings.zSpread as number) ?? 1.0;
        const tiltX = (settings.tiltX as number) ?? 0;
        const tiltY = (settings.tiltY as number) ?? 0;
        const faceCenter = (settings.faceCenter as boolean) ?? true;

        // Handle center/original
        if (includeOriginal && index === 0) {
          return matrix.identity();
        }

        const effectiveIndex = includeOriginal ? index - 1 : index;
        const t = effectiveIndex / copies; // 0 to ~1
        const spinAngle = time * spin * Math.PI * 2;

        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();

        if (mode === 'sphere') {
          // Fibonacci sphere distribution for even spacing
          const phi = Math.acos(1 - 2 * (effectiveIndex + 0.5) / copies * latitudeSpan);
          const theta = Math.PI * (1 + Math.sqrt(5)) * effectiveIndex + spinAngle;

          position.x = Math.sin(phi) * Math.cos(theta) * radius;
          position.y = Math.sin(phi) * Math.sin(theta) * radius;
          position.z = Math.cos(phi) * radius;

          // Center the distribution
          if (latitudeSpan < 1) {
            position.z -= radius * (1 - latitudeSpan) / 2;
          }

        } else if (mode === 'ring3d') {
          // Ring with Z variation for 3D effect
          const angle = t * Math.PI * 2 + spinAngle;

          // Sinusoidal Z variation creates a wavy 3D ring
          const zOffset = Math.sin(angle * 2) * zSpread;
          // Also vary radius slightly for more 3D feel
          const radiusVar = radius + Math.cos(angle * 3) * zSpread * 0.3;

          position.x = Math.cos(angle) * radiusVar;
          position.y = Math.sin(angle) * radiusVar;
          position.z = zOffset;

        } else if (mode === 'helix') {
          // Double helix for 3D spiral
          const angle = t * Math.PI * 4 + spinAngle; // 2 full rotations
          const zPos = (t - 0.5) * radius * 2; // Spread along Z

          position.x = Math.cos(angle) * radius * 0.6;
          position.y = Math.sin(angle) * radius * 0.6;
          position.z = zPos;

        } else if (mode === 'random3d') {
          // Seeded random positions on sphere surface
          const seed1 = Math.sin(effectiveIndex * 12.9898 + 78.233) * 43758.5453;
          const seed2 = Math.sin(effectiveIndex * 43.2316 + 11.847) * 23421.6312;

          const u = (seed1 % 1 + 1) % 1;
          const v = (seed2 % 1 + 1) % 1;

          const theta = 2 * Math.PI * u + spinAngle;
          const phi = Math.acos(2 * v - 1);

          position.x = Math.sin(phi) * Math.cos(theta) * radius;
          position.y = Math.sin(phi) * Math.sin(theta) * radius;
          position.z = Math.cos(phi) * radius;
        }

        // Apply tilt to entire arrangement
        if (tiltX !== 0 || tiltY !== 0) {
          const tiltQuat = new THREE.Quaternion();
          tiltQuat.setFromEuler(new THREE.Euler(tiltX, tiltY, 0));
          position.applyQuaternion(tiltQuat);
        }

        // Face center - rotate each copy to look at origin
        if (faceCenter && position.length() > 0.01) {
          const lookMatrix = new THREE.Matrix4();
          lookMatrix.lookAt(position, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
          quaternion.setFromRotationMatrix(lookMatrix);
        }

        matrix.compose(position, quaternion, new THREE.Vector3(1, 1, 1));
        return matrix;
      },
    };
  },
};

import * as THREE from 'three';
import { VisualPlugin } from '../types';

export const TilePlugin: VisualPlugin = {
  id: 'tile',
  name: 'Tile',
  description: 'Create a tiled grid of copies along a plane',
  category: 'clone',

  defaultSettings: {
    tilesX: 3,
    tilesY: 3,
    spacingX: 1,
    spacingY: 1,
    plane: 'xy',
    scale: 0.5,
    centerGrid: true,
    rotateToCamera: false,
    staggerOffset: 0,
    spacingMult: 1,
  },

  settingsSchema: {
    tilesX: {
      type: 'number',
      label: 'Tiles X',
      min: 1,
      max: 10,
      step: 1,
      default: 3,
    },
    tilesY: {
      type: 'number',
      label: 'Tiles Y',
      min: 1,
      max: 10,
      step: 1,
      default: 3,
    },
    spacingX: {
      type: 'number',
      label: 'Spacing X',
      min: 0.5,
      max: 3,
      step: 0.1,
      default: 1,
    },
    spacingY: {
      type: 'number',
      label: 'Spacing Y',
      min: 0.5,
      max: 3,
      step: 0.1,
      default: 1,
    },
    plane: {
      type: 'select',
      label: 'Plane',
      options: [
        { value: 'xy', label: 'XY (facing Z)' },
        { value: 'xz', label: 'XZ (facing Y)' },
        { value: 'yz', label: 'YZ (facing X)' },
      ],
      default: 'xy',
    },
    scale: {
      type: 'number',
      label: 'Tile Scale',
      min: 0.1,
      max: 2,
      step: 0.05,
      default: 0.5,
    },
    centerGrid: {
      type: 'boolean',
      label: 'Center Grid',
      default: true,
    },
    staggerOffset: {
      type: 'number',
      label: 'Stagger Rows',
      min: 0,
      max: 1,
      step: 0.1,
      default: 0,
    },
    spacingMult: {
      type: 'number',
      label: 'Spacing Multiplier',
      min: 0.1,
      max: 5,
      step: 0.1,
      default: 1,
    },
  },

  getClones: (settings: Record<string, unknown>) => {
    const tilesX = (settings.tilesX as number) ?? 3;
    const tilesY = (settings.tilesY as number) ?? 3;
    const totalTiles = tilesX * tilesY;

    return {
      count: totalTiles,
      getTransform: (
        index: number,
        settings: Record<string, unknown>,
        _time: number
      ): THREE.Matrix4 => {
        const matrix = new THREE.Matrix4();

        const spacingMultX = (settings.spacingX as number) ?? 1;
        const spacingMultY = (settings.spacingY as number) ?? 1;
        const plane = (settings.plane as string) ?? 'xy';
        const scale = (settings.scale as number) ?? 0.5;
        const centerGrid = (settings.centerGrid as boolean) ?? true;
        const staggerOffset = (settings.staggerOffset as number) ?? 0;
        const spacingMult = (settings.spacingMult as number) ?? 1;

        // Spacing is relative to tile size (scale)
        // A spacing of 1 means tiles are touching, 2 means one tile-width gap
        const spacingX = scale * spacingMultX * spacingMult * 2; // *2 because scale is radius-like
        const spacingY = scale * spacingMultY * spacingMult * 2;

        // Calculate grid position
        const col = index % tilesX;
        const row = Math.floor(index / tilesX);

        // Calculate position with optional centering
        let posX = col * spacingX;
        let posY = row * spacingY;

        // Apply stagger (offset every other row)
        if (staggerOffset > 0 && row % 2 === 1) {
          posX += spacingX * staggerOffset;
        }

        // Center the grid
        if (centerGrid) {
          posX -= ((tilesX - 1) * spacingX) / 2;
          posY -= ((tilesY - 1) * spacingY) / 2;
          // Adjust for stagger
          if (staggerOffset > 0) {
            posX -= (spacingX * staggerOffset) / 2;
          }
        }

        // Apply to correct plane
        let x = 0, y = 0, z = 0;
        switch (plane) {
          case 'xy':
            x = posX;
            y = posY;
            z = 0;
            break;
          case 'xz':
            x = posX;
            y = 0;
            z = posY;
            break;
          case 'yz':
            x = 0;
            y = posX;
            z = posY;
            break;
        }

        // Build transform: scale then translate
        const scaleMatrix = new THREE.Matrix4().makeScale(scale, scale, scale);
        const translateMatrix = new THREE.Matrix4().makeTranslation(x, y, z);

        matrix.multiplyMatrices(translateMatrix, scaleMatrix);

        return matrix;
      },
    };
  },
};

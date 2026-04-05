import * as THREE from 'three';
import { SettingsSchema } from '@daw/instruments/types';

// Plugin categories for organization
export type PluginCategory = 'shader' | 'transform' | 'clone';

// Base plugin definition (similar to Instrument pattern)
export interface VisualPlugin {
  id: string;
  name: string;
  description: string;
  category: PluginCategory;
  defaultSettings: Record<string, unknown>;
  settingsSchema?: SettingsSchema;

  // For shader plugins - GLSL fragment shader code
  fragmentShader?: string;
  // Vertex shader (optional, defaults to passthrough)
  vertexShader?: string;

  // For transform plugins - function that modifies group
  applyTransform?: (
    group: THREE.Group,
    settings: Record<string, unknown>,
    time: number
  ) => void;

  // For clone plugins - returns clone configuration
  getClones?: (settings: Record<string, unknown>) => {
    count: number;
    getTransform: (
      index: number,
      settings: Record<string, unknown>,
      time: number
    ) => THREE.Matrix4;
  };
}

// Instance of a plugin on a specific track
export interface PluginInstance {
  id: string;
  pluginId: string;
  enabled: boolean;
  settings: Record<string, unknown>;
}

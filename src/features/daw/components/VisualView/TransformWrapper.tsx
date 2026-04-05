'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PluginInstance } from '@daw/core/types';
import { getPlugin } from '@daw/plugins';
import { getPluginSettingsWithOverrides } from '@daw/core/visualPlayback';

interface SingleTransformProps {
  trackId: string;
  instance: PluginInstance;
  children: React.ReactNode;
}

/** Applies a single transform plugin to its own nested group */
function SingleTransform({ trackId, instance, children }: SingleTransformProps) {
  const groupRef = useRef<THREE.Group>(null);
  const plugin = getPlugin(instance.pluginId);

  useFrame((state) => {
    if (!groupRef.current || !plugin?.applyTransform) return;

    // Reset this group's transforms before applying the plugin
    groupRef.current.rotation.set(0, 0, 0);
    groupRef.current.scale.set(1, 1, 1);
    groupRef.current.position.set(0, 0, 0);

    const settings = getPluginSettingsWithOverrides(trackId, instance.id, instance.settings);
    const isEnabled =
      settings.enabled !== undefined ? (settings.enabled as number) >= 0.5 : instance.enabled;
    if (!isEnabled) return;

    plugin.applyTransform(groupRef.current, settings, state.clock.elapsedTime);
  });

  return <group ref={groupRef}>{children}</group>;
}

interface TransformWrapperProps {
  trackId: string;
  plugins: PluginInstance[];
  children: React.ReactNode;
}

export function TransformWrapper({ trackId, plugins, children }: TransformWrapperProps) {
  // Get all transform plugins in order
  const transformPlugins = plugins.filter((instance) => {
    const plugin = getPlugin(instance.pluginId);
    return plugin?.category === 'transform' && plugin.applyTransform;
  });

  // Build nested groups: first plugin in the list is innermost, last is outermost.
  // This means later transforms wrap earlier ones, so e.g. offset (inner) then
  // rotate (outer) causes the rotation to apply after the offset — giving orbital motion.
  let element: React.ReactNode = children;
  for (let i = 0; i < transformPlugins.length; i++) {
    element = (
      <SingleTransform trackId={trackId} instance={transformPlugins[i]}>
        {element}
      </SingleTransform>
    );
  }

  return <>{element}</>;
}

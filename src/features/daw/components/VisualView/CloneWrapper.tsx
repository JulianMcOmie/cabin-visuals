'use client';

import React, { useMemo, useRef, ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PluginInstance } from '@daw/core/types';
import { getPlugin } from '@daw/plugins';
import { getPluginSettingsWithOverrides } from '@daw/core/visualPlayback';

interface CloneWrapperProps {
  trackId: string;
  plugins: PluginInstance[];
  children: ReactNode;
}

interface CloneData {
  pluginId: string;
  instanceId: string;
  count: number;
  getTransform: (
    index: number,
    settings: Record<string, unknown>,
    time: number
  ) => THREE.Matrix4;
  settings: Record<string, unknown>;
}

// Module-scope scratch objects — reused every frame to avoid allocations
const _tempMatrix = new THREE.Matrix4();
const _combinedMatrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();

export function CloneWrapper({ trackId, plugins, children }: CloneWrapperProps) {
  const groupRefs = useRef<(THREE.Group | null)[]>([]);

  // Get all clone plugins (enabled check is per-frame via automation)
  const clonePlugins = plugins.filter((instance) => {
    const plugin = getPlugin(instance.pluginId);
    return plugin?.category === 'clone' && plugin.getClones;
  });

  // Calculate clone data from all clone plugins
  const cloneData = useMemo<CloneData[]>(() => {
    return clonePlugins.map((instance) => {
      const plugin = getPlugin(instance.pluginId)!;
      const cloneConfig = plugin.getClones!(instance.settings);
      return {
        pluginId: instance.pluginId,
        instanceId: instance.id,
        count: cloneConfig.count,
        getTransform: cloneConfig.getTransform,
        settings: instance.settings,
      };
    });
  }, [clonePlugins]);

  // Total number of clones (multiply all plugin clone counts)
  const totalClones = useMemo(() => {
    if (cloneData.length === 0) return 1;
    return cloneData.reduce((acc, d) => acc * d.count, 1);
  }, [cloneData]);

  // Update transforms each frame
  useFrame((state) => {
    const time = state.clock.elapsedTime;

    groupRefs.current.forEach((group, cloneIndex) => {
      if (!group) return;

      // Reset transform
      group.position.set(0, 0, 0);
      group.scale.set(1, 1, 1);
      group.rotation.set(0, 0, 0);

      if (cloneData.length === 0) return;

      // For each clone plugin, calculate which sub-index this clone is
      // and apply the corresponding transform
      let remainingIndex = cloneIndex;
      _combinedMatrix.identity();

      for (let i = cloneData.length - 1; i >= 0; i--) {
        const data = cloneData[i];
        const subIndex = remainingIndex % data.count;
        remainingIndex = Math.floor(remainingIndex / data.count);

        const settings = getPluginSettingsWithOverrides(trackId, data.instanceId, data.settings);
        // Check enabled: automation override takes priority, else use store value
        const pi = plugins.find(p => p.id === data.instanceId);
        const isEnabled = settings.enabled !== undefined ? (settings.enabled as number) >= 0.5 : (pi?.enabled ?? true);
        if (!isEnabled) {
          remainingIndex = Math.floor(remainingIndex / data.count);
          continue;
        }
        const transform = data.getTransform(subIndex, settings, time);
        _combinedMatrix.premultiply(transform);
      }

      // Apply combined transform using module-scope scratch objects
      _combinedMatrix.decompose(_position, _quaternion, _scale);

      group.position.copy(_position);
      group.quaternion.copy(_quaternion);
      group.scale.copy(_scale);

      // Apply opacity falloff via userData (instruments can read this)
      const firstData = cloneData[0];
      const firstSettings = firstData ? getPluginSettingsWithOverrides(trackId, firstData.instanceId, firstData.settings) : {};
      const opacityFalloff = firstSettings.opacityFalloff as number ?? 0.2;
      group.userData.opacity = Math.max(0.1, 1 - opacityFalloff * cloneIndex);
      group.userData.cloneIndex = cloneIndex;
    });
  });

  // If no clone plugins, just render children directly
  if (cloneData.length === 0) {
    return <>{children}</>;
  }

  // Clone children for each copy - must create separate React elements
  // so React Three Fiber creates separate Three.js objects
  const cloneChildren = (children: ReactNode, cloneIndex: number): ReactNode => {
    return React.Children.map(children, (child, childIndex) => {
      if (!React.isValidElement(child)) return child;
      return React.cloneElement(child, {
        key: `clone-${cloneIndex}-${childIndex}`,
      } as React.Attributes);
    });
  };

  // Render multiple copies
  return (
    <>
      {Array.from({ length: totalClones }).map((_, index) => (
        <group
          key={index}
          ref={(el) => {
            groupRefs.current[index] = el;
          }}
        >
          {cloneChildren(children, index)}
        </group>
      ))}
    </>
  );
}

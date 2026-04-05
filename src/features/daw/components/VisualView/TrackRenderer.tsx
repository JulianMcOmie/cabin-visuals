'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, createPortal } from '@react-three/fiber';
import * as THREE from 'three';
import { PluginInstance } from '@daw/core/types';
import { getInstrument } from '@daw/instruments';
import { getPlugin } from '@daw/plugins';
import { useProjectStore } from '@daw/stores/projectStore';
import { getVisualPlaybackEngine } from '@daw/core/visualPlayback';
import { TransformWrapper } from './TransformWrapper';
import { CloneWrapper } from './CloneWrapper';
import { ShaderChain } from './ShaderChain';

/** Wraps a child visual component, hiding it when its track is muted or blacked out */
function BlackoutGroup({ trackId, children }: { trackId: string; children: React.ReactNode }) {
  const groupRef = useRef<THREE.Group>(null);
  const muted = useProjectStore((s) => s.project.tracks[trackId]?.muted ?? false);
  useFrame(() => {
    if (!groupRef.current) return;
    if (muted) {
      groupRef.current.visible = false;
      return;
    }
    const engine = getVisualPlaybackEngine();
    const state = engine.getTrackState(trackId);
    groupRef.current.visible = !(state?.blackedOut ?? false);
  });
  return <group ref={groupRef}>{children}</group>;
}

interface TrackRendererProps {
  trackId: string;
  instrumentId: string;
  plugins: PluginInstance[];
  isGroup?: boolean;
  childIds?: string[];
}

interface ShaderPipeline {
  fbo: THREE.WebGLRenderTarget;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

export function TrackRenderer({
  trackId,
  instrumentId,
  plugins,
  isGroup,
  childIds,
}: TrackRendererProps) {
  const tracks = useProjectStore((s) => s.project.tracks);
  const instrument = getInstrument(instrumentId);
  const Component = instrument?.VisualComponent;
  const { gl } = useThree();
  const rootGroupRef = useRef<THREE.Group>(null);

  // Check blackout and mute state each frame and hide the entire group
  const trackMuted = useProjectStore((s) => s.project.tracks[trackId]?.muted ?? false);
  useFrame(() => {
    if (!rootGroupRef.current) return;
    if (trackMuted) {
      rootGroupRef.current.visible = false;
      return;
    }
    const engine = getVisualPlaybackEngine();
    const state = engine.getTrackState(trackId);
    rootGroupRef.current.visible = !(state?.blackedOut ?? false);
  });

  // Check plugin categories — include all plugins (even disabled ones) since
  // automation can toggle enabled state per-frame
  const hasShaderPlugins = plugins.some((instance) => {
    const plugin = getPlugin(instance.pluginId);
    return plugin?.category === 'shader';
  });

  const hasClonePlugins = plugins.some((instance) => {
    const plugin = getPlugin(instance.pluginId);
    return plugin?.category === 'clone';
  });

  const hasTransformPlugins = plugins.some((instance) => {
    const plugin = getPlugin(instance.pluginId);
    return plugin?.category === 'transform';
  });

  const hasAnyPlugins = hasShaderPlugins || hasClonePlugins || hasTransformPlugins;
  const usesShaderPipeline = hasShaderPlugins && !hasClonePlugins;

  // Lazily allocate offscreen render resources only when shader plugins are active.
  const shaderPipeline = useMemo<ShaderPipeline | null>(() => {
    if (!usesShaderPipeline) return null;

    const fbo = new THREE.WebGLRenderTarget(1024, 1024, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      stencilBuffer: false,
    });

    const scene = new THREE.Scene();
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(5, 5, 5);
    const point = new THREE.PointLight(0x8b5cf6, 0.5);
    point.position.set(-5, 5, -5);
    scene.add(ambient, directional, point);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 8);

    return { fbo, scene, camera };
  }, [usesShaderPipeline]);

  useEffect(() => {
    return () => {
      shaderPipeline?.fbo.dispose();
    };
  }, [shaderPipeline]);

  useFrame(() => {
    // Only render to FBO when shader pipeline is active.
    if (!shaderPipeline) return;
    if (!isGroup && !Component) return;

    // Render instrument scene to FBO
    gl.setRenderTarget(shaderPipeline.fbo);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.render(shaderPipeline.scene, shaderPipeline.camera);
    gl.setRenderTarget(null);
  });

  // Collect all visual instruments from children (for groups)
  const childVisualComponents = useMemo(() => {
    if (!isGroup || !childIds) return [];

    const components: { trackId: string; Component: React.ComponentType<{ trackId: string }> }[] =
      [];

    const collectVisuals = (ids: string[]) => {
      const siblings = ids.map(id => tracks[id]).filter(Boolean);
      const anySoloed = siblings.some(t => t.solo);

      for (const id of ids) {
        const track = tracks[id];
        if (!track) continue;
        if (anySoloed && !track.solo) continue;

        if (track.instrumentId) {
          const inst = getInstrument(track.instrumentId);
          if (inst?.hasVisual && inst.VisualComponent) {
            components.push({ trackId: id, Component: inst.VisualComponent });
          }
        }

        // Recurse into children
        if (track.childIds.length > 0) {
          collectVisuals(track.childIds);
        }
      }
    };

    // Include the group track's own visual instrument (if it has one)
    if (instrument?.hasVisual && instrument.VisualComponent) {
      components.unshift({ trackId, Component: instrument.VisualComponent });
    }

    collectVisuals(childIds);
    return components;
  }, [isGroup, childIds, tracks, trackId, instrument]);

  // For groups without any visual children, nothing to render
  if (isGroup && childVisualComponents.length === 0) {
    return null;
  }

  // For non-groups without a component, nothing to render
  if (!isGroup && !Component) {
    return null;
  }

  // Split transform plugins into pre-clone and post-clone groups based on
  // their position relative to clone plugins in the user's plugin order.
  // Transforms before the first clone affect the base shape; transforms after
  // the last clone affect the entire cloned output.
  const { preClonePlugins, postClonePlugins } = useMemo(() => {
    const firstCloneIdx = plugins.findIndex((inst) => {
      const p = getPlugin(inst.pluginId);
      return p?.category === 'clone';
    });
    const lastCloneIdx = (() => {
      for (let i = plugins.length - 1; i >= 0; i--) {
        const p = getPlugin(plugins[i].pluginId);
        if (p?.category === 'clone') return i;
      }
      return -1;
    })();

    if (firstCloneIdx === -1) {
      // No clone plugins — all transforms are "pre-clone"
      return { preClonePlugins: plugins, postClonePlugins: [] as PluginInstance[] };
    }

    const pre = plugins.filter((inst, idx) => {
      const p = getPlugin(inst.pluginId);
      return p?.category === 'transform' && idx < firstCloneIdx;
    });
    const post = plugins.filter((inst, idx) => {
      const p = getPlugin(inst.pluginId);
      return p?.category === 'transform' && idx > lastCloneIdx;
    });
    return { preClonePlugins: pre, postClonePlugins: post };
  }, [plugins]);

  const hasPostCloneTransforms = postClonePlugins.length > 0;

  // Build the base content element (instrument only, no clone wrapper)
  const buildBaseContentElement = () => {
    let element: React.ReactNode;

    if (isGroup) {
      // Render all child visual instruments, each wrapped with blackout check
      element = (
        <>
          {childVisualComponents.map(({ trackId: childTrackId, Component: ChildComponent }) => (
            <BlackoutGroup key={childTrackId} trackId={childTrackId}>
              <ChildComponent trackId={childTrackId} />
            </BlackoutGroup>
          ))}
        </>
      );
    } else if (Component) {
      // Single instrument
      element = <Component trackId={trackId} />;
    } else {
      return null;
    }

    // Wrap with pre-clone TransformWrapper (transforms before first clone plugin)
    if (preClonePlugins.length > 0) {
      element = <TransformWrapper trackId={trackId} plugins={preClonePlugins}>{element}</TransformWrapper>;
    }

    return element;
  };

  // Build content with optional clone wrapper (for non-shader path)
  const buildContentElement = () => {
    let element = buildBaseContentElement();
    if (!element) return null;

    // Wrap with CloneWrapper if we have clone plugins (and no shaders)
    if (hasClonePlugins) {
      element = <CloneWrapper trackId={trackId} plugins={plugins}>{element}</CloneWrapper>;
    }

    // Wrap with post-clone TransformWrapper (transforms after last clone plugin)
    if (hasPostCloneTransforms) {
      element = <TransformWrapper trackId={trackId} plugins={postClonePlugins}>{element}</TransformWrapper>;
    }

    return element;
  };

  // No plugins at all - render content directly
  if (!hasAnyPlugins) {
    if (isGroup) {
      return (
        <group ref={rootGroupRef} position={[0, 0, 0]}>
          {childVisualComponents.map(({ trackId: childTrackId, Component: ChildComponent }) => (
            <BlackoutGroup key={childTrackId} trackId={childTrackId}>
              <ChildComponent trackId={childTrackId} />
            </BlackoutGroup>
          ))}
        </group>
      );
    }
    if (!Component) return null;
    return (
      <group ref={rootGroupRef} position={[0, 0, 0]}>
        <Component trackId={trackId} />
      </group>
    );
  }

  // Has shader plugins - render to FBO and apply shader chain
  // Skip shaders if clone plugins are present (clones need 3D objects, not flat planes)
  if (usesShaderPipeline && shaderPipeline) {
    return (
      <group ref={rootGroupRef}>
        {/* Render base content to offscreen scene (portal) - no clone wrapper here */}
        {createPortal(
          <group position={[0, 0, 0]}>{buildBaseContentElement()}</group>,
          shaderPipeline.scene
        )}

        {/* Apply shader chain and render result */}
        <ShaderChain trackId={trackId} inputTexture={shaderPipeline.fbo.texture} plugins={plugins} />
      </group>
    );
  }

  // Only transform/clone plugins (no shaders) - no need for FBO
  return <group ref={rootGroupRef} position={[0, 0, 0]}>{buildContentElement()}</group>;
}

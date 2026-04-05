'use client';

import { useRef, useEffect, useState, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getVisualPlaybackEngine } from '@daw/core/visualPlayback';
import { getVideoFile } from '@daw/services/videoStorage';
import { Instrument } from '../types';

const MAX_SEGMENTS = 16;

const DEFAULTS: Record<string, unknown> = {
  numSegments: 6,
  maskMode: 'wedge',
  spiralIntensity: 0,
  rotationSpeed: 0,
  voronoiDensity: 5,
  voronoiWobble: 0.0,
  voronoiLineWidth: 0.05,
  scale: 1,
  opacity: 1,
  x: 0,
  y: 0,
  featherEdge: 0.02,
  sliceVideoMap: {},
};

// Add per-segment fill defaults
for (let i = 0; i < MAX_SEGMENTS; i++) {
  DEFAULTS[`fill${i}`] = 1;
}

// Vertex shader
const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Fragment shader with wedge + voronoi mask modes
const fragmentShader = /* glsl */ `
  uniform sampler2D uVideoTexture;
  uniform int uMaskMode; // 0 = wedge, 1 = voronoi
  uniform int uSegmentIndex;
  uniform int uNumSegments;

  // Wedge uniforms
  uniform float uWedgeStart;
  uniform float uWedgeEnd;
  uniform float uSpiralIntensity;

  // Shared uniforms
  uniform float uRotation;
  uniform float uOpacity;
  uniform float uActive;
  uniform float uFeatherEdge;

  // Voronoi uniforms
  uniform float uVoronoiDensity;
  uniform float uVoronoiWobble;
  uniform float uVoronoiLineWidth;
  uniform float uFill; // 0-1, what fraction of cells for this segment to show
  uniform float uTime;

  varying vec2 vUv;

  #define TWO_PI 6.28318530718

  // Hash functions for procedural seed generation
  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }

  // Float hash for mapping cell to segment index or fill threshold
  float hashFloat(vec2 cell, float seed) {
    return fract(sin(dot(cell, vec2(127.1 + seed, 311.7 + seed))) * 43758.5453);
  }

  int hashCell(vec2 cell, int numSeg) {
    return int(floor(hashFloat(cell, 0.0) * float(numSeg)));
  }

  void main() {
    vec2 centered = vUv * 2.0 - 1.0;
    float dist = length(centered);

    float mask = 0.0;

    if (uMaskMode == 0) {
      // === WEDGE MODE ===
      float angle = atan(centered.y, centered.x);
      angle += dist * uSpiralIntensity + uRotation;
      angle = mod(angle, TWO_PI);

      float wedgeStart = mod(uWedgeStart, TWO_PI);
      float wedgeEnd = mod(uWedgeEnd, TWO_PI);

      if (wedgeStart < wedgeEnd) {
        float lower = smoothstep(wedgeStart - uFeatherEdge, wedgeStart + uFeatherEdge, angle);
        float upper = 1.0 - smoothstep(wedgeEnd - uFeatherEdge, wedgeEnd + uFeatherEdge, angle);
        mask = lower * upper;
      } else {
        float inUpper = smoothstep(wedgeStart - uFeatherEdge, wedgeStart + uFeatherEdge, angle);
        float inLower = 1.0 - smoothstep(wedgeEnd - uFeatherEdge, wedgeEnd + uFeatherEdge, angle);
        mask = max(inUpper, inLower);
      }
    } else {
      // === VORONOI MODE ===
      vec2 p = centered * uVoronoiDensity;
      vec2 cellId = floor(p);
      vec2 cellUv = fract(p);

      float minDist1 = 1e10;
      float minDist2 = 1e10;
      vec2 closestSeedPos = vec2(0.0);
      vec2 secondSeedPos = vec2(0.0);
      int closestSegment = 0;
      vec2 closestCellId = vec2(0.0);

      // Search 3x3 neighborhood
      for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
          vec2 neighbor = vec2(float(dx), float(dy));
          vec2 neighborCell = cellId + neighbor;

          vec2 jitter = hash2(neighborCell);
          vec2 wobble = vec2(
            sin(uTime * 0.7 + jitter.x * TWO_PI) * uVoronoiWobble,
            cos(uTime * 0.5 + jitter.y * TWO_PI) * uVoronoiWobble
          );
          vec2 seedOffset = neighbor + jitter * (1.0 - uVoronoiWobble) + wobble - cellUv;

          float d = length(seedOffset);
          int seg = hashCell(neighborCell, uNumSegments);

          if (d < minDist1) {
            minDist2 = minDist1;
            secondSeedPos = closestSeedPos;
            minDist1 = d;
            closestSeedPos = seedOffset;
            closestSegment = seg;
            closestCellId = neighborCell;
          } else if (d < minDist2) {
            minDist2 = d;
            secondSeedPos = seedOffset;
          }
        }
      }

      // Show this fragment if the closest cell maps to our segment
      if (closestSegment == uSegmentIndex) {
        // Per-cell fill: use a second hash to give each cell a threshold
        float cellThreshold = hashFloat(closestCellId, 50.0);
        if (cellThreshold < uFill) {
          mask = 1.0;
        }
      }

      // Uniform-width lines using perpendicular bisector distance
      if (uVoronoiLineWidth > 0.0) {
        vec2 midpoint = (closestSeedPos + secondSeedPos) * 0.5;
        vec2 edgeDir = normalize(secondSeedPos - closestSeedPos);
        float edgeDist = abs(dot(midpoint, edgeDir));
        float line = 1.0 - step(uVoronoiLineWidth * 0.5, edgeDist);
        mask *= (1.0 - line);
      }
    }

    // Circular edge fade
    float circleFade = 1.0 - smoothstep(0.95, 1.0, dist);

    vec4 videoColor = texture2D(uVideoTexture, vUv);

    float alpha = mask * circleFade * uOpacity * uActive;
    if (alpha < 0.001) discard;

    gl_FragColor = vec4(videoColor.rgb, alpha);
  }
`;

interface SegmentState {
  video: HTMLVideoElement | null;
  texture: THREE.VideoTexture | null;
  blobUrl: string | null;
  loadedVideoId: string;
  aspect: number;
}

function VideoKaleidoscopeVisual({ trackId }: { trackId: string }) {
  const engineRef = useRef(getVisualPlaybackEngine());
  const { viewport } = useThree();
  const [ready, setReady] = useState(false);
  const rotationRef = useRef(0);
  const timeRef = useRef(0);

  // Create a blank texture for segments without video
  const blankTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 2, 2);
    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }, []);

  // Segment state for up to MAX_SEGMENTS
  const segmentsRef = useRef<SegmentState[]>(
    Array.from({ length: MAX_SEGMENTS }, () => ({
      video: null,
      texture: null,
      blobUrl: null,
      loadedVideoId: '',
      aspect: 1,
    }))
  );

  // Mesh refs for each segment
  const meshRefs = useRef<(THREE.Mesh | null)[]>(Array(MAX_SEGMENTS).fill(null));

  // Load video for a specific segment
  const loadSegmentVideo = (segmentIndex: number, videoStorageId: string) => {
    const seg = segmentsRef.current[segmentIndex];
    if (seg.loadedVideoId === videoStorageId) return;
    seg.loadedVideoId = videoStorageId;

    getVideoFile(videoStorageId).then((file) => {
      if (!file) return;
      if (seg.loadedVideoId !== videoStorageId) return;

      if (seg.blobUrl) URL.revokeObjectURL(seg.blobUrl);
      if (seg.texture) seg.texture.dispose();
      if (seg.video) {
        seg.video.pause();
        seg.video.src = '';
      }

      const url = URL.createObjectURL(file.blob);
      seg.blobUrl = url;
      seg.aspect = file.width / file.height;

      const video = document.createElement('video');
      video.src = url;
      video.crossOrigin = 'anonymous';
      video.playsInline = true;
      video.muted = true;
      video.loop = true;
      video.preload = 'auto';
      video.load();
      video.play().catch(() => {});

      seg.video = video;

      const tex = new THREE.VideoTexture(video);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      seg.texture = tex;

      setReady(true);
    });
  };

  useFrame((_, delta) => {
    const state = engineRef.current.getTrackState(trackId);
    if (!state) return;

    const numSegments = (state.params.numSegments as number) ?? DEFAULTS.numSegments;
    const maskMode = (state.params.maskMode as string) ?? DEFAULTS.maskMode;
    const spiralIntensity = (state.params.spiralIntensity as number) ?? DEFAULTS.spiralIntensity;
    const rotationSpeed = (state.params.rotationSpeed as number) ?? DEFAULTS.rotationSpeed;
    const voronoiDensity = (state.params.voronoiDensity as number) ?? DEFAULTS.voronoiDensity;
    const voronoiWobble = (state.params.voronoiWobble as number) ?? DEFAULTS.voronoiWobble;
    const voronoiLineWidth = (state.params.voronoiLineWidth as number) ?? DEFAULTS.voronoiLineWidth;
    const scale = (state.params.scale as number) ?? DEFAULTS.scale;
    const opacity = (state.params.opacity as number) ?? DEFAULTS.opacity;
    const x = (state.params.x as number) ?? DEFAULTS.x;
    const y = (state.params.y as number) ?? DEFAULTS.y;
    const featherEdge = (state.params.featherEdge as number) ?? DEFAULTS.featherEdge;
    const sliceVideoMap = (state.params.sliceVideoMap as Record<string, string>) ?? DEFAULTS.sliceVideoMap;

    rotationRef.current += rotationSpeed * delta;
    timeRef.current += delta;

    const TWO_PI = Math.PI * 2;
    const wedgeSize = TWO_PI / numSegments;
    const isModeVoronoi = maskMode === 'voronoi';

    // Load videos for each segment
    for (let i = 0; i < MAX_SEGMENTS; i++) {
      const videoId = sliceVideoMap[String(i)];
      if (videoId) {
        loadSegmentVideo(i, videoId);
      }
    }

    // Check which segments are active via MIDI (pitch 60+i)
    const activeSegments = new Set<number>();
    state.activeNotes.forEach((_event, pitch) => {
      const segIdx = pitch - 60;
      if (segIdx >= 0 && segIdx < numSegments) {
        activeSegments.add(segIdx);
      }
    });

    // Update each mesh
    for (let i = 0; i < MAX_SEGMENTS; i++) {
      const mesh = meshRefs.current[i];
      if (!mesh) continue;

      if (i >= numSegments || !sliceVideoMap[String(i)]) {
        mesh.visible = false;
        continue;
      }

      const seg = segmentsRef.current[i];
      const isActive = activeSegments.has(i);
      const fill = (state.params[`fill${i}`] as number) ?? 1;

      if (seg.video) {
        if (isActive && seg.video.paused) {
          seg.video.play().catch(() => {});
        } else if (!isActive && !seg.video.paused) {
          seg.video.pause();
        }
      }

      mesh.visible = isActive && !!seg.texture;
      if (!mesh.visible) continue;

      const mat = mesh.material as THREE.ShaderMaterial;
      mat.uniforms.uVideoTexture.value = seg.texture || blankTexture;
      mat.uniforms.uMaskMode.value = isModeVoronoi ? 1 : 0;
      mat.uniforms.uSegmentIndex.value = i;
      mat.uniforms.uNumSegments.value = numSegments;
      mat.uniforms.uOpacity.value = opacity;
      mat.uniforms.uActive.value = isActive ? 1.0 : 0.0;
      mat.uniforms.uFill.value = fill;
      mat.uniforms.uFeatherEdge.value = featherEdge;
      mat.uniforms.uTime.value = timeRef.current;

      if (isModeVoronoi) {
        mat.uniforms.uVoronoiDensity.value = voronoiDensity;
        mat.uniforms.uVoronoiWobble.value = voronoiWobble;
        mat.uniforms.uVoronoiLineWidth.value = voronoiLineWidth;
        mat.uniforms.uRotation.value = rotationRef.current;
      } else {
        mat.uniforms.uWedgeStart.value = i * wedgeSize;
        mat.uniforms.uWedgeEnd.value = (i + 1) * wedgeSize;
        mat.uniforms.uSpiralIntensity.value = spiralIntensity;
        mat.uniforms.uRotation.value = rotationRef.current;
      }

      const baseScale = Math.min(viewport.width, viewport.height) * 0.5 * scale;
      mesh.scale.set(baseScale, baseScale, 1);
      mesh.position.set(x * viewport.width * 0.5, y * viewport.height * 0.5, 0);
    }
  });

  // Cleanup
  useEffect(() => {
    return () => {
      for (const seg of segmentsRef.current) {
        if (seg.texture) seg.texture.dispose();
        if (seg.video) {
          seg.video.pause();
          seg.video.src = '';
        }
        if (seg.blobUrl) URL.revokeObjectURL(seg.blobUrl);
      }
      blankTexture.dispose();
    };
  }, [blankTexture]);

  // Create shader materials for each segment
  const materials = useMemo(() => {
    return Array.from({ length: MAX_SEGMENTS }, () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uVideoTexture: { value: blankTexture },
          uMaskMode: { value: 0 },
          uSegmentIndex: { value: 0 },
          uNumSegments: { value: 6 },
          uWedgeStart: { value: 0 },
          uWedgeEnd: { value: 0 },
          uSpiralIntensity: { value: 0 },
          uRotation: { value: 0 },
          uOpacity: { value: 1 },
          uActive: { value: 0 },
          uFill: { value: 1.0 },
          uFeatherEdge: { value: 0.02 },
          uVoronoiDensity: { value: 5.0 },
          uVoronoiWobble: { value: 0.0 },
          uVoronoiLineWidth: { value: 0.05 },
          uTime: { value: 0 },
        },
      })
    );
  }, [blankTexture]);

  return (
    <>
      {materials.map((mat, i) => (
        <mesh
          key={i}
          ref={(el) => { meshRefs.current[i] = el; }}
          visible={false}
          material={mat}
        >
          <planeGeometry args={[2, 2]} />
        </mesh>
      ))}
    </>
  );
}

function generateRangeLabels(numSegments: number) {
  return Array.from({ length: numSegments }, (_, i) => ({
    startPitch: 60 + i,
    endPitch: 60 + i,
    label: `Segment ${i + 1}`,
  }));
}

export const VideoKaleidoscope: Instrument = {
  id: 'videoKaleidoscope',
  name: 'Video Kaleidoscope',
  description: 'Circular kaleidoscope with pie-slice wedges or voronoi cells, each displaying a different video',
  icon: '🔮',
  color: '#8844cc',
  hasAudio: false,
  hasVisual: true,
  editorType: 'generic',
  noteRange: { min: 60, max: 60 + MAX_SEGMENTS - 1 },
  rangeLabels: generateRangeLabels(MAX_SEGMENTS),

  defaultSettings: { ...DEFAULTS },

  settingsSchema: {
    maskMode: {
      type: 'select', label: 'Mask Mode',
      options: [
        { value: 'wedge', label: 'Wedge' },
        { value: 'voronoi', label: 'Voronoi' },
      ],
      default: DEFAULTS.maskMode,
    },
    numSegments: {
      type: 'number', label: 'Segments', min: 2, max: 16, step: 1,
      default: DEFAULTS.numSegments,
    },
    spiralIntensity: {
      type: 'number', label: 'Spiral Intensity', min: -10, max: 10, step: 0.1,
      default: DEFAULTS.spiralIntensity,
    },
    rotationSpeed: {
      type: 'number', label: 'Rotation Speed', min: -3, max: 3, step: 0.05,
      default: DEFAULTS.rotationSpeed,
    },
    voronoiDensity: {
      type: 'number', label: 'Voronoi Density', min: 1, max: 20, step: 1,
      default: DEFAULTS.voronoiDensity,
    },
    voronoiWobble: {
      type: 'number', label: 'Voronoi Wobble', min: 0, max: 0.5, step: 0.05,
      default: DEFAULTS.voronoiWobble,
    },
    voronoiLineWidth: {
      type: 'number', label: 'Cell Line Width', min: 0, max: 0.15, step: 0.005,
      default: DEFAULTS.voronoiLineWidth,
    },
    scale: {
      type: 'number', label: 'Scale', min: 0.1, max: 5, step: 0.1,
      default: DEFAULTS.scale,
    },
    opacity: {
      type: 'number', label: 'Opacity', min: 0, max: 1, step: 0.05,
      default: DEFAULTS.opacity,
    },
    x: {
      type: 'number', label: 'X Position', min: -1, max: 1, step: 0.05,
      default: DEFAULTS.x,
    },
    y: {
      type: 'number', label: 'Y Position', min: -1, max: 1, step: 0.05,
      default: DEFAULTS.y,
    },
    featherEdge: {
      type: 'number', label: 'Edge Feather', min: 0, max: 0.2, step: 0.005,
      default: DEFAULTS.featherEdge,
    },
    // Per-segment fill (automatable)
    ...Object.fromEntries(
      Array.from({ length: MAX_SEGMENTS }, (_, i) => [
        `fill${i}`,
        { type: 'number', label: `Seg ${i + 1} Fill`, min: 0, max: 1, step: 0.05, default: 1 },
      ])
    ),
  },

  VisualComponent: VideoKaleidoscopeVisual,
};

'use client';

import { useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getVisualPlaybackEngine } from '@daw/core/visualPlayback';
import { Instrument } from '../types';

interface HexagonDotsProps {
  trackId: string;
}

interface DotInstance {
  id: number;
  position: THREE.Vector3;
  color: THREE.Color;
  size: number;
  opacity: number;
  radius: number;
  angle: number;
}

let colorHue = 0;
let dotIdCounter = 0;

function getNextRainbowColor(): THREE.Color {
  const hue = (colorHue % 360) / 360;
  colorHue += 15 + Math.random() * 10;
  const color = new THREE.Color();
  color.setHSL(hue, 0.9, 0.6);
  return color;
}

function getHexagonPoint(angle: number, radius: number, distance: number): THREE.Vector3 {
  const hexAngle = Math.PI / 3;
  const vertexIndex = Math.floor((angle / (Math.PI * 2)) * 6);
  const localAngle = (angle % hexAngle) / hexAngle;

  const angle1 = vertexIndex * hexAngle;
  const angle2 = (vertexIndex + 1) * hexAngle;

  const x1 = Math.cos(angle1) * radius;
  const y1 = Math.sin(angle1) * radius;
  const x2 = Math.cos(angle2) * radius;
  const y2 = Math.sin(angle2) * radius;

  const x = x1 + (x2 - x1) * localAngle;
  const y = y1 + (y2 - y1) * localAngle;

  return new THREE.Vector3(x, y, -distance);
}

function GlowingDot({ instance }: { instance: DotInstance }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(() => {
    if (!meshRef.current || !materialRef.current) return;
    meshRef.current.position.copy(instance.position);
    materialRef.current.opacity = instance.opacity;
  });

  return (
    <mesh ref={meshRef} position={instance.position}>
      <sphereGeometry args={[instance.size, 16, 16]} />
      <meshBasicMaterial
        ref={materialRef}
        color={instance.color}
        transparent
        opacity={instance.opacity}
        depthWrite={false}
      />
    </mesh>
  );
}

function HexagonDotsVisual({ trackId }: HexagonDotsProps) {
  const [dots, setDots] = useState<DotInstance[]>([]);
  const seenNotesRef = useRef<Set<string>>(new Set());
  const dotsRef = useRef<DotInstance[]>([]);
  const engineRef = useRef(getVisualPlaybackEngine());
  const { camera } = useThree();

  const hexagonRadius = 4;
  const hexagonDistance = 25;
  const dotSpeed = 4.0;
  const cameraZThreshold = camera.position.z + 2;

  useFrame((_, delta) => {
    const state = engineRef.current.getTrackState(trackId);
    if (!state) return;

    for (const [pitch, note] of state.activeNotes) {
      const noteKey = `${pitch}:${note.startTimeInBeats}`;
      if (!seenNotesRef.current.has(noteKey)) {
        seenNotesRef.current.add(noteKey);

        const numDots = 6;
        const baseColor = getNextRainbowColor();

        for (let i = 0; i < numDots; i++) {
          const baseAngle = (i / numDots) * Math.PI * 2;
          const angle = baseAngle + (Math.random() - 0.5) * 0.3;
          const position = getHexagonPoint(angle, hexagonRadius, hexagonDistance);

          const dotRadius = Math.sqrt(position.x * position.x + position.y * position.y);

          const dotColor = baseColor.clone();
          dotColor.offsetHSL(Math.random() * 0.05 - 0.025, 0, Math.random() * 0.1 - 0.05);

          const velocityFactor = note.velocity / 127;

          const newDot: DotInstance = {
            id: dotIdCounter++,
            position,
            color: dotColor,
            size: 0.1 + velocityFactor * 0.1,
            opacity: 0.8 + velocityFactor * 0.2,
            radius: dotRadius,
            angle: angle,
          };
          dotsRef.current.push(newDot);
        }
      }
    }

    for (const noteKey of seenNotesRef.current) {
      const pitch = parseInt(noteKey.split(':')[0]);
      if (!state.activeNotes.has(pitch)) {
        seenNotesRef.current.delete(noteKey);
      }
    }

    const rotationSpeed = 0.5;

    for (const dot of dotsRef.current) {
      dot.position.z += dotSpeed * delta;

      dot.angle += rotationSpeed * delta;
      dot.position.x = Math.cos(dot.angle) * dot.radius;
      dot.position.y = Math.sin(dot.angle) * dot.radius;

      const distanceFromCamera = camera.position.z - dot.position.z;
      if (distanceFromCamera < 2) {
        dot.opacity = Math.max(0, distanceFromCamera / 2);
      } else if (dot.position.z > -hexagonDistance + 5) {
        const fadeInProgress = (hexagonDistance + dot.position.z) / 5;
        dot.opacity = Math.min(1, fadeInProgress);
      }
    }

    dotsRef.current = dotsRef.current.filter(d => d.position.z < cameraZThreshold);

    setDots([...dotsRef.current]);
  });

  return (
    <group>
      {dots.map((dot) => (
        <GlowingDot key={dot.id} instance={dot} />
      ))}
    </group>
  );
}

// Unified Instrument definition
export const HexagonDots: Instrument = {
  id: 'hexagonDots',
  name: 'Hexagon Dots',
  description: 'Glowing dots spawn from a distant hexagon and float towards the camera',
  icon: '✨',
  color: '#4ECDC4',
  hasAudio: false,
  hasVisual: true,
  editorType: 'generic',

  defaultSettings: {
    dotSpeed: 4.0,
    hexagonDistance: 25,
    dotSize: 0.15,
  },

  settingsSchema: {
    dotSpeed: { type: 'number', label: 'Dot Speed', min: 1, max: 10, step: 0.5, default: 4.0 },
    dotSize: { type: 'number', label: 'Dot Size', min: 0.05, max: 0.5, step: 0.05, default: 0.15 },
  },

  VisualComponent: HexagonDotsVisual,
};

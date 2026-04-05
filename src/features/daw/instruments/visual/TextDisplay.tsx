'use client';

import { useRef, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getVisualPlaybackEngine } from '@daw/core/visualPlayback';
import { useUIStore } from '@daw/stores/uiStore';
import { Instrument } from '../types';
import { loadFont, isFontReady } from '@daw/utils/fonts';

const PITCH_NEXT_WORD = 48;
const PITCH_HEIGHT_MIN = 60;  // C4
const PITCH_HEIGHT_MAX = 72;  // C5
const PITCH_HEIGHT_CENTER = 66; // F#4 = no offset
const MAX_DELAY_TAPS = 8;
const MAX_REVERB_REFLECTIONS = 16;
const MAX_WALL_SLOTS = 50;

// Deterministic pseudo-random offsets per reverb reflection (seeded by index)
const REVERB_OFFSETS = Array.from({ length: MAX_REVERB_REFLECTIONS }, (_, i) => {
  // Simple seeded hash per index for deterministic values in 0..1
  const seed = (i + 1) * 2654435761;
  const hash = (n: number) => ((n >>> 0) & 0x7fffffff) / 0x7fffffff;
  return {
    t: hash((seed * 13) ^ 0xdeadbeef),       // time scatter 0..1
    x: hash((seed * 17) ^ 0xcafebabe) * 2 - 1, // X jitter -1..1
    y: hash((seed * 23) ^ 0xfeedface) * 2 - 1, // Y jitter -1..1
    s: hash((seed * 31) ^ 0xbaadf00d),        // scale variation 0..1
  };
});

const DEFAULTS = {
  text: 'Hello World',
  fontSize: 1,
  fontFamily: 'Impact',
  fontVariant: '900 normal',
  strokeWidth: 0.05,
  delayTaps: 0,
  delayTime: 0.3,
  delayScaleFalloff: 0.15,
  delayOpacityFalloff: 0.25,
  pingPongEnabled: false,
  pingPongWidth: 0.3,
  heightLegato: false,
  heightLegatoSpeed: 4,
  heightAmount: 0.35,
  opacity: 1,
  color: '#ffffff',
  strokeColor: '',
  reverbEnabled: false,
  reverbReflections: 12,
  reverbDecay: 1.5,
  reverbSpread: 0.15,
  wallEnabled: false,
  wallAnimateDuration: 0.5,
  wallThreshold: 10,
  wallClearDuration: 0.6,
  wallScaleVariation: 0.3,
  wallRotationMax: 15,
  flightEnabled: false,
  flightSpeed: 15,
  flightMaxDepth: 50,
  flightDrift: 0.3,
  flightTumble: 0.5,
  flightSubdivRate: 8,
  rainbowEnabled: false,
  rainbowCycleLength: 12,
};

// Pre-generated deterministic wall slot positions (seeded per slot index)
const WALL_SLOTS = Array.from({ length: MAX_WALL_SLOTS }, (_, i) => {
  const seed = (i + 1) * 2654435761;
  const hash = (n: number) => ((n >>> 0) & 0x7fffffff) / 0x7fffffff;
  return {
    x: hash((seed * 37) ^ 0xdeadbeef) * 0.8 - 0.4,   // -0.4..0.4
    y: hash((seed * 41) ^ 0xcafebabe) * 0.7 - 0.35,   // -0.35..0.35
    rot: hash((seed * 53) ^ 0xfeedface) * 2 - 1,       // -1..1 (scaled by wallRotationMax)
    scale: hash((seed * 59) ^ 0xbaadf00d) * 2 - 1,     // -1..1 (scaled by wallScaleVariation)
    entryAngle: hash((seed * 67) ^ 0xdeadc0de) * Math.PI * 2, // 0..2π
  };
});

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number) => t * t * t;

interface WallEntry {
  word: string;
  triggerTime: number;
  slotIndex: number;
}

interface WordHistoryEntry {
  word: string;
  triggerTime: number;
  duration: number; // seconds the note was held
  yOffset: number;  // normalized Y offset at trigger time (-1 to 1)
}

const MAX_FLIGHT_SPRITES = 128;

interface FlightSprite {
  mesh: THREE.Mesh;
  texture: THREE.CanvasTexture;
  birthTime: number;
  vx: number;
  vy: number;
  tumbleX: number;
  tumbleY: number;
  targetScale: number;
  word: string;
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const TEXT_CANVAS_SIZE = 1024;

// Shared canvas cache keyed by (word, canvasSize, strokeWidth, fontFamily, color)
const canvasCache = new Map<string, HTMLCanvasElement>();
const CANVAS_CACHE_MAX = 64;

function createTextCanvas(
  word: string,
  canvasSize: number,
  strokeWidth: number,
  fontFamily: string = DEFAULTS.fontFamily,
  color: string = DEFAULTS.color,
  fontVariant: string = DEFAULTS.fontVariant,
  strokeColor: string = DEFAULTS.strokeColor,
): HTMLCanvasElement {
  // Include font-ready status in cache key so fallback-rendered canvases
  // get replaced once the real font finishes loading
  const fontReady = isFontReady(fontFamily, fontVariant);
  const key = `${word}|${canvasSize}|${strokeWidth}|${fontFamily}|${color}|${fontVariant}|${fontReady}|${strokeColor}`;
  const cached = canvasCache.get(key);
  if (cached) return cached;

  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = canvasSize * dpr;
  canvas.height = canvasSize * dpr;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(dpr, dpr);

  // Parse variant string: "weight style" e.g. "900 normal", "700 italic"
  const [weight, style] = fontVariant.split(' ');
  let fontSize = canvasSize * 0.35;
  const fontStr = (size: number) => `${style === 'italic' ? 'italic ' : ''}${weight} ${size}px "${fontFamily}", "Arial Black", sans-serif`;
  ctx.font = fontStr(fontSize);

  // Shrink font if text is wider than canvas (with padding for stroke)
  const maxWidth = canvasSize * 0.9;
  const measured = ctx.measureText(word);
  if (measured.width > maxWidth) {
    fontSize *= maxWidth / measured.width;
    ctx.font = fontStr(fontSize);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const sw = Math.max(1, strokeWidth * fontSize);
  ctx.lineWidth = sw;
  // Use explicit stroke color if provided, otherwise auto-pick contrast
  if (strokeColor) {
    ctx.strokeStyle = strokeColor;
  } else {
    ctx.fillStyle = color;
    const tmp = ctx.fillStyle; // browser-parsed hex
    const r = parseInt(tmp.slice(1, 3), 16);
    const g = parseInt(tmp.slice(3, 5), 16);
    const b = parseInt(tmp.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    ctx.strokeStyle = luminance > 0.5 ? 'black' : 'white';
  }
  ctx.lineJoin = 'round';
  const cx = canvasSize / 2;
  const cy = canvasSize / 2;
  ctx.strokeText(word, cx, cy);

  ctx.fillStyle = color;
  ctx.fillText(word, cx, cy);

  // Evict oldest entries if cache is full
  if (canvasCache.size >= CANVAS_CACHE_MAX) {
    const firstKey = canvasCache.keys().next().value!;
    canvasCache.delete(firstKey);
  }
  canvasCache.set(key, canvas);

  return canvas;
}

function TextDisplayVisual({ trackId }: { trackId: string }) {
  const engineRef = useRef(getVisualPlaybackEngine());
  const meshRef = useRef<THREE.Mesh>(null);
  const prevCountRef = useRef(0);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const lastWordRef = useRef('');
  const lastStrokeRef = useRef(-1);
  const lastFontRef = useRef('');
  const lastColorRef = useRef('');
  const lastStrokeColorRef = useRef('');
  const lastVariantRef = useRef('');
  const lastFontReadyRef = useRef(false);
  const noteOnTimeRef = useRef(-1); // clock time when current note started
  const currentYOffsetRef = useRef(0); // current height offset (-1 to 1)
  const targetYOffsetRef = useRef(0); // legato target
  const lastFrameTimeRef = useRef(0);
  const { viewport } = useThree();
  const [ready, setReady] = useState(false);

  // Delay echo state — each trigger spawns its own set of echoes
  const wordHistoryRef = useRef<WordHistoryEntry[]>([]);
  const echoMeshesRef = useRef<THREE.Mesh[]>([]);
  const echoTexturesRef = useRef<THREE.CanvasTexture[]>([]);
  const echoLastWordsRef = useRef<string[]>([]);
  const groupRef = useRef<THREE.Group>(null);

  // Reverb reflection state
  const reverbMeshesRef = useRef<THREE.Mesh[]>([]);
  const reverbTexturesRef = useRef<THREE.CanvasTexture[]>([]);
  const reverbLastWordsRef = useRef<string[]>([]);

  // Wall mode state
  const wallMeshesRef = useRef<THREE.Mesh[]>([]);
  const wallTexturesRef = useRef<THREE.CanvasTexture[]>([]);
  const wallLastWordsRef = useRef<string[]>([]);
  const wallEntriesRef = useRef<WallEntry[]>([]);
  const wallPageRef = useRef(0);
  const wallClearStartRef = useRef(-1);
  const lastRenderKeyRef = useRef('');

  // Flight mode state
  const flightSpritesRef = useRef<FlightSprite[]>([]);
  const flightLastSubdivRef = useRef(-1);

  useEffect(() => {
    const tex = new THREE.CanvasTexture(createTextCanvas('Hello', TEXT_CANVAS_SIZE, DEFAULTS.strokeWidth));
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    textureRef.current = tex;
    lastWordRef.current = 'Hello';
    lastStrokeRef.current = DEFAULTS.strokeWidth;

    // Pre-create one mesh per tap slot
    const meshes: THREE.Mesh[] = [];
    const textures: THREE.CanvasTexture[] = [];
    const lastWords: string[] = [];
    for (let i = 0; i < MAX_DELAY_TAPS; i++) {
      const echoTex = new THREE.CanvasTexture(createTextCanvas('', TEXT_CANVAS_SIZE, DEFAULTS.strokeWidth));
      echoTex.minFilter = THREE.LinearFilter;
      echoTex.magFilter = THREE.LinearFilter;
      textures.push(echoTex);
      lastWords.push('');

      const mat = new THREE.MeshBasicMaterial({
        map: echoTex,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.visible = false;
      meshes.push(mesh);
    }
    echoMeshesRef.current = meshes;
    echoTexturesRef.current = textures;
    echoLastWordsRef.current = lastWords;

    // Pre-create reverb reflection meshes
    const reverbMeshes: THREE.Mesh[] = [];
    const reverbTextures: THREE.CanvasTexture[] = [];
    const reverbLastWords: string[] = [];
    for (let i = 0; i < MAX_REVERB_REFLECTIONS; i++) {
      const rTex = new THREE.CanvasTexture(createTextCanvas('', TEXT_CANVAS_SIZE, DEFAULTS.strokeWidth));
      rTex.minFilter = THREE.LinearFilter;
      rTex.magFilter = THREE.LinearFilter;
      reverbTextures.push(rTex);
      reverbLastWords.push('');

      const rMat = new THREE.MeshBasicMaterial({
        map: rTex,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      });
      const rMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), rMat);
      rMesh.visible = false;
      reverbMeshes.push(rMesh);
    }
    reverbMeshesRef.current = reverbMeshes;
    reverbTexturesRef.current = reverbTextures;
    reverbLastWordsRef.current = reverbLastWords;

    // Pre-create wall meshes
    const wallMeshes: THREE.Mesh[] = [];
    const wallTextures: THREE.CanvasTexture[] = [];
    const wallLastWords: string[] = [];
    for (let i = 0; i < MAX_WALL_SLOTS; i++) {
      const wTex = new THREE.CanvasTexture(createTextCanvas('', TEXT_CANVAS_SIZE, DEFAULTS.strokeWidth));
      wTex.minFilter = THREE.LinearFilter;
      wTex.magFilter = THREE.LinearFilter;
      wallTextures.push(wTex);
      wallLastWords.push('');

      const wMat = new THREE.MeshBasicMaterial({
        map: wTex,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      });
      const wMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), wMat);
      wMesh.visible = false;
      wallMeshes.push(wMesh);
    }
    wallMeshesRef.current = wallMeshes;
    wallTexturesRef.current = wallTextures;
    wallLastWordsRef.current = wallLastWords;

    setReady(true);
    return () => {
      tex.dispose();
      for (const t of textures) t.dispose();
      for (const m of meshes) {
        (m.material as THREE.Material).dispose();
        m.geometry.dispose();
      }
      for (const t of reverbTextures) t.dispose();
      for (const m of reverbMeshes) {
        (m.material as THREE.Material).dispose();
        m.geometry.dispose();
      }
      for (const t of wallTextures) t.dispose();
      for (const m of wallMeshes) {
        (m.material as THREE.Material).dispose();
        m.geometry.dispose();
      }
      for (const spr of flightSpritesRef.current) {
        spr.texture.dispose();
        (spr.mesh.material as THREE.Material).dispose();
        spr.mesh.geometry.dispose();
      }
      flightSpritesRef.current = [];
    };
  }, []);

  // Add echo meshes to the group once ready
  useEffect(() => {
    if (!ready || !groupRef.current) return;
    for (const mesh of echoMeshesRef.current) {
      groupRef.current.add(mesh);
    }
    for (const mesh of reverbMeshesRef.current) {
      groupRef.current.add(mesh);
    }
    for (const mesh of wallMeshesRef.current) {
      groupRef.current.add(mesh);
    }
    return () => {
      for (const mesh of echoMeshesRef.current) {
        groupRef.current?.remove(mesh);
      }
      for (const mesh of reverbMeshesRef.current) {
        groupRef.current?.remove(mesh);
      }
      for (const mesh of wallMeshesRef.current) {
        groupRef.current?.remove(mesh);
      }
    };
  }, [ready]);

  useFrame(({ clock }) => {
    const state = engineRef.current.getTrackState(trackId);
    if (!state || !textureRef.current || !meshRef.current) return;

    const text = (state.params.text as string) ?? DEFAULTS.text;
    const fontSize = (state.params.fontSize as number) ?? DEFAULTS.fontSize;
    const fontFamily = (state.params.fontFamily as string) ?? DEFAULTS.fontFamily;
    const fontVariant = (state.params.fontVariant as string) ?? DEFAULTS.fontVariant;
    loadFont(fontFamily);
    const strokeWidth = (state.params.strokeWidth as number) ?? DEFAULTS.strokeWidth;
    const delayTaps = (state.params.delayTaps as number) ?? DEFAULTS.delayTaps;
    const delayTime = (state.params.delayTime as number) ?? DEFAULTS.delayTime;
    const delayScaleFalloff = (state.params.delayScaleFalloff as number) ?? DEFAULTS.delayScaleFalloff;
    const delayOpacityFalloff = (state.params.delayOpacityFalloff as number) ?? DEFAULTS.delayOpacityFalloff;
    const pingPongEnabled = (state.params.pingPongEnabled as boolean) ?? DEFAULTS.pingPongEnabled;
    const pingPongWidth = (state.params.pingPongWidth as number) ?? DEFAULTS.pingPongWidth;
    const heightLegato = (state.params.heightLegato as boolean) ?? DEFAULTS.heightLegato;
    const heightLegatoSpeed = (state.params.heightLegatoSpeed as number) ?? DEFAULTS.heightLegatoSpeed;
    const heightAmount = (state.params.heightAmount as number) ?? DEFAULTS.heightAmount;
    const textOpacity = (state.params.opacity as number) ?? DEFAULTS.opacity;
    const color = (state.params.color as string) ?? DEFAULTS.color;
    const strokeColor = (state.params.strokeColor as string) ?? DEFAULTS.strokeColor;
    const reverbEnabled = (state.params.reverbEnabled as boolean) ?? DEFAULTS.reverbEnabled;
    const reverbReflections = (state.params.reverbReflections as number) ?? DEFAULTS.reverbReflections;
    const reverbDecay = (state.params.reverbDecay as number) ?? DEFAULTS.reverbDecay;
    const reverbSpread = (state.params.reverbSpread as number) ?? DEFAULTS.reverbSpread;
    const wallEnabled = (state.params.wallEnabled as boolean) ?? DEFAULTS.wallEnabled;
    const wallAnimateDuration = (state.params.wallAnimateDuration as number) ?? DEFAULTS.wallAnimateDuration;
    const wallThreshold = (state.params.wallThreshold as number) ?? DEFAULTS.wallThreshold;
    const wallClearDuration = (state.params.wallClearDuration as number) ?? DEFAULTS.wallClearDuration;
    const wallScaleVariation = (state.params.wallScaleVariation as number) ?? DEFAULTS.wallScaleVariation;
    const wallRotationMax = (state.params.wallRotationMax as number) ?? DEFAULTS.wallRotationMax;
    const flightEnabled = (state.params.flightEnabled as boolean) ?? DEFAULTS.flightEnabled;
    const flightSpeed = (state.params.flightSpeed as number) ?? DEFAULTS.flightSpeed;
    const flightMaxDepth = (state.params.flightMaxDepth as number) ?? DEFAULTS.flightMaxDepth;
    const flightDrift = (state.params.flightDrift as number) ?? DEFAULTS.flightDrift;
    const flightTumble = (state.params.flightTumble as number) ?? DEFAULTS.flightTumble;
    const flightSubdivRate = (state.params.flightSubdivRate as number) ?? DEFAULTS.flightSubdivRate;
    const rainbowEnabled = (state.params.rainbowEnabled as boolean) ?? DEFAULTS.rainbowEnabled;
    const rainbowCycleLength = (state.params.rainbowCycleLength as number) ?? DEFAULTS.rainbowCycleLength;

    const currentBeat = useUIStore.getState().currentBeat;

    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return;

    const now = clock.getElapsedTime();

    // Detect new word triggers
    const currentCount = state.pitchNoteOnCounts.get(PITCH_NEXT_WORD) ?? 0;

    // Compute effective color — rainbow cycles hue based on subdivision ticks
    const rainbowSubdiv = Math.floor(currentBeat * flightSubdivRate);
    const rainbowHue = rainbowEnabled
      ? ((rainbowSubdiv % rainbowCycleLength) / rainbowCycleLength) * 360
      : 0;
    const effectiveColor = rainbowEnabled ? hslToHex(rainbowHue, 1, 0.55) : color;

    // Build a render key from all visual params — when any change, force
    // echo/reverb/wall textures to re-render (not just on word change)
    const fontReady = isFontReady(fontFamily, fontVariant);
    const renderKey = `${strokeWidth}|${fontFamily}|${effectiveColor}|${fontVariant}|${fontReady}|${strokeColor}`;

    // When visual params change, invalidate all echo/reverb/wall caches
    // so they re-render with the new stroke/color/font on next use
    if (renderKey !== lastRenderKeyRef.current) {
      lastRenderKeyRef.current = renderKey;
      echoLastWordsRef.current.fill('');
      reverbLastWordsRef.current.fill('');
      wallLastWordsRef.current.fill('');
    }
    const wordIndex = currentCount > 0 ? (currentCount - 1) % words.length : 0;
    const currentWord = words[wordIndex];

    const isNoteHeld = state.activeNotes.has(PITCH_NEXT_WORD);

    // Compute current height offset from latest held height pitch
    const dt = now - lastFrameTimeRef.current;
    lastFrameTimeRef.current = now;

    let latestHeightPitch = -1;
    for (const pitch of state.activeNotes.keys()) {
      if (pitch >= PITCH_HEIGHT_MIN && pitch <= PITCH_HEIGHT_MAX) {
        latestHeightPitch = Math.max(latestHeightPitch, pitch);
      }
    }
    if (latestHeightPitch >= 0) {
      const target = (latestHeightPitch - PITCH_HEIGHT_CENTER) / (PITCH_HEIGHT_MAX - PITCH_HEIGHT_CENTER);
      targetYOffsetRef.current = target;

      if (heightLegato && dt > 0 && dt < 0.5) {
        // Exponential lerp toward target
        const t = 1 - Math.exp(-heightLegatoSpeed * dt);
        currentYOffsetRef.current += (target - currentYOffsetRef.current) * t;
      } else {
        currentYOffsetRef.current = target;
      }
    }

    const isNewTrigger = currentCount !== prevCountRef.current && currentCount > 0;
    if (isNewTrigger) {
      wordHistoryRef.current.push({ word: currentWord, triggerTime: now, duration: 0, yOffset: currentYOffsetRef.current });
      noteOnTimeRef.current = now;
      prevCountRef.current = currentCount;
    }

    // Update duration of the latest entry while note is held
    const history = wordHistoryRef.current;
    if (isNoteHeld && history.length > 0 && noteOnTimeRef.current >= 0) {
      history[history.length - 1].duration = now - noteOnTimeRef.current;
    } else if (!isNoteHeld && noteOnTimeRef.current >= 0) {
      // Note released — finalize duration
      if (history.length > 0) {
        history[history.length - 1].duration = now - noteOnTimeRef.current;
      }
      noteOnTimeRef.current = -1;
    }

    // Prune old history entries whose echoes have fully expired
    const maxReverbLifetime = reverbEnabled ? reverbDecay + 5 : 0;
    const maxEchoLifetime = Math.max(delayTaps * delayTime + 10, maxReverbLifetime); // generous buffer
    wordHistoryRef.current = history.filter(
      (e) => now - e.triggerTime < maxEchoLifetime
    );

    const baseScale = Math.min(viewport.width, viewport.height) * 0.6 * fontSize;

    // --- Flight mode: spawn + update ---
    if (flightEnabled) {
      // Spawn continuously while note is held, on each beat subdivision
      const flightSubdiv = Math.floor(currentBeat * flightSubdivRate);
      if (flightSubdiv !== flightLastSubdivRef.current) {
        flightLastSubdivRef.current = flightSubdiv;
        if (isNoteHeld && groupRef.current && flightSpritesRef.current.length < MAX_FLIGHT_SPRITES) {
          const canvas = createTextCanvas(currentWord, TEXT_CANVAS_SIZE, strokeWidth, fontFamily, effectiveColor, fontVariant, strokeColor);
          const tex = new THREE.CanvasTexture(canvas);
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          const mat = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            opacity: textOpacity,
            side: THREE.DoubleSide,
            depthWrite: false,
            toneMapped: false,
          });
          const geo = new THREE.PlaneGeometry(1, 1);
          const mesh = new THREE.Mesh(geo, mat);
          const spawnY = currentYOffsetRef.current * viewport.height * heightAmount;
          mesh.position.set(0, spawnY, 0);
          mesh.scale.setScalar(baseScale);
          groupRef.current.add(mesh);

          const seed = flightSubdiv * 13 + 7;
          const pseudoRand = (n: number) => {
            const x = Math.sin(n * 9301 + 49297) * 233280;
            return x - Math.floor(x);
          };

          flightSpritesRef.current.push({
            mesh,
            texture: tex,
            birthTime: now,
            vx: (pseudoRand(seed) - 0.5) * flightDrift,
            vy: (pseudoRand(seed + 1) - 0.5) * flightDrift * 0.6,
            tumbleX: (pseudoRand(seed + 2) - 0.5) * flightTumble,
            tumbleY: (pseudoRand(seed + 3) - 0.5) * flightTumble,
            targetScale: baseScale,
            word: currentWord,
          });
        }
      }

      // Update flight sprites
      const flightDt = Math.min(dt, 0.05);
      const toRemove: number[] = [];
      for (let i = 0; i < flightSpritesRef.current.length; i++) {
        const spr = flightSpritesRef.current[i];
        const m = spr.mesh;

        m.position.z -= flightSpeed * flightDt;
        m.position.x += spr.vx * flightDt;
        m.position.y += spr.vy * flightDt;
        m.rotation.x += spr.tumbleX * flightDt;
        m.rotation.y += spr.tumbleY * flightDt;

        // Fade out near max depth
        const depth = -m.position.z;
        const fadeStart = flightMaxDepth * 0.7;
        const mat = m.material as THREE.MeshBasicMaterial;
        if (depth > fadeStart) {
          mat.opacity = textOpacity * Math.max(0, 1 - (depth - fadeStart) / (flightMaxDepth - fadeStart));
        } else {
          mat.opacity = textOpacity;
        }

        if (depth > flightMaxDepth) {
          toRemove.push(i);
        }
      }

      // Remove culled sprites
      for (let i = toRemove.length - 1; i >= 0; i--) {
        const idx = toRemove[i];
        const spr = flightSpritesRef.current[idx];
        groupRef.current?.remove(spr.mesh);
        spr.texture.dispose();
        (spr.mesh.material as THREE.Material).dispose();
        spr.mesh.geometry.dispose();
        flightSpritesRef.current.splice(idx, 1);
      }
    } else {
      // Clean up flight sprites when disabled
      if (flightSpritesRef.current.length > 0) {
        for (const spr of flightSpritesRef.current) {
          groupRef.current?.remove(spr.mesh);
          spr.texture.dispose();
          (spr.mesh.material as THREE.Material).dispose();
          spr.mesh.geometry.dispose();
        }
        flightSpritesRef.current = [];
      }
    }

    // --- Wall mode ---
    if (wallEnabled) {
      // Hide main mesh and all delay/reverb meshes
      meshRef.current.visible = false;
      for (let i = 0; i < MAX_DELAY_TAPS; i++) {
        const m = echoMeshesRef.current[i];
        if (m) m.visible = false;
      }
      for (let i = 0; i < MAX_REVERB_REFLECTIONS; i++) {
        const m = reverbMeshesRef.current[i];
        if (m) m.visible = false;
      }

      const wallEntries = wallEntriesRef.current;
      const isClearing = wallClearStartRef.current >= 0;
      const rotMaxRad = (wallRotationMax * Math.PI) / 180;
      const entryDistance = Math.max(viewport.width, viewport.height) * 0.8;

      // Handle new word trigger
      if (isNewTrigger) {
        if (isClearing) {
          // Still clearing — ignore until clear finishes
        } else if (wallEntries.length >= wallThreshold) {
          // Start clearing animation
          wallClearStartRef.current = now;
        } else {
          // Add new entry
          const slotIndex = wallEntries.length;
          wallEntries.push({ word: currentWord, triggerTime: now, slotIndex });
        }
      }

      // Handle clearing animation completion
      if (isClearing) {
        const clearT = Math.min((now - wallClearStartRef.current) / wallClearDuration, 1);
        if (clearT >= 1) {
          // Clear done — reset and add the triggering word as first entry
          wallEntriesRef.current = [{ word: currentWord, triggerTime: now, slotIndex: 0 }];
          wallPageRef.current++;
          wallClearStartRef.current = -1;
        }
      }

      // Animate wall meshes
      const currentEntries = wallEntriesRef.current;
      for (let i = 0; i < MAX_WALL_SLOTS; i++) {
        const wMesh = wallMeshesRef.current[i];
        if (!wMesh) continue;

        if (i >= currentEntries.length) {
          wMesh.visible = false;
          continue;
        }

        const entry = currentEntries[i];
        const slot = WALL_SLOTS[entry.slotIndex % MAX_WALL_SLOTS];

        // Update texture if needed
        const wTex = wallTexturesRef.current[i];
        if (entry.word !== wallLastWordsRef.current[i]) {
          const canvas = createTextCanvas(entry.word, TEXT_CANVAS_SIZE, strokeWidth, fontFamily, effectiveColor, fontVariant, strokeColor);
          wTex.image = canvas;
          wTex.needsUpdate = true;
          wallLastWordsRef.current[i] = entry.word;
        }

        // Target position/rotation/scale
        const targetX = slot.x * viewport.width;
        const targetY = slot.y * viewport.height;
        const targetRot = slot.rot * rotMaxRad;
        const targetScale = baseScale * (1 + slot.scale * wallScaleVariation);

        // Entry start position (off-screen along entry angle)
        const startX = Math.cos(slot.entryAngle) * entryDistance;
        const startY = Math.sin(slot.entryAngle) * entryDistance;

        if (wallClearStartRef.current >= 0) {
          // Scatter-out animation
          const clearT = easeInCubic(Math.min((now - wallClearStartRef.current) / wallClearDuration, 1));
          // Scatter direction: outward from center
          const scatterAngle = Math.atan2(targetY, targetX || 0.001);
          const scatterDist = entryDistance * 1.2;
          const scatterX = targetX + Math.cos(scatterAngle) * scatterDist * clearT;
          const scatterY = targetY + Math.sin(scatterAngle) * scatterDist * clearT;

          wMesh.position.set(scatterX, scatterY, -0.01 * i);
          wMesh.rotation.z = targetRot + clearT * Math.PI * 0.5;
          wMesh.scale.set(targetScale, targetScale, 1);
          const wMat = wMesh.material as THREE.MeshBasicMaterial;
          wMat.opacity = textOpacity * (1 - clearT);
          wMesh.visible = true;
        } else {
          // Fly-in animation
          const flyT = easeOutCubic(Math.min((now - entry.triggerTime) / wallAnimateDuration, 1));
          const posX = startX + (targetX - startX) * flyT;
          const posY = startY + (targetY - startY) * flyT;

          wMesh.position.set(posX, posY, -0.01 * i);
          wMesh.rotation.z = targetRot * flyT;
          wMesh.scale.set(targetScale * flyT || 0.001, targetScale * flyT || 0.001, 1);
          const wMat = wMesh.material as THREE.MeshBasicMaterial;
          wMat.opacity = textOpacity * flyT;
          wMesh.visible = true;
        }
      }
    } else {
      // --- Normal mode (non-wall) ---
      // Hide wall meshes
      for (let i = 0; i < MAX_WALL_SLOTS; i++) {
        const m = wallMeshesRef.current[i];
        if (m) m.visible = false;
      }
      // Reset wall state when wall mode is disabled
      wallEntriesRef.current = [];
      wallClearStartRef.current = -1;

      // Update main mesh texture
      if (currentWord !== lastWordRef.current || strokeWidth !== lastStrokeRef.current || fontFamily !== lastFontRef.current || effectiveColor !== lastColorRef.current || strokeColor !== lastStrokeColorRef.current || fontVariant !== lastVariantRef.current || fontReady !== lastFontReadyRef.current) {
        const canvas = createTextCanvas(currentWord, TEXT_CANVAS_SIZE, strokeWidth, fontFamily, effectiveColor, fontVariant, strokeColor);
        textureRef.current.image = canvas;
        textureRef.current.needsUpdate = true;
        lastWordRef.current = currentWord;
        lastStrokeRef.current = strokeWidth;
        lastFontRef.current = fontFamily;
        lastColorRef.current = effectiveColor;
        lastStrokeColorRef.current = strokeColor;
        lastVariantRef.current = fontVariant;
        lastFontReadyRef.current = fontReady;

      }

      // Main mesh visibility and opacity — only while note is held
      meshRef.current.visible = isNoteHeld;
      (meshRef.current.material as THREE.MeshBasicMaterial).opacity = textOpacity;

      meshRef.current.scale.set(baseScale, baseScale, 1);
      meshRef.current.position.y = currentYOffsetRef.current * viewport.height * heightAmount;

      for (let tap = 0; tap < MAX_DELAY_TAPS; tap++) {
        const mesh = echoMeshesRef.current[tap];
        if (!mesh) continue;

        if (tap >= delayTaps) {
          mesh.visible = false;
          continue;
        }

        const tapNum = tap + 1; // tap 1, 2, 3...
        const tapOffset = tapNum * delayTime;

        // Find the most recent trigger whose echo has arrived for this tap
        let bestEntry: WordHistoryEntry | null = null;
        let bestEchoAge = Infinity;
        for (let h = history.length - 1; h >= 0; h--) {
          const echoAge = now - (history[h].triggerTime + tapOffset);
          if (echoAge >= 0 && echoAge < bestEchoAge) {
            bestEntry = history[h];
            bestEchoAge = echoAge;
            break; // history is chronological, most recent match wins
          }
        }

        if (!bestEntry) {
          mesh.visible = false;
          continue;
        }

        // Echo is visible for the same duration as the original note was held
        const echoDuration = bestEntry.duration > 0 ? bestEntry.duration : delayTime;
        if (bestEchoAge > echoDuration) {
          mesh.visible = false;
          continue;
        }

        const tapOpacity = Math.max(0.01, 1 - delayOpacityFalloff * tapNum);
        const opacity = tapOpacity * textOpacity;

        // Update texture if word changed for this slot
        const tex = echoTexturesRef.current[tap];
        if (bestEntry.word !== echoLastWordsRef.current[tap]) {
          const canvas = createTextCanvas(bestEntry.word, TEXT_CANVAS_SIZE, strokeWidth, fontFamily, effectiveColor, fontVariant, strokeColor);
          tex.image = canvas;
          tex.needsUpdate = true;
          echoLastWordsRef.current[tap] = bestEntry.word;
        }

        const tapScale = baseScale * Math.max(0.1, 1 - delayScaleFalloff * tapNum);
        mesh.scale.set(tapScale, tapScale, 1);
        // Ping-pong: odd taps go left, even taps go right
        mesh.position.x = pingPongEnabled
          ? (tapNum % 2 === 1 ? -1 : 1) * pingPongWidth * viewport.width * 0.5
          : 0;
        mesh.position.y = bestEntry.yOffset * viewport.height * heightAmount;
        mesh.position.z = -0.01 * tapNum;

        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = opacity;
        mesh.visible = true;
      }

      // --- Reverb reflections ---
      for (let r = 0; r < MAX_REVERB_REFLECTIONS; r++) {
        const rMesh = reverbMeshesRef.current[r];
        if (!rMesh) continue;

        if (!reverbEnabled || r >= reverbReflections) {
          rMesh.visible = false;
          continue;
        }

        const offsets = REVERB_OFFSETS[r];
        const timeOffset = offsets.t * reverbDecay;
        const dx = offsets.x * reverbSpread * viewport.width;
        const dy = offsets.y * reverbSpread * viewport.height;

        // Find most recent word entry whose reverb reflection has arrived
        let bestEntry: WordHistoryEntry | null = null;
        let bestAge = Infinity;
        for (let h = history.length - 1; h >= 0; h--) {
          const age = now - (history[h].triggerTime + timeOffset);
          if (age >= 0 && age < bestAge) {
            bestEntry = history[h];
            bestAge = age;
            break;
          }
        }

        if (!bestEntry) {
          rMesh.visible = false;
          continue;
        }

        // Visible for same duration as original note was held
        const echoDuration = bestEntry.duration > 0 ? bestEntry.duration : reverbDecay;
        if (bestAge > echoDuration) {
          rMesh.visible = false;
          continue;
        }

        // Exponential opacity decay based on time offset
        const reverbOpacity = textOpacity * Math.exp(-3 * timeOffset / reverbDecay);

        // Update texture if word changed
        const rTex = reverbTexturesRef.current[r];
        if (bestEntry.word !== reverbLastWordsRef.current[r]) {
          const canvas = createTextCanvas(bestEntry.word, TEXT_CANVAS_SIZE, strokeWidth, fontFamily, effectiveColor, fontVariant, strokeColor);
          rTex.image = canvas;
          rTex.needsUpdate = true;
          reverbLastWordsRef.current[r] = bestEntry.word;
        }

        const reverbScale = baseScale * (1 - 0.1 * offsets.s);
        rMesh.scale.set(reverbScale, reverbScale, 1);
        rMesh.position.x = dx;
        rMesh.position.y = bestEntry.yOffset * viewport.height * heightAmount + dy;
        rMesh.position.z = -0.02 - 0.001 * r; // behind delay taps

        const rMat = rMesh.material as THREE.MeshBasicMaterial;
        rMat.opacity = reverbOpacity;
        rMesh.visible = true;
      }
    }
  });

  if (!ready) return null;

  return (
    <group ref={groupRef}>
      <mesh ref={meshRef}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={textureRef.current}
          transparent
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

export const TextDisplay: Instrument = {
  id: 'textDisplay',
  name: 'Text Display',
  description: 'Displays text words one at a time, advancing on each MIDI note',
  icon: '𝐓',
  color: '#ffffff',
  hasAudio: false,
  hasVisual: true,
  editorType: 'generic',
  noteRange: { min: 48, max: 72 },
  rangeLabels: [
    { startPitch: 48, endPitch: 48, label: 'Next Word' },
    { startPitch: 60, endPitch: 72, label: 'Height Offset' },
  ],

  defaultSettings: { ...DEFAULTS },

  settingsSchema: {
    text: {
      type: 'string', label: 'Text', default: DEFAULTS.text,
    },
    fontSize: {
      type: 'number', label: 'Font Size', min: 0.1, max: 5, step: 0.1,
      default: DEFAULTS.fontSize,
    },
    fontFamily: {
      type: 'font', label: 'Font Family',
      default: DEFAULTS.fontFamily,
    },
    fontVariant: {
      type: 'fontVariant', label: 'Font Style',
      default: DEFAULTS.fontVariant,
    },
    strokeWidth: {
      type: 'number', label: 'Stroke Width', min: 0, max: 0.2, step: 0.01,
      default: DEFAULTS.strokeWidth,
    },
    delayTaps: {
      type: 'number', label: 'Delay Taps', min: 0, max: MAX_DELAY_TAPS, step: 1,
      default: DEFAULTS.delayTaps,
    },
    delayTime: {
      type: 'number', label: 'Delay Time', min: 0.05, max: 2, step: 0.05,
      default: DEFAULTS.delayTime,
    },
    delayScaleFalloff: {
      type: 'number', label: 'Delay Scale Falloff', min: 0, max: 0.5, step: 0.02,
      default: DEFAULTS.delayScaleFalloff,
    },
    delayOpacityFalloff: {
      type: 'number', label: 'Delay Opacity Falloff', min: 0, max: 0.5, step: 0.02,
      default: DEFAULTS.delayOpacityFalloff,
    },
    pingPongEnabled: {
      type: 'boolean', label: 'Ping Pong Delay', default: DEFAULTS.pingPongEnabled,
    },
    pingPongWidth: {
      type: 'number', label: 'Ping Pong Width', min: 0.05, max: 1, step: 0.05,
      default: DEFAULTS.pingPongWidth,
    },
    opacity: {
      type: 'number', label: 'Opacity', min: 0, max: 1, step: 0.05,
      default: DEFAULTS.opacity,
    },
    color: {
      type: 'color', label: 'Color',
      default: DEFAULTS.color,
    },
    strokeColor: {
      type: 'color', label: 'Stroke Color',
      default: DEFAULTS.strokeColor,
    },
    heightAmount: {
      type: 'number', label: 'Height Amount', min: 0, max: 1, step: 0.05,
      default: DEFAULTS.heightAmount,
    },
    heightLegato: {
      type: 'boolean', label: 'Height Legato', default: DEFAULTS.heightLegato,
    },
    heightLegatoSpeed: {
      type: 'number', label: 'Legato Speed', min: 0.5, max: 20, step: 0.5,
      default: DEFAULTS.heightLegatoSpeed,
    },
    reverbEnabled: {
      type: 'boolean', label: 'Reverb', default: DEFAULTS.reverbEnabled,
    },
    reverbReflections: {
      type: 'number', label: 'Reverb Reflections', min: 1, max: 16, step: 1,
      default: DEFAULTS.reverbReflections,
    },
    reverbDecay: {
      type: 'number', label: 'Reverb Decay', min: 0.1, max: 5, step: 0.1,
      default: DEFAULTS.reverbDecay,
    },
    reverbSpread: {
      type: 'number', label: 'Reverb Spread', min: 0, max: 0.5, step: 0.02,
      default: DEFAULTS.reverbSpread,
    },
    wallEnabled: {
      type: 'boolean', label: 'Wall Mode', default: DEFAULTS.wallEnabled,
    },
    wallAnimateDuration: {
      type: 'number', label: 'Wall Fly-In Duration', min: 0.1, max: 2, step: 0.05,
      default: DEFAULTS.wallAnimateDuration,
    },
    wallThreshold: {
      type: 'number', label: 'Wall Threshold', min: 1, max: 50, step: 1,
      default: DEFAULTS.wallThreshold,
    },
    wallClearDuration: {
      type: 'number', label: 'Wall Clear Duration', min: 0.1, max: 2, step: 0.05,
      default: DEFAULTS.wallClearDuration,
    },
    wallScaleVariation: {
      type: 'number', label: 'Wall Scale Variation', min: 0, max: 1, step: 0.05,
      default: DEFAULTS.wallScaleVariation,
    },
    wallRotationMax: {
      type: 'number', label: 'Wall Rotation Max (°)', min: 0, max: 45, step: 1,
      default: DEFAULTS.wallRotationMax,
    },
    flightEnabled: {
      type: 'boolean', label: 'Flight Mode', default: DEFAULTS.flightEnabled,
    },
    flightSpeed: {
      type: 'number', label: 'Flight Speed', min: 2, max: 60, step: 1,
      default: DEFAULTS.flightSpeed,
    },
    flightMaxDepth: {
      type: 'number', label: 'Flight Max Depth', min: 10, max: 200, step: 5,
      default: DEFAULTS.flightMaxDepth,
    },
    flightDrift: {
      type: 'number', label: 'Flight Drift', min: 0, max: 3, step: 0.1,
      default: DEFAULTS.flightDrift,
    },
    flightTumble: {
      type: 'number', label: 'Flight Tumble', min: 0, max: 5, step: 0.1,
      default: DEFAULTS.flightTumble,
    },
    flightSubdivRate: {
      type: 'number', label: 'Flight Spawns/Beat', min: 1, max: 32, step: 1,
      default: DEFAULTS.flightSubdivRate,
    },
    rainbowEnabled: {
      type: 'boolean', label: 'Rainbow', default: DEFAULTS.rainbowEnabled,
    },
    rainbowCycleLength: {
      type: 'number', label: 'Rainbow Cycle Length', min: 2, max: 64, step: 1,
      default: DEFAULTS.rainbowCycleLength,
    },
  },

  colorRoleMapping: [
    { role: 'text', param: 'color', type: 'hex' },
    { role: 'textStroke', param: 'strokeColor', type: 'hex' },
  ],

  VisualComponent: TextDisplayVisual,
};

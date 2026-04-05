'use client';

import { useRef, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getVisualPlaybackEngine } from '@daw/core/visualPlayback';
import { virtualClock } from '@daw/core/virtualClock';
import { useUIStore } from '@daw/stores/uiStore';
import { Instrument } from '../types';

// ── XP Luna color palette ──────────────────────────────────────────────────

const XP = {
  activeTitleA: '#0058ee',
  activeTitleB: '#3089ff',
  activeTitleC: '#0854c5',
  titleSheen: 'rgba(255,255,255,0.35)',
  windowFace: '#ECE9D8',
  windowBg: '#FFFFFF',
  windowBorder: '#0054E3',
  closeBtnA: '#c75050',
  closeBtnB: '#db7b7b',
  maxBtnA: '#3c73bd',
  maxBtnB: '#6da2e0',
  minBtnA: '#3c73bd',
  minBtnB: '#6da2e0',
  menuBg: '#ECE9D8',
  menuText: '#000000',
  shadow: 'rgba(0,0,0,0.35)',
  sidebarA: '#4481D8',
  sidebarB: '#A4C6F5',
};

// ── Pitch ranges ───────────────────────────────────────────────────────────

const WALLPAPER_PITCH_MIN = 24; // C1
const WALLPAPER_PITCH_MAX = 35; // B1
const WINDOW_PITCH_MIN = 36;    // C2
const WINDOW_PITCH_MAX = 59;    // B3
const ICON_PITCH_MIN = 60;      // C4
const ICON_PITCH_MAX = 71;      // B4
const SHAKE_PITCH = 72;         // C5

// ── Window & icon pools ────────────────────────────────────────────────────

type WindowType = 'notepad' | 'ie' | 'my-computer' | 'my-documents' | 'recycle-bin' | 'folder' | 'control-panel' | 'paint';

interface WindowPoolEntry {
  title: string;
  type: WindowType;
}

const WINDOW_POOL: WindowPoolEntry[] = [
  { title: 'Untitled - Notepad', type: 'notepad' },
  { title: 'Internet Explorer', type: 'ie' },
  { title: 'My Computer', type: 'my-computer' },
  { title: 'My Documents', type: 'my-documents' },
  { title: 'Recycle Bin', type: 'recycle-bin' },
  { title: 'New Folder', type: 'folder' },
  { title: 'Document.txt - Notepad', type: 'notepad' },
  { title: 'Control Panel', type: 'control-panel' },
  { title: 'readme.txt - Notepad', type: 'notepad' },
  { title: 'MSN.com - Internet Explorer', type: 'ie' },
  { title: 'Local Disk (C:)', type: 'my-computer' },
  { title: 'My Pictures', type: 'folder' },
  { title: 'untitled - Paint', type: 'paint' },
  { title: 'My Music', type: 'folder' },
];

type IconType = 'folder' | 'notepad' | 'my-computer' | 'ie' | 'recycle-bin' | 'my-documents';

interface IconDef {
  type: IconType;
  label: string;
}

const ICON_POOL: IconDef[] = [
  { type: 'folder', label: 'New Folder' },
  { type: 'notepad', label: 'readme.txt' },
  { type: 'my-computer', label: 'My Computer' },
  { type: 'ie', label: 'Internet Explorer' },
  { type: 'recycle-bin', label: 'Recycle Bin' },
  { type: 'my-documents', label: 'My Documents' },
  { type: 'folder', label: 'My Music' },
  { type: 'notepad', label: 'notes.txt' },
  { type: 'folder', label: 'My Pictures' },
  { type: 'my-computer', label: 'Network' },
  { type: 'ie', label: 'MSN.com' },
  { type: 'folder', label: 'Downloads' },
];

// ── Defaults ───────────────────────────────────────────────────────────────

const DEFAULTS = {
  driftSpeed: 800,
  windowMinW: 350,
  windowMaxW: 850,
  windowMinH: 250,
  windowMaxH: 600,
  springAnim: true,
  iconScale: 1.0,
  opacity: 1.0,
  spawnX: 0.66,
};

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const SPRING_DURATION = 380; // ms

// ── Wallpaper pool ─────────────────────────────────────────────────────────

const ARCHIVE_BASE = 'https://archive.org/download/windows-xp-desktop-backgrounds/windows-xp-desktop-background-wallpaper-';

interface WallpaperDef {
  name: string;
  url: string;
}

const WALLPAPER_POOL: WallpaperDef[] = [
  { name: 'Bliss', url: 'https://archive.org/download/bliss-600dpi/bliss-600dpi.png' },
  { name: 'Azul', url: `${ARCHIVE_BASE}azul-800x600.jpg.png` },
  { name: 'Autumn', url: `${ARCHIVE_BASE}autumn-800x600.jpg.png` },
  { name: 'Ascent', url: `${ARCHIVE_BASE}ascent-800x600.jpg.png` },
  { name: 'Wind', url: `${ARCHIVE_BASE}wind-800x600.jpg.png` },
  { name: 'Moon Flower', url: `${ARCHIVE_BASE}moon-flower-800x600.jpg.png` },
  { name: 'Purple Flower', url: `${ARCHIVE_BASE}purple-flower-800x600.jpg.png` },
  { name: 'Radiance', url: `${ARCHIVE_BASE}radiance-800x600.jpg.png` },
  { name: 'Peace', url: `${ARCHIVE_BASE}peace-800x600.jpg.png` },
  { name: 'Stonehenge', url: `${ARCHIVE_BASE}stonehenge-800x600.jpg.png` },
  { name: 'Red Moon Desert', url: `${ARCHIVE_BASE}red-moon-desert-800x600.jpg.png` },
  { name: 'Vortec Space', url: `${ARCHIVE_BASE}vortec-space-800x600.jpg.png` },
];

// ── Wallpaper image loader (lazy, caches all loaded images) ────────────────

const wallpaperCache = new Map<number, HTMLImageElement>();
const wallpaperLoading = new Set<number>();

function ensureWallpaperLoading(index: number) {
  if (wallpaperCache.has(index) || wallpaperLoading.has(index)) return;
  if (index < 0 || index >= WALLPAPER_POOL.length) return;
  wallpaperLoading.add(index);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    wallpaperCache.set(index, img);
    wallpaperLoading.delete(index);
  };
  img.onerror = () => {
    wallpaperLoading.delete(index);
  };
  img.src = WALLPAPER_POOL[index].url;
}

// ── Canvas2D helpers ───────────────────────────────────────────────────────

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  rtl: number, rtr: number, rbr: number, rbl: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + rtl, y);
  ctx.lineTo(x + w - rtr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rtr);
  ctx.lineTo(x + w, y + h - rbr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rbr, y + h);
  ctx.lineTo(x + rbl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rbl);
  ctx.lineTo(x, y + rtl);
  ctx.quadraticCurveTo(x, y, x + rtl, y);
  ctx.closePath();
}

function springEase(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const keyframes: [number, number][] = [
    [0, 0], [0.08, 0], [0.4, 1.12], [0.65, 0.95], [0.82, 1.04], [1.0, 1.0],
  ];
  for (let i = 0; i < keyframes.length - 1; i++) {
    const [t0, v0] = keyframes[i];
    const [t1, v1] = keyframes[i + 1];
    if (t >= t0 && t <= t1) {
      const frac = (t - t0) / (t1 - t0);
      const s = frac * frac * (3 - 2 * frac);
      return v0 + (v1 - v0) * s;
    }
  }
  return 1;
}

function seededRand(seed: number): number {
  let x = Math.sin(seed * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// ── Bliss wallpaper ────────────────────────────────────────────────────────

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, scrollX: number, wallpaperIndex: number) {
  const taskbarH = 36;
  const dh = h - taskbarH;

  const img = wallpaperCache.get(wallpaperIndex);
  if (img) {
    // Draw actual image, cover-fit to desktop area
    const imgAspect = img.width / img.height;
    const areaAspect = w / dh;
    let sw: number, sh: number, sx: number, sy: number;
    if (imgAspect > areaAspect) {
      sh = img.height;
      sw = sh * areaAspect;
      sx = (img.width - sw) / 2;
      sy = 0;
    } else {
      sw = img.width;
      sh = sw / areaAspect;
      sx = 0;
      sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, dh);
  } else {
    // Fallback: canvas-drawn Bliss recreation
    drawBlissFallback(ctx, w, dh, scrollX);
  }
}

function drawBlissFallback(ctx: CanvasRenderingContext2D, w: number, dh: number, scrollX: number) {
  // Sky
  const skyGrad = ctx.createLinearGradient(0, 0, 0, dh * 0.65);
  skyGrad.addColorStop(0, '#245EDC');
  skyGrad.addColorStop(0.4, '#3A8AEC');
  skyGrad.addColorStop(0.75, '#68B8F4');
  skyGrad.addColorStop(1, '#9CD4FC');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, w, dh);

  // Clouds
  ctx.globalAlpha = 0.6;
  const cloudData = [
    { cx: 0.15, cy: 0.12, rx: 140, ry: 35 },
    { cx: 0.45, cy: 0.08, rx: 180, ry: 40 },
    { cx: 0.75, cy: 0.18, rx: 120, ry: 30 },
    { cx: 0.95, cy: 0.1, rx: 100, ry: 28 },
    { cx: 0.3, cy: 0.22, rx: 90, ry: 25 },
  ];
  for (const c of cloudData) {
    const cx = ((c.cx * w + 200 - scrollX * 0.08) % (w + 500)) - 250;
    const cy = c.cy * dh;
    const cGrad = ctx.createRadialGradient(cx, cy - 5, 0, cx, cy, c.rx);
    cGrad.addColorStop(0, 'rgba(255,255,255,0.9)');
    cGrad.addColorStop(0.5, 'rgba(255,255,255,0.4)');
    cGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cGrad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, c.rx, c.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx - c.rx * 0.3, cy - c.ry * 0.5, c.rx * 0.5, c.ry * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + c.rx * 0.25, cy - c.ry * 0.3, c.rx * 0.4, c.ry * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Rolling green hills
  const hillBase = dh * 0.62;

  ctx.fillStyle = '#6FC454';
  ctx.beginPath();
  ctx.moveTo(0, dh);
  for (let x = 0; x <= w; x += 3) {
    const yy = hillBase + 20 + Math.sin((x + scrollX * 0.08) * 0.0025) * 50
      + Math.sin((x + scrollX * 0.08) * 0.007 + 2) * 18;
    ctx.lineTo(x, yy);
  }
  ctx.lineTo(w, dh); ctx.closePath(); ctx.fill();

  ctx.fillStyle = '#52B836';
  ctx.beginPath();
  ctx.moveTo(0, dh);
  for (let x = 0; x <= w; x += 3) {
    const yy = hillBase + 50 + Math.sin((x + scrollX * 0.16) * 0.003 + 1) * 40
      + Math.sin((x + scrollX * 0.16) * 0.01) * 14;
    ctx.lineTo(x, yy);
  }
  ctx.lineTo(w, dh); ctx.closePath(); ctx.fill();

  const nearGrad = ctx.createLinearGradient(0, hillBase + 60, 0, dh);
  nearGrad.addColorStop(0, '#44A828');
  nearGrad.addColorStop(1, '#2E8818');
  ctx.fillStyle = nearGrad;
  ctx.beginPath();
  ctx.moveTo(0, dh);
  for (let x = 0; x <= w; x += 3) {
    const yy = hillBase + 80 + Math.sin((x + scrollX * 0.28) * 0.004 + 3) * 30
      + Math.sin((x + scrollX * 0.28) * 0.013 + 1) * 12;
    ctx.lineTo(x, yy);
  }
  ctx.lineTo(w, dh); ctx.closePath(); ctx.fill();
}

// ── Desktop icons (static on wallpaper) ────────────────────────────────────

const DESKTOP_ICON_DEFS: { icon: IconType; label: string; col: number; row: number }[] = [
  { icon: 'my-computer', label: 'My Computer', col: 0, row: 0 },
  { icon: 'my-documents', label: 'My Documents', col: 0, row: 1 },
  { icon: 'recycle-bin', label: 'Recycle Bin', col: 0, row: 2 },
  { icon: 'ie', label: 'Internet Explorer', col: 0, row: 3 },
  { icon: 'notepad', label: 'Notepad', col: 0, row: 4 },
];

function drawDesktopIcons(ctx: CanvasRenderingContext2D) {
  const iconSize = 36;
  const startX = 16;
  const startY = 12;
  const colW = 80;
  const rowH = 76;

  for (const def of DESKTOP_ICON_DEFS) {
    const ix = startX + def.col * colW + (colW - iconSize) / 2;
    const iy = startY + def.row * rowH;

    ctx.save();
    drawFileIcon(ctx, ix, iy, def.icon, '', iconSize);

    // White text + dark shadow (desktop-style labels)
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '11px Tahoma, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 2;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    const maxLabelW = 70;
    let displayLabel = def.label;
    if (ctx.measureText(displayLabel).width > maxLabelW) {
      while (displayLabel.length > 3 && ctx.measureText(displayLabel + '...').width > maxLabelW) {
        displayLabel = displayLabel.slice(0, -1);
      }
      displayLabel += '...';
    }
    ctx.fillText(displayLabel, ix + iconSize / 2, iy + iconSize + 4);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.textAlign = 'left';
    ctx.restore();
  }
}

// ── Taskbar ────────────────────────────────────────────────────────────────

function drawTaskbar(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const taskbarH = 36;
  const ty = h - taskbarH;

  ctx.fillStyle = '#6CB5F8';
  ctx.fillRect(0, ty, w, 2);

  const grad = ctx.createLinearGradient(0, ty + 2, 0, h);
  grad.addColorStop(0, '#3B8CF3');
  grad.addColorStop(0.02, '#56A0F5');
  grad.addColorStop(0.06, '#368CF0');
  grad.addColorStop(0.15, '#245EDC');
  grad.addColorStop(0.35, '#2054C8');
  grad.addColorStop(0.55, '#1E4DB8');
  grad.addColorStop(0.75, '#2258CC');
  grad.addColorStop(0.88, '#2E6EDD');
  grad.addColorStop(0.95, '#3D8CF0');
  grad.addColorStop(1, '#4A9BF5');
  ctx.fillStyle = grad;
  ctx.fillRect(0, ty + 2, w, taskbarH - 2);

  // Start button
  const btnW = 110;
  const sGrad = ctx.createLinearGradient(0, ty, 0, ty + taskbarH);
  sGrad.addColorStop(0, '#6FC06E');
  sGrad.addColorStop(0.03, '#5CB85B');
  sGrad.addColorStop(0.08, '#4AA64A');
  sGrad.addColorStop(0.18, '#388E3C');
  sGrad.addColorStop(0.35, '#2E7D32');
  sGrad.addColorStop(0.55, '#276C2A');
  sGrad.addColorStop(0.75, '#2E7D32');
  sGrad.addColorStop(0.88, '#3D9940');
  sGrad.addColorStop(0.95, '#52AD52');
  sGrad.addColorStop(1, '#62BF62');
  ctx.fillStyle = sGrad;
  roundedRect(ctx, 0, ty, btnW, taskbarH, 0, 8, 8, 0);
  ctx.fill();
  ctx.fillStyle = '#1A5010';
  ctx.fillRect(btnW - 1, ty, 1, taskbarH);

  // Windows flag (matching reference: red, blue, green, yellow quadrants)
  const flagX = 10;
  const flagY = ty + taskbarH / 2 - 7;
  const sq = 6;
  const gap = 1.5;
  ctx.fillStyle = '#FF0000';
  roundedRect(ctx, flagX, flagY, sq, sq, 0.5, 0.5, 0.5, 0.5);
  ctx.fill();
  ctx.fillStyle = '#00A2ED';
  roundedRect(ctx, flagX + sq + gap, flagY, sq, sq, 0.5, 0.5, 0.5, 0.5);
  ctx.fill();
  ctx.fillStyle = '#7CBB00';
  roundedRect(ctx, flagX, flagY + sq + gap, sq, sq, 0.5, 0.5, 0.5, 0.5);
  ctx.fill();
  ctx.fillStyle = '#FFB900';
  roundedRect(ctx, flagX + sq + gap, flagY + sq + gap, sq, sq, 0.5, 0.5, 0.5, 0.5);
  ctx.fill();

  // "start" text
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold italic 14px Tahoma, Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  ctx.fillText('start', 30, ty + taskbarH / 2 + 1);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Clock area
  const clockW = 80;
  const clockX = w - clockW - 4;
  ctx.fillStyle = 'rgba(0,50,150,0.3)';
  roundedRect(ctx, clockX - 4, ty + 4, clockW + 8, taskbarH - 8, 2, 2, 2, 2);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 12px Tahoma, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('12:00 AM', clockX + clockW / 2, ty + taskbarH / 2 + 1);
  ctx.textAlign = 'left';
}

// ── Unregistered HyperCam 2 watermark ──────────────────────────────────────

function drawWatermark(ctx: CanvasRenderingContext2D) {
  const text = 'Unregistered HyperCam 2';
  ctx.font = 'bold 20px "MS Sans Serif", "Microsoft Sans Serif", "Segoe UI", Arial, sans-serif';
  const metrics = ctx.measureText(text);
  const padX = 6;
  const padTop = 3;
  const padBot = 2;
  const textH = 20;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, metrics.width + padX * 2, textH + padTop + padBot);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(text, padX, padTop);
}

// ── Title bar drawing ──────────────────────────────────────────────────────

function drawTitleBar(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, width: number, title: string, type: WindowType,
) {
  const barH = 30;

  const grad = ctx.createLinearGradient(x, y, x, y + barH);
  grad.addColorStop(0, XP.activeTitleA);
  grad.addColorStop(0.3, XP.activeTitleB);
  grad.addColorStop(0.5, XP.activeTitleA);
  grad.addColorStop(0.7, XP.activeTitleC);
  grad.addColorStop(1, XP.activeTitleA);
  ctx.fillStyle = grad;
  roundedRect(ctx, x, y, width, barH, 8, 8, 0, 0);
  ctx.fill();

  // Glossy sheen
  const sheen = ctx.createLinearGradient(x, y, x, y + barH * 0.5);
  sheen.addColorStop(0, 'rgba(255,255,255,0.3)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  roundedRect(ctx, x, y, width, barH * 0.5, 8, 8, 0, 0);
  ctx.fill();

  // Mini icon
  drawMiniIcon(ctx, x + 8, y + 8, 14, type);

  // Title text
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 13px Tahoma, Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  const maxTextW = width - 120;
  let displayTitle = title;
  if (ctx.measureText(displayTitle).width > maxTextW) {
    while (displayTitle.length > 3 && ctx.measureText(displayTitle + '...').width > maxTextW) {
      displayTitle = displayTitle.slice(0, -1);
    }
    displayTitle += '...';
  }
  ctx.fillText(displayTitle, x + 28, y + barH / 2 + 1);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Control buttons
  const btnW = 21;
  const btnH = 21;
  const btnY = y + 5;
  const btnGap = 2;
  const closeX = x + width - btnW - 6;
  drawControlButton(ctx, closeX, btnY, btnW, btnH, XP.closeBtnA, XP.closeBtnB, 'close');
  const maxX = closeX - btnW - btnGap;
  drawControlButton(ctx, maxX, btnY, btnW, btnH, XP.maxBtnA, XP.maxBtnB, 'max');
  const minX = maxX - btnW - btnGap;
  drawControlButton(ctx, minX, btnY, btnW, btnH, XP.minBtnA, XP.minBtnB, 'min');
}

function drawControlButton(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  colorA: string, colorB: string, glyph: 'close' | 'max' | 'min',
) {
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, colorB);
  grad.addColorStop(0.5, colorA);
  grad.addColorStop(1, colorA);
  ctx.fillStyle = grad;
  roundedRect(ctx, x, y, w, h, 3, 3, 3, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  roundedRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 3, 3, 3, 3);
  ctx.stroke();

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (glyph === 'close') {
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy - 4); ctx.lineTo(cx + 4, cy + 4);
    ctx.moveTo(cx + 4, cy - 4); ctx.lineTo(cx - 4, cy + 4);
    ctx.stroke();
  } else if (glyph === 'max') {
    ctx.strokeRect(cx - 4, cy - 4, 8, 8);
  } else {
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy + 3); ctx.lineTo(cx + 4, cy + 3);
    ctx.stroke();
  }
}

function drawMiniIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, type: WindowType) {
  const s = size;
  if (type === 'notepad') {
    ctx.fillStyle = '#FFFFF0';
    ctx.fillRect(x + 2, y, s - 4, s);
    ctx.fillStyle = '#6699CC';
    ctx.fillRect(x + 2, y, s - 4, 3);
    ctx.strokeStyle = '#808080';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x + 2, y, s - 4, s);
  } else if (type === 'ie') {
    ctx.fillStyle = '#0078D7';
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s / 2, s / 2 - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${s - 4}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('e', x + s / 2, y + s / 2 + 1);
  } else if (type === 'my-computer' || type === 'control-panel') {
    ctx.fillStyle = '#7B7B7B';
    ctx.fillRect(x + 1, y + 1, s - 2, s - 5);
    ctx.fillStyle = '#3A6EA5';
    ctx.fillRect(x + 2, y + 2, s - 4, s - 7);
    ctx.fillStyle = '#7B7B7B';
    ctx.fillRect(x + s / 2 - 2, y + s - 4, 4, 3);
  } else if (type === 'recycle-bin') {
    ctx.fillStyle = '#C0C0C0';
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 3); ctx.lineTo(x + s - 2, y + 3);
    ctx.lineTo(x + s - 3, y + s); ctx.lineTo(x + 3, y + s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#A0A0A0';
    ctx.fillRect(x + 1, y + 1, s - 2, 3);
  } else if (type === 'paint') {
    ctx.fillStyle = '#FFFFF0';
    ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    ctx.fillStyle = '#FF0000'; ctx.fillRect(x + 3, y + 3, 3, 3);
    ctx.fillStyle = '#00FF00'; ctx.fillRect(x + 7, y + 3, 3, 3);
    ctx.fillStyle = '#0000FF'; ctx.fillRect(x + 3, y + 7, 3, 3);
    ctx.fillStyle = '#FFFF00'; ctx.fillRect(x + 7, y + 7, 3, 3);
  } else {
    // folder / my-documents
    ctx.fillStyle = '#F7D774';
    ctx.fillRect(x, y + 3, s, s - 3);
    ctx.fillStyle = '#D4A840';
    ctx.fillRect(x, y + 1, s * 0.45, 4);
  }
}

// ── Window body drawing ────────────────────────────────────────────────────

function drawWindowBody(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, width: number, height: number, type: WindowType,
) {
  ctx.fillStyle = XP.windowFace;
  ctx.fillRect(x, y, width, height);

  const menuH = 22;
  ctx.fillStyle = XP.menuBg;
  ctx.fillRect(x, y, width, menuH);
  ctx.fillStyle = XP.menuText;
  ctx.font = '12px Tahoma, Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const menus = getMenuLabels(type);
  let mx = x + 8;
  for (const label of menus) {
    ctx.fillText(label, mx, y + menuH / 2);
    mx += ctx.measureText(label).width + 16;
  }
  ctx.fillStyle = '#ACA899';
  ctx.fillRect(x, y + menuH, width, 1);

  const contentY = y + menuH + 1;
  const contentH = height - menuH - 1;

  if (type === 'notepad' || type === 'paint') {
    ctx.fillStyle = XP.windowBg;
    ctx.fillRect(x + 2, contentY, width - 4, contentH);
    if (type === 'notepad') {
      ctx.strokeStyle = '#E8E8E8';
      ctx.lineWidth = 1;
      for (let ly = contentY + 20; ly < contentY + contentH - 5; ly += 18) {
        ctx.beginPath();
        ctx.moveTo(x + 8, ly); ctx.lineTo(x + width - 8, ly);
        ctx.stroke();
      }
      ctx.fillStyle = '#000000';
      ctx.font = '13px Courier New, monospace';
      const lines = ['Hello World!', 'This is Windows XP.', 'Notepad is great.'];
      for (let i = 0; i < Math.min(lines.length, 3); i++) {
        ctx.fillText(lines[i], x + 8, contentY + 16 + i * 18);
      }
    }
  } else if (type === 'ie') {
    const toolH = 28;
    ctx.fillStyle = XP.windowFace;
    ctx.fillRect(x + 2, contentY, width - 4, toolH);
    ctx.fillStyle = '#ACA899';
    ctx.fillRect(x + 2, contentY + toolH, width - 4, 1);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x + 60, contentY + 4, width - 80, 20);
    ctx.strokeStyle = '#7F9DB9';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 60, contentY + 4, width - 80, 20);
    ctx.fillStyle = '#000000';
    ctx.font = '12px Tahoma, Arial, sans-serif';
    ctx.fillText('http://www.msn.com/', x + 64, contentY + 17);
    ctx.fillStyle = XP.windowBg;
    ctx.fillRect(x + 2, contentY + toolH + 1, width - 4, contentH - toolH - 1);
    ctx.fillStyle = '#808080';
    ctx.font = '14px Tahoma, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('The page cannot be displayed', x + width / 2, contentY + toolH + contentH / 3);
    ctx.textAlign = 'left';
  } else {
    const sideW = Math.min(180, width * 0.28);
    const sGrad = ctx.createLinearGradient(x, contentY, x + sideW, contentY);
    sGrad.addColorStop(0, XP.sidebarA);
    sGrad.addColorStop(1, XP.sidebarB);
    ctx.fillStyle = sGrad;
    ctx.fillRect(x + 2, contentY, sideW, contentH);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 12px Tahoma, Arial, sans-serif';
    ctx.fillText('System Tasks', x + 10, contentY + 20);
    ctx.font = '11px Tahoma, Arial, sans-serif';
    ctx.fillText('View system info', x + 14, contentY + 40);
    ctx.fillText('Add/Remove programs', x + 14, contentY + 56);
    ctx.fillStyle = XP.windowBg;
    ctx.fillRect(x + sideW + 2, contentY, width - sideW - 4, contentH);
    drawExplorerIcons(ctx, x + sideW + 16, contentY + 16, width - sideW - 32, type);
  }
}

function getMenuLabels(type: WindowType): string[] {
  switch (type) {
    case 'notepad': return ['File', 'Edit', 'Format', 'View', 'Help'];
    case 'ie': return ['File', 'Edit', 'View', 'Favorites', 'Tools', 'Help'];
    case 'paint': return ['File', 'Edit', 'View', 'Image', 'Colors', 'Help'];
    default: return ['File', 'Edit', 'View', 'Favorites', 'Tools', 'Help'];
  }
}

function drawExplorerIcons(
  ctx: CanvasRenderingContext2D, x: number, y: number, areaW: number, type: WindowType,
) {
  const iconSize = 32;
  const gap = 80;
  const perRow = Math.max(1, Math.floor(areaW / gap));
  let items: { icon: IconType; label: string }[];
  if (type === 'my-computer') {
    items = [
      { icon: 'folder', label: 'Local Disk (C:)' },
      { icon: 'folder', label: 'Local Disk (D:)' },
      { icon: 'folder', label: 'CD Drive (E:)' },
      { icon: 'my-computer', label: 'Control Panel' },
    ];
  } else if (type === 'control-panel') {
    items = [
      { icon: 'my-computer', label: 'Display' },
      { icon: 'my-computer', label: 'System' },
      { icon: 'my-computer', label: 'Network' },
      { icon: 'folder', label: 'Fonts' },
    ];
  } else if (type === 'recycle-bin') {
    items = [
      { icon: 'notepad', label: 'old_file.txt' },
      { icon: 'folder', label: 'Backup' },
    ];
  } else {
    items = [
      { icon: 'folder', label: 'My Pictures' },
      { icon: 'folder', label: 'My Music' },
      { icon: 'notepad', label: 'readme.txt' },
    ];
  }
  for (let i = 0; i < items.length; i++) {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const ix = x + col * gap;
    const iy = y + row * 60;
    drawFileIcon(ctx, ix + (gap - iconSize) / 2, iy, items[i].icon, items[i].label, iconSize);
  }
}

// ── Window frame + composite ───────────────────────────────────────────────

function drawWindowFrame(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  ctx.shadowColor = XP.shadow;
  ctx.shadowBlur = 12;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = XP.windowBorder;
  roundedRect(ctx, x, y, width, height, 8, 8, 4, 4);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function drawWindow(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  title: string, type: WindowType, springT: number,
) {
  const scale = springEase(Math.min(springT, 1));
  if (scale <= 0.001) return;
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);
  drawWindowFrame(ctx, x, y, w, h);
  const borderW = 3;
  drawTitleBar(ctx, x + borderW, y + borderW, w - borderW * 2, title, type);
  const titleH = 30;
  drawWindowBody(ctx, x + borderW, y + borderW + titleH, w - borderW * 2, h - borderW * 2 - titleH, type);
  ctx.restore();
}

// ── File icon drawing (matching reference SVGs) ────────────────────────────

function drawFileIcon(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, iconType: IconType, label: string, size: number,
) {
  const s = size;
  // Scale factor from 32x32 viewBox to actual size
  const sc = s / 32;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);

  if (iconType === 'folder') {
    // Folder tab
    ctx.fillStyle = '#F7D774';
    ctx.strokeStyle = '#D4A840';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(4, 10); ctx.lineTo(14, 10); ctx.lineTo(16, 7); ctx.lineTo(4, 7);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Folder body
    ctx.fillStyle = '#F7D774';
    ctx.strokeStyle = '#D4A840';
    roundedRect(ctx, 4, 10, 24, 16, 1, 1, 1, 1);
    ctx.fill(); ctx.stroke();
  } else if (iconType === 'notepad') {
    // Page
    ctx.fillStyle = '#FFFFF0';
    ctx.strokeStyle = '#808080';
    ctx.lineWidth = 0.5;
    roundedRect(ctx, 6, 3, 20, 26, 1, 1, 1, 1);
    ctx.fill(); ctx.stroke();
    // Blue header
    ctx.fillStyle = '#6699CC';
    ctx.strokeStyle = '#808080';
    roundedRect(ctx, 6, 3, 20, 4, 1, 1, 0, 0);
    ctx.fill(); ctx.stroke();
    // Lines
    ctx.strokeStyle = '#C0C0C0';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(9, 10 + i * 3); ctx.lineTo(23, 10 + i * 3);
      ctx.stroke();
    }
  } else if (iconType === 'my-computer') {
    // Monitor
    ctx.fillStyle = '#7B7B7B';
    ctx.strokeStyle = '#555555';
    ctx.lineWidth = 1;
    roundedRect(ctx, 3, 3, 26, 18, 1, 1, 1, 1);
    ctx.fill(); ctx.stroke();
    // Screen
    ctx.fillStyle = '#3A6EA5';
    ctx.fillRect(5, 5, 22, 14);
    // Darker screen inner
    ctx.fillStyle = '#0058A3';
    ctx.fillRect(6, 6, 20, 12);
    // Small triangle in screen
    ctx.fillStyle = '#89D0FF';
    ctx.beginPath();
    ctx.moveTo(16, 8); ctx.lineTo(18, 12); ctx.lineTo(14, 12);
    ctx.closePath();
    ctx.fill();
    // Stand
    ctx.fillStyle = '#7B7B7B';
    ctx.fillRect(12, 21, 8, 2);
    // Base
    ctx.fillStyle = '#B0B0B0';
    ctx.strokeStyle = '#888888';
    ctx.lineWidth = 0.5;
    roundedRect(ctx, 9, 23, 14, 3, 1, 1, 1, 1);
    ctx.fill(); ctx.stroke();
    // Power LED
    ctx.fillStyle = '#00C853';
    ctx.beginPath();
    ctx.arc(24, 19, 0.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (iconType === 'ie') {
    // Blue globe
    ctx.fillStyle = '#0078D7';
    ctx.beginPath();
    ctx.arc(16, 16, 13, 0, Math.PI * 2);
    ctx.fill();
    // Orbit ring
    ctx.save();
    ctx.translate(16, 16);
    ctx.rotate(-25 * Math.PI / 180);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 13, 6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // 'e' letter
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('e', 16, 17);
    ctx.textAlign = 'left';
  } else if (iconType === 'recycle-bin') {
    // Bin body
    ctx.fillStyle = '#C0C0C0';
    ctx.strokeStyle = '#808080';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(8, 10); ctx.lineTo(10, 28); ctx.lineTo(22, 28); ctx.lineTo(24, 10);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Lid
    ctx.fillStyle = '#A0A0A0';
    ctx.strokeStyle = '#808080';
    roundedRect(ctx, 7, 8, 18, 3, 1, 1, 1, 1);
    ctx.fill(); ctx.stroke();
    // Handle
    ctx.fillStyle = '#B0B0B0';
    ctx.strokeStyle = '#808080';
    roundedRect(ctx, 13, 5, 6, 4, 1, 1, 1, 1);
    ctx.fill(); ctx.stroke();
    // Slats
    ctx.strokeStyle = '#808080';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(13, 13); ctx.lineTo(13.5, 25);
    ctx.moveTo(16, 13); ctx.lineTo(16, 25);
    ctx.moveTo(19, 13); ctx.lineTo(18.5, 25);
    ctx.stroke();
  } else if (iconType === 'my-documents') {
    // Folder tab
    ctx.fillStyle = '#F7D774';
    ctx.strokeStyle = '#D4A840';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(4, 8); ctx.lineTo(14, 8); ctx.lineTo(16, 5); ctx.lineTo(4, 5);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Folder body
    roundedRect(ctx, 4, 8, 24, 19, 1, 1, 1, 1);
    ctx.fill(); ctx.stroke();
    // Paper inside
    ctx.fillStyle = '#FFF8DC';
    ctx.fillRect(6, 10, 20, 15);
    // Paper lines
    ctx.strokeStyle = '#CCC';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(8, 13); ctx.lineTo(24, 13);
    ctx.moveTo(8, 16); ctx.lineTo(24, 16);
    ctx.moveTo(8, 19); ctx.lineTo(20, 19);
    ctx.stroke();
  }

  ctx.restore();

  // Label text below icon
  if (label) {
    ctx.fillStyle = '#000000';
    ctx.font = '11px Tahoma, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const maxLabelW = Math.max(size, 60);
    let displayLabel = label;
    if (ctx.measureText(displayLabel).width > maxLabelW) {
      while (displayLabel.length > 3 && ctx.measureText(displayLabel + '...').width > maxLabelW) {
        displayLabel = displayLabel.slice(0, -1);
      }
      displayLabel += '...';
    }
    ctx.fillText(displayLabel, x + s / 2, y + s + 4);
    ctx.textAlign = 'left';
  }
}

// ── State types ────────────────────────────────────────────────────────────

interface SpawnedWindow {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  type: WindowType;
  title: string;
  birthOffset: number;
  spawnTime: number;
}

interface SpawnedSprite {
  id: number;
  x: number;
  y: number;
  iconType: IconType;
  label: string;
  birthOffset: number;
}

// ── Main component ─────────────────────────────────────────────────────────

function WindowsXPVisual({ trackId }: { trackId: string }) {
  const engineRef = useRef(getVisualPlaybackEngine());
  const meshRef = useRef<THREE.Mesh>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const { viewport } = useThree();
  const [ready, setReady] = useState(false);

  // State refs
  const windowsRef = useRef<SpawnedWindow[]>([]);
  const spritesRef = useRef<SpawnedSprite[]>([]);
  const posOffsetRef = useRef(0);
  const lastTimeRef = useRef(0);
  const lastNoteOnCountsRef = useRef(new Map<number, number>());
  const prevTotalNoteOnCountRef = useRef(0);
  const idCounterRef = useRef(0);
  const wallpaperIndexRef = useRef(0);
  const lastIconSubdivRef = useRef(-1); // tracks last 16th-note subdivision that spawned icons
  const shakeTimeRef = useRef(0); // remaining shake duration in ms

  useEffect(() => {
    // Start loading Bliss (default wallpaper)
    ensureWallpaperLoading(0);

    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    canvasRef.current = canvas;

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    textureRef.current = tex;
    setReady(true);

    return () => {
      tex.dispose();
    };
  }, []);

  useFrame(() => {
    const engine = engineRef.current;
    const state = engine.getTrackState(trackId);
    if (!state || !canvasRef.current || !textureRef.current || !meshRef.current) return;

    const ctx = canvasRef.current.getContext('2d')!;
    const params = state.params;

    const driftSpeed = (params.driftSpeed as number) ?? DEFAULTS.driftSpeed;
    const windowMinW = (params.windowMinW as number) ?? DEFAULTS.windowMinW;
    const windowMaxW = (params.windowMaxW as number) ?? DEFAULTS.windowMaxW;
    const windowMinH = (params.windowMinH as number) ?? DEFAULTS.windowMinH;
    const windowMaxH = (params.windowMaxH as number) ?? DEFAULTS.windowMaxH;
    const enableSpring = (params.springAnim as boolean) ?? DEFAULTS.springAnim;
    const iconScale = (params.iconScale as number) ?? DEFAULTS.iconScale;
    const opacity = (params.opacity as number) ?? DEFAULTS.opacity;
    const spawnX = (params.spawnX as number) ?? DEFAULTS.spawnX;

    // Time
    const now = virtualClock.now();
    const dt = lastTimeRef.current === 0 ? 0 : (now - lastTimeRef.current) / 1000;
    lastTimeRef.current = now;
    const clampedDt = Math.min(dt, 0.1);

    // Drift
    posOffsetRef.current += driftSpeed * clampedDt;

    // Seek detection
    let totalNoteOnCount = 0;
    for (const c of state.pitchNoteOnCounts.values()) totalNoteOnCount += c;
    if (totalNoteOnCount < prevTotalNoteOnCountRef.current) {
      windowsRef.current = [];
      spritesRef.current = [];
      posOffsetRef.current = 0;
      lastNoteOnCountsRef.current = new Map();
      lastIconSubdivRef.current = -1;
      shakeTimeRef.current = 0;
    }
    prevTotalNoteOnCountRef.current = totalNoteOnCount;

    // Wallpaper switching (C1-B1): most recent note-on selects wallpaper
    for (let pitch = WALLPAPER_PITCH_MIN; pitch <= WALLPAPER_PITCH_MAX; pitch++) {
      const currentCount = state.pitchNoteOnCounts.get(pitch) ?? 0;
      const prevCount = lastNoteOnCountsRef.current.get(pitch) ?? 0;
      if (currentCount > prevCount) {
        const idx = (pitch - WALLPAPER_PITCH_MIN) % WALLPAPER_POOL.length;
        wallpaperIndexRef.current = idx;
        ensureWallpaperLoading(idx);
      }
    }

    // Preload adjacent wallpapers for snappy switching
    const curWp = wallpaperIndexRef.current;
    if (curWp + 1 < WALLPAPER_POOL.length) ensureWallpaperLoading(curWp + 1);
    if (curWp - 1 >= 0) ensureWallpaperLoading(curWp - 1);

    // Spawn windows (C2-B3)
    for (let pitch = WINDOW_PITCH_MIN; pitch <= WINDOW_PITCH_MAX; pitch++) {
      const currentCount = state.pitchNoteOnCounts.get(pitch) ?? 0;
      const prevCount = lastNoteOnCountsRef.current.get(pitch) ?? 0;
      const newHits = currentCount - prevCount;
      if (newHits > 0) {
        for (let i = 0; i < Math.min(newHits, 3); i++) {
          const pitchNorm = (pitch - WINDOW_PITCH_MIN) / (WINDOW_PITCH_MAX - WINDOW_PITCH_MIN);
          const yNorm = 1 - pitchNorm;
          const yMargin = 40;
          const seed = idCounterRef.current * 7 + pitch;
          const w = windowMinW + seededRand(seed) * (windowMaxW - windowMinW);
          const h = windowMinH + seededRand(seed + 1) * (windowMaxH - windowMinH);
          const y = yMargin + yNorm * (CANVAS_H - h - yMargin * 2);
          const poolIndex = Math.floor(seededRand(seed + 2) * WINDOW_POOL.length);
          const poolEntry = WINDOW_POOL[poolIndex];
          windowsRef.current.push({
            id: idCounterRef.current++,
            x: CANVAS_W * spawnX,
            y,
            width: w,
            height: h,
            type: poolEntry.type,
            title: poolEntry.title,
            birthOffset: posOffsetRef.current,
            spawnTime: now,
          });
        }
      }
    }

    // Spawn file icon sprites (C4-B4) — 8 per beat while note is held
    const currentBeat = useUIStore.getState().currentBeat;
    const subdiv = Math.floor(currentBeat * 8); // current 8th-note subdivision
    if (subdiv !== lastIconSubdivRef.current) {
      lastIconSubdivRef.current = subdiv;
      for (let pitch = ICON_PITCH_MIN; pitch <= ICON_PITCH_MAX; pitch++) {
        if (state.activeNotes.has(pitch)) {
          const pitchNorm = (pitch - ICON_PITCH_MIN) / Math.max(1, ICON_PITCH_MAX - ICON_PITCH_MIN);
          const yNorm = 1 - pitchNorm;
          const iconDef = ICON_POOL[(pitch - ICON_PITCH_MIN) % ICON_POOL.length];
          const spriteSize = 72 * iconScale;
          const y = 40 + yNorm * (CANVAS_H - spriteSize - 100);
          spritesRef.current.push({
            id: idCounterRef.current++,
            x: CANVAS_W * spawnX,
            y,
            iconType: 'folder',
            label: ICON_POOL[Math.floor(seededRand(idCounterRef.current) * ICON_POOL.length)].label,
            birthOffset: posOffsetRef.current,
          });
        }
      }
    }

    // Shake trigger (C5)
    {
      const currentCount = state.pitchNoteOnCounts.get(SHAKE_PITCH) ?? 0;
      const prevCount = lastNoteOnCountsRef.current.get(SHAKE_PITCH) ?? 0;
      if (currentCount > prevCount) {
        shakeTimeRef.current = 400; // 400ms shake
      }
    }

    // Update lastNoteOnCounts
    lastNoteOnCountsRef.current = new Map(state.pitchNoteOnCounts);

    // Cull off-screen windows
    windowsRef.current = windowsRef.current.filter(win => {
      const screenX = win.x - (posOffsetRef.current - win.birthOffset);
      return screenX + win.width > -50;
    });

    // Cull off-screen sprites
    const spriteSize = 72 * iconScale;
    spritesRef.current = spritesRef.current.filter(spr => {
      const screenX = spr.x - (posOffsetRef.current - spr.birthOffset);
      return screenX + spriteSize > -80;
    });

    // ── Shake decay ──
    let shakeX = 0;
    let shakeY = 0;
    if (shakeTimeRef.current > 0) {
      shakeTimeRef.current = Math.max(0, shakeTimeRef.current - clampedDt * 1000);
      const intensity = (shakeTimeRef.current / 400) * 18; // max 18px offset, decays linearly
      shakeX = (Math.random() * 2 - 1) * intensity;
      shakeY = (Math.random() * 2 - 1) * intensity;
    }

    // ── Draw ──

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.globalAlpha = opacity;

    ctx.save();
    ctx.translate(shakeX, shakeY);

    // Background (actual wallpaper image or fallback)
    drawBackground(ctx, CANVAS_W, CANVAS_H, posOffsetRef.current, wallpaperIndexRef.current);

    // Desktop icons
    drawDesktopIcons(ctx);

    // Draw windows
    for (const win of windowsRef.current) {
      const screenX = win.x - (posOffsetRef.current - win.birthOffset);
      const elapsed = now - win.spawnTime;
      const springT = enableSpring ? elapsed / SPRING_DURATION : 1;
      drawWindow(ctx, screenX, win.y, win.width, win.height, win.title, win.type, springT);
    }

    // Taskbar
    drawTaskbar(ctx, CANVAS_W, CANVAS_H);

    // Draw drifting file icon sprites (on top of windows and taskbar)
    for (const spr of spritesRef.current) {
      const screenX = spr.x - (posOffsetRef.current - spr.birthOffset);
      drawFileIcon(ctx, screenX, spr.y, spr.iconType, spr.label, spriteSize);
    }

    // Watermark
    drawWatermark(ctx);

    ctx.restore(); // end shake translate

    ctx.globalAlpha = 1;

    // Update texture
    textureRef.current.needsUpdate = true;

    // Scale mesh to fill viewport
    const aspect = CANVAS_W / CANVAS_H;
    const vpAspect = viewport.width / viewport.height;
    if (vpAspect > aspect) {
      meshRef.current.scale.set(viewport.width, viewport.width / aspect, 1);
    } else {
      meshRef.current.scale.set(viewport.height * aspect, viewport.height, 1);
    }
  });

  if (!ready) return null;

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        map={textureRef.current}
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

// ── Instrument export ──────────────────────────────────────────────────────

export const WindowsXP: Instrument = {
  id: 'windowsXP',
  name: 'Windows XP',
  description: 'XP Luna desktop with beat-synced window spawning and drifting file icons',
  icon: '🪟',
  color: '#0831D9',
  hasAudio: false,
  hasVisual: true,
  disableBloom: true,
  editorType: 'generic',
  noteRange: { min: WALLPAPER_PITCH_MIN, max: SHAKE_PITCH },
  rangeLabels: [
    ...WALLPAPER_POOL.map((wp, i) => ({
      startPitch: WALLPAPER_PITCH_MIN + i,
      endPitch: WALLPAPER_PITCH_MIN + i,
      label: wp.name,
    })),
    { startPitch: WINDOW_PITCH_MIN, endPitch: WINDOW_PITCH_MAX, label: 'Windows' },
    { startPitch: ICON_PITCH_MIN, endPitch: ICON_PITCH_MAX, label: 'File Icons' },
    { startPitch: SHAKE_PITCH, endPitch: SHAKE_PITCH, label: 'Shake' },
  ],

  defaultSettings: { ...DEFAULTS },

  settingsSchema: {
    driftSpeed: {
      type: 'number', label: 'Drift Speed', min: 0, max: 3000, step: 50,
      default: DEFAULTS.driftSpeed,
    },
    windowMinW: {
      type: 'number', label: 'Window Min Width', min: 200, max: 800, step: 25,
      default: DEFAULTS.windowMinW,
    },
    windowMaxW: {
      type: 'number', label: 'Window Max Width', min: 400, max: 1200, step: 25,
      default: DEFAULTS.windowMaxW,
    },
    windowMinH: {
      type: 'number', label: 'Window Min Height', min: 150, max: 500, step: 25,
      default: DEFAULTS.windowMinH,
    },
    windowMaxH: {
      type: 'number', label: 'Window Max Height', min: 300, max: 900, step: 25,
      default: DEFAULTS.windowMaxH,
    },
    springAnim: {
      type: 'boolean', label: 'Spring Animation',
      default: DEFAULTS.springAnim,
    },
    iconScale: {
      type: 'number', label: 'Icon Scale', min: 0.5, max: 3, step: 0.1,
      default: DEFAULTS.iconScale,
    },
    opacity: {
      type: 'number', label: 'Opacity', min: 0, max: 1, step: 0.05,
      default: DEFAULTS.opacity,
    },
    spawnX: {
      type: 'number', label: 'Spawn X Position', min: 0, max: 1, step: 0.05,
      default: DEFAULTS.spawnX,
    },
  },

  VisualComponent: WindowsXPVisual,
};

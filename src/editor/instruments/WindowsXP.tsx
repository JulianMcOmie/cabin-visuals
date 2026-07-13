import { useRef, useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Mesh, CanvasTexture, LinearFilter, MeshBasicMaterial } from 'three'
import { useInstrumentFrame, seededRand } from '../core/visual/instrumentFrame'
import type { ObjectInstrumentDef, ParamDef } from './types'

// Ported from Excellent DAW. A procedurally-drawn Windows XP "Luna" desktop rendered to a
// full-frame canvas + CanvasTexture. MIDI notes drive it: low pitches (C1-B1) switch the
// desktop wallpaper tint, the C2-B3 band spawns drifting XP windows (Notepad, IE, My
// Computer, etc.), C4-B4 spits out drifting file-icon sprites while held, and C5 kicks off
// a screen shake. The window/desktop drawing + spawn/drift/spring math is Tyler's verbatim.
//
// Adaptation notes: Tyler loaded the real XP wallpaper bitmaps from archive.org URLs; those
// external images (and the IndexedDB/palette machinery) are dropped - everything is drawn
// procedurally, so drawBackground always uses the canvas-drawn "Bliss" fallback (sky +
// clouds + rolling green hills), tinted per wallpaper index. State reads are rewired to the
// pause invariant: no wall clock, no onset detection, no accumulated drift. Every frame is
// derived fresh from state.notes + state.beat - drift offset is driftSpeed * beat-seconds,
// windows/sprites/shake are enumerated from notes at/before the playhead with ages in
// beat-derived seconds, and per-entity "randomness" is seeded from note beat/pitch. A static
// playhead is a static frame; scrubbing in either direction is exact. seekGeneration is
// skipped (nothing accumulates, so there is nothing to reset).

// ── XP Luna color palette ──────────────────────────────────────────────────

const XP = {
  activeTitleA: '#0058ee',
  activeTitleB: '#3089ff',
  activeTitleC: '#0854c5',
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
}

// ── Pitch ranges ───────────────────────────────────────────────────────────

const WALLPAPER_PITCH_MIN = 24 // C1
const WALLPAPER_PITCH_MAX = 35 // B1
const WINDOW_PITCH_MIN = 36    // C2
const WINDOW_PITCH_MAX = 59    // B3
const ICON_PITCH_MIN = 60      // C4
const ICON_PITCH_MAX = 71      // B4
const SHAKE_PITCH = 72         // C5

// ── Window & icon pools ────────────────────────────────────────────────────

type WindowType = 'notepad' | 'ie' | 'my-computer' | 'my-documents' | 'recycle-bin' | 'folder' | 'control-panel' | 'paint'

interface WindowPoolEntry {
  title: string
  type: WindowType
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
]

type IconType = 'folder' | 'notepad' | 'my-computer' | 'ie' | 'recycle-bin' | 'my-documents'

interface IconDef {
  type: IconType
  label: string
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
]

// ── Constants ──────────────────────────────────────────────────────────────

const CANVAS_W = 1920
const CANVAS_H = 1080
const SPRING_DURATION = 380 // ms

// Procedural wallpaper "tints" - one per wallpaper pitch (C1-B1). Tyler loaded real XP
// bitmaps from archive.org; without those we draw the Bliss fallback and shift its sky/hill
// palette per index so different wallpaper pitches still visibly change the desktop.
interface WallpaperTint {
  name: string
  sky: [string, string, string, string]
  hillFar: string
  hillMid: string
  hillNearA: string
  hillNearB: string
}

const WALLPAPER_POOL: WallpaperTint[] = [
  { name: 'Bliss', sky: ['#245EDC', '#3A8AEC', '#68B8F4', '#9CD4FC'], hillFar: '#6FC454', hillMid: '#52B836', hillNearA: '#44A828', hillNearB: '#2E8818' },
  { name: 'Azul', sky: ['#0A2A6E', '#1147A8', '#2E7BD4', '#7FB6EE'], hillFar: '#2E6EA8', hillMid: '#1F5490', hillNearA: '#123C70', hillNearB: '#0A2A50' },
  { name: 'Autumn', sky: ['#7A3B10', '#B5641E', '#E0A24A', '#F5D48A'], hillFar: '#C4842E', hillMid: '#A5641F', hillNearA: '#7E4A16', hillNearB: '#5A3410' },
  { name: 'Ascent', sky: ['#1E4E9C', '#3A7BC8', '#7FB0E4', '#C4DCF4'], hillFar: '#8A7B5A', hillMid: '#6E5F42', hillNearA: '#524632', hillNearB: '#3A3222' },
  { name: 'Wind', sky: ['#2A5EA0', '#4A88C8', '#86B8E4', '#C8DEF0'], hillFar: '#7AA45A', hillMid: '#5E8442', hillNearA: '#466830', hillNearB: '#324A22' },
  { name: 'Moon Flower', sky: ['#3A1E6E', '#5E3AA0', '#9068D4', '#C4A8EE'], hillFar: '#6E4AA0', hillMid: '#543680', hillNearA: '#3E2860', hillNearB: '#2A1A44' },
  { name: 'Purple Flower', sky: ['#4E1E6E', '#7A3AA8', '#A868D4', '#D4A8EE'], hillFar: '#8A4AA0', hillMid: '#6E3680', hillNearA: '#522860', hillNearB: '#381A44' },
  { name: 'Radiance', sky: ['#B56410', '#E0A21E', '#F5D44A', '#FFF08A'], hillFar: '#C4A42E', hillMid: '#A5841F', hillNearA: '#7E6416', hillNearB: '#5A4810' },
  { name: 'Peace', sky: ['#104E4E', '#1E8A8A', '#4AC4C4', '#8AEEEE'], hillFar: '#2EA48A', hillMid: '#1F846E', hillNearA: '#166452', hillNearB: '#104A3A' },
  { name: 'Stonehenge', sky: ['#5A5A6E', '#7A7A90', '#A0A0B4', '#C8C8D4'], hillFar: '#8A8A6E', hillMid: '#6E6E54', hillNearA: '#52523E', hillNearB: '#3A3A2A' },
  { name: 'Red Moon Desert', sky: ['#6E1E1E', '#A83A3A', '#D46868', '#EEA8A8'], hillFar: '#A45A3A', hillMid: '#844028', hillNearA: '#642E1A', hillNearB: '#4A2010' },
  { name: 'Vortec Space', sky: ['#0A0A2E', '#1E1E5A', '#3A3A90', '#6868C4'], hillFar: '#2E2E6E', hillMid: '#1F1F54', hillNearA: '#16163E', hillNearB: '#0A0A2A' },
]

// ── Canvas2D helpers ───────────────────────────────────────────────────────

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  rtl: number, rtr: number, rbr: number, rbl: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + rtl, y)
  ctx.lineTo(x + w - rtr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rtr)
  ctx.lineTo(x + w, y + h - rbr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rbr, y + h)
  ctx.lineTo(x + rbl, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rbl)
  ctx.lineTo(x, y + rtl)
  ctx.quadraticCurveTo(x, y, x + rtl, y)
  ctx.closePath()
}

function springEase(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const keyframes: [number, number][] = [
    [0, 0], [0.08, 0], [0.4, 1.12], [0.65, 0.95], [0.82, 1.04], [1.0, 1.0],
  ]
  for (let i = 0; i < keyframes.length - 1; i++) {
    const [t0, v0] = keyframes[i]
    const [t1, v1] = keyframes[i + 1]
    if (t >= t0 && t <= t1) {
      const frac = (t - t0) / (t1 - t0)
      const s = frac * frac * (3 - 2 * frac)
      return v0 + (v1 - v0) * s
    }
  }
  return 1
}

// ── Bliss wallpaper (always procedural - no external bitmaps) ────────────────

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, scrollX: number, wallpaperIndex: number) {
  const taskbarH = 36
  const dh = h - taskbarH
  const tint = WALLPAPER_POOL[wallpaperIndex] ?? WALLPAPER_POOL[0]
  drawBlissFallback(ctx, w, dh, scrollX, tint)
}

function drawBlissFallback(ctx: CanvasRenderingContext2D, w: number, dh: number, scrollX: number, tint: WallpaperTint) {
  // Sky
  const skyGrad = ctx.createLinearGradient(0, 0, 0, dh * 0.65)
  skyGrad.addColorStop(0, tint.sky[0])
  skyGrad.addColorStop(0.4, tint.sky[1])
  skyGrad.addColorStop(0.75, tint.sky[2])
  skyGrad.addColorStop(1, tint.sky[3])
  ctx.fillStyle = skyGrad
  ctx.fillRect(0, 0, w, dh)

  // Clouds
  ctx.globalAlpha = 0.6
  const cloudData = [
    { cx: 0.15, cy: 0.12, rx: 140, ry: 35 },
    { cx: 0.45, cy: 0.08, rx: 180, ry: 40 },
    { cx: 0.75, cy: 0.18, rx: 120, ry: 30 },
    { cx: 0.95, cy: 0.1, rx: 100, ry: 28 },
    { cx: 0.3, cy: 0.22, rx: 90, ry: 25 },
  ]
  for (const c of cloudData) {
    const cx = ((c.cx * w + 200 - scrollX * 0.08) % (w + 500)) - 250
    const cy = c.cy * dh
    const cGrad = ctx.createRadialGradient(cx, cy - 5, 0, cx, cy, c.rx)
    cGrad.addColorStop(0, 'rgba(255,255,255,0.9)')
    cGrad.addColorStop(0.5, 'rgba(255,255,255,0.4)')
    cGrad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = cGrad
    ctx.beginPath()
    ctx.ellipse(cx, cy, c.rx, c.ry, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(cx - c.rx * 0.3, cy - c.ry * 0.5, c.rx * 0.5, c.ry * 0.6, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(cx + c.rx * 0.25, cy - c.ry * 0.3, c.rx * 0.4, c.ry * 0.5, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  // Rolling green hills
  const hillBase = dh * 0.62

  ctx.fillStyle = tint.hillFar
  ctx.beginPath()
  ctx.moveTo(0, dh)
  for (let x = 0; x <= w; x += 3) {
    const yy = hillBase + 20 + Math.sin((x + scrollX * 0.08) * 0.0025) * 50
      + Math.sin((x + scrollX * 0.08) * 0.007 + 2) * 18
    ctx.lineTo(x, yy)
  }
  ctx.lineTo(w, dh); ctx.closePath(); ctx.fill()

  ctx.fillStyle = tint.hillMid
  ctx.beginPath()
  ctx.moveTo(0, dh)
  for (let x = 0; x <= w; x += 3) {
    const yy = hillBase + 50 + Math.sin((x + scrollX * 0.16) * 0.003 + 1) * 40
      + Math.sin((x + scrollX * 0.16) * 0.01) * 14
    ctx.lineTo(x, yy)
  }
  ctx.lineTo(w, dh); ctx.closePath(); ctx.fill()

  const nearGrad = ctx.createLinearGradient(0, hillBase + 60, 0, dh)
  nearGrad.addColorStop(0, tint.hillNearA)
  nearGrad.addColorStop(1, tint.hillNearB)
  ctx.fillStyle = nearGrad
  ctx.beginPath()
  ctx.moveTo(0, dh)
  for (let x = 0; x <= w; x += 3) {
    const yy = hillBase + 80 + Math.sin((x + scrollX * 0.28) * 0.004 + 3) * 30
      + Math.sin((x + scrollX * 0.28) * 0.013 + 1) * 12
    ctx.lineTo(x, yy)
  }
  ctx.lineTo(w, dh); ctx.closePath(); ctx.fill()
}

// ── Desktop icons (static on wallpaper) ────────────────────────────────────

const DESKTOP_ICON_DEFS: { icon: IconType; label: string; col: number; row: number }[] = [
  { icon: 'my-computer', label: 'My Computer', col: 0, row: 0 },
  { icon: 'my-documents', label: 'My Documents', col: 0, row: 1 },
  { icon: 'recycle-bin', label: 'Recycle Bin', col: 0, row: 2 },
  { icon: 'ie', label: 'Internet Explorer', col: 0, row: 3 },
  { icon: 'notepad', label: 'Notepad', col: 0, row: 4 },
]

function drawDesktopIcons(ctx: CanvasRenderingContext2D) {
  const iconSize = 36
  const startX = 16
  const startY = 12
  const colW = 80
  const rowH = 76

  for (const def of DESKTOP_ICON_DEFS) {
    const ix = startX + def.col * colW + (colW - iconSize) / 2
    const iy = startY + def.row * rowH

    ctx.save()
    drawFileIcon(ctx, ix, iy, def.icon, '', iconSize)

    // White text + dark shadow (desktop-style labels)
    ctx.fillStyle = '#FFFFFF'
    ctx.font = '11px Tahoma, Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 2
    ctx.shadowOffsetX = 1
    ctx.shadowOffsetY = 1
    const maxLabelW = 70
    let displayLabel = def.label
    if (ctx.measureText(displayLabel).width > maxLabelW) {
      while (displayLabel.length > 3 && ctx.measureText(displayLabel + '...').width > maxLabelW) {
        displayLabel = displayLabel.slice(0, -1)
      }
      displayLabel += '...'
    }
    ctx.fillText(displayLabel, ix + iconSize / 2, iy + iconSize + 4)
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
    ctx.textAlign = 'left'
    ctx.restore()
  }
}

// ── Taskbar ────────────────────────────────────────────────────────────────

function drawTaskbar(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const taskbarH = 36
  const ty = h - taskbarH

  ctx.fillStyle = '#6CB5F8'
  ctx.fillRect(0, ty, w, 2)

  const grad = ctx.createLinearGradient(0, ty + 2, 0, h)
  grad.addColorStop(0, '#3B8CF3')
  grad.addColorStop(0.02, '#56A0F5')
  grad.addColorStop(0.06, '#368CF0')
  grad.addColorStop(0.15, '#245EDC')
  grad.addColorStop(0.35, '#2054C8')
  grad.addColorStop(0.55, '#1E4DB8')
  grad.addColorStop(0.75, '#2258CC')
  grad.addColorStop(0.88, '#2E6EDD')
  grad.addColorStop(0.95, '#3D8CF0')
  grad.addColorStop(1, '#4A9BF5')
  ctx.fillStyle = grad
  ctx.fillRect(0, ty + 2, w, taskbarH - 2)

  // Start button
  const btnW = 110
  const sGrad = ctx.createLinearGradient(0, ty, 0, ty + taskbarH)
  sGrad.addColorStop(0, '#6FC06E')
  sGrad.addColorStop(0.03, '#5CB85B')
  sGrad.addColorStop(0.08, '#4AA64A')
  sGrad.addColorStop(0.18, '#388E3C')
  sGrad.addColorStop(0.35, '#2E7D32')
  sGrad.addColorStop(0.55, '#276C2A')
  sGrad.addColorStop(0.75, '#2E7D32')
  sGrad.addColorStop(0.88, '#3D9940')
  sGrad.addColorStop(0.95, '#52AD52')
  sGrad.addColorStop(1, '#62BF62')
  ctx.fillStyle = sGrad
  roundedRect(ctx, 0, ty, btnW, taskbarH, 0, 8, 8, 0)
  ctx.fill()
  ctx.fillStyle = '#1A5010'
  ctx.fillRect(btnW - 1, ty, 1, taskbarH)

  // Windows flag (red, blue, green, yellow quadrants)
  const flagX = 10
  const flagY = ty + taskbarH / 2 - 7
  const sq = 6
  const gap = 1.5
  ctx.fillStyle = '#FF0000'
  roundedRect(ctx, flagX, flagY, sq, sq, 0.5, 0.5, 0.5, 0.5)
  ctx.fill()
  ctx.fillStyle = '#00A2ED'
  roundedRect(ctx, flagX + sq + gap, flagY, sq, sq, 0.5, 0.5, 0.5, 0.5)
  ctx.fill()
  ctx.fillStyle = '#7CBB00'
  roundedRect(ctx, flagX, flagY + sq + gap, sq, sq, 0.5, 0.5, 0.5, 0.5)
  ctx.fill()
  ctx.fillStyle = '#FFB900'
  roundedRect(ctx, flagX + sq + gap, flagY + sq + gap, sq, sq, 0.5, 0.5, 0.5, 0.5)
  ctx.fill()

  // "start" text
  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold italic 14px Tahoma, Arial, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 2
  ctx.shadowOffsetX = 1
  ctx.shadowOffsetY = 1
  ctx.fillText('start', 30, ty + taskbarH / 2 + 1)
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0

  // Clock area
  const clockW = 80
  const clockX = w - clockW - 4
  ctx.fillStyle = 'rgba(0,50,150,0.3)'
  roundedRect(ctx, clockX - 4, ty + 4, clockW + 8, taskbarH - 8, 2, 2, 2, 2)
  ctx.fill()
  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold 12px Tahoma, Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('12:00 AM', clockX + clockW / 2, ty + taskbarH / 2 + 1)
  ctx.textAlign = 'left'
}

// ── Unregistered HyperCam 2 watermark ──────────────────────────────────────

function drawWatermark(ctx: CanvasRenderingContext2D) {
  const text = 'Unregistered HyperCam 2'
  ctx.font = 'bold 20px "MS Sans Serif", "Microsoft Sans Serif", "Segoe UI", Arial, sans-serif'
  const metrics = ctx.measureText(text)
  const padX = 6
  const padTop = 3
  const padBot = 2
  const textH = 20
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, metrics.width + padX * 2, textH + padTop + padBot)
  ctx.fillStyle = '#000000'
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText(text, padX, padTop)
}

// ── Title bar drawing ──────────────────────────────────────────────────────

function drawTitleBar(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, width: number, title: string, type: WindowType,
) {
  const barH = 30

  const grad = ctx.createLinearGradient(x, y, x, y + barH)
  grad.addColorStop(0, XP.activeTitleA)
  grad.addColorStop(0.3, XP.activeTitleB)
  grad.addColorStop(0.5, XP.activeTitleA)
  grad.addColorStop(0.7, XP.activeTitleC)
  grad.addColorStop(1, XP.activeTitleA)
  ctx.fillStyle = grad
  roundedRect(ctx, x, y, width, barH, 8, 8, 0, 0)
  ctx.fill()

  // Glossy sheen
  const sheen = ctx.createLinearGradient(x, y, x, y + barH * 0.5)
  sheen.addColorStop(0, 'rgba(255,255,255,0.3)')
  sheen.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen
  roundedRect(ctx, x, y, width, barH * 0.5, 8, 8, 0, 0)
  ctx.fill()

  // Mini icon
  drawMiniIcon(ctx, x + 8, y + 8, 14, type)

  // Title text
  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold 13px Tahoma, Arial, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 2
  ctx.shadowOffsetX = 1
  ctx.shadowOffsetY = 1
  const maxTextW = width - 120
  let displayTitle = title
  if (ctx.measureText(displayTitle).width > maxTextW) {
    while (displayTitle.length > 3 && ctx.measureText(displayTitle + '...').width > maxTextW) {
      displayTitle = displayTitle.slice(0, -1)
    }
    displayTitle += '...'
  }
  ctx.fillText(displayTitle, x + 28, y + barH / 2 + 1)
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0

  // Control buttons
  const btnW = 21
  const btnH = 21
  const btnY = y + 5
  const btnGap = 2
  const closeX = x + width - btnW - 6
  drawControlButton(ctx, closeX, btnY, btnW, btnH, XP.closeBtnA, XP.closeBtnB, 'close')
  const maxX = closeX - btnW - btnGap
  drawControlButton(ctx, maxX, btnY, btnW, btnH, XP.maxBtnA, XP.maxBtnB, 'max')
  const minX = maxX - btnW - btnGap
  drawControlButton(ctx, minX, btnY, btnW, btnH, XP.minBtnA, XP.minBtnB, 'min')
}

function drawControlButton(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  colorA: string, colorB: string, glyph: 'close' | 'max' | 'min',
) {
  const grad = ctx.createLinearGradient(x, y, x, y + h)
  grad.addColorStop(0, colorB)
  grad.addColorStop(0.5, colorA)
  grad.addColorStop(1, colorA)
  ctx.fillStyle = grad
  roundedRect(ctx, x, y, w, h, 3, 3, 3, 3)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'
  ctx.lineWidth = 1
  roundedRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 3, 3, 3, 3)
  ctx.stroke()

  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth = 2
  const cx = x + w / 2
  const cy = y + h / 2
  if (glyph === 'close') {
    ctx.beginPath()
    ctx.moveTo(cx - 4, cy - 4); ctx.lineTo(cx + 4, cy + 4)
    ctx.moveTo(cx + 4, cy - 4); ctx.lineTo(cx - 4, cy + 4)
    ctx.stroke()
  } else if (glyph === 'max') {
    ctx.strokeRect(cx - 4, cy - 4, 8, 8)
  } else {
    ctx.beginPath()
    ctx.moveTo(cx - 4, cy + 3); ctx.lineTo(cx + 4, cy + 3)
    ctx.stroke()
  }
}

function drawMiniIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, type: WindowType) {
  const s = size
  if (type === 'notepad') {
    ctx.fillStyle = '#FFFFF0'
    ctx.fillRect(x + 2, y, s - 4, s)
    ctx.fillStyle = '#6699CC'
    ctx.fillRect(x + 2, y, s - 4, 3)
    ctx.strokeStyle = '#808080'
    ctx.lineWidth = 0.5
    ctx.strokeRect(x + 2, y, s - 4, s)
  } else if (type === 'ie') {
    ctx.fillStyle = '#0078D7'
    ctx.beginPath()
    ctx.arc(x + s / 2, y + s / 2, s / 2 - 1, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#FFFFFF'
    ctx.font = `bold ${s - 4}px Arial`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('e', x + s / 2, y + s / 2 + 1)
  } else if (type === 'my-computer' || type === 'control-panel') {
    ctx.fillStyle = '#7B7B7B'
    ctx.fillRect(x + 1, y + 1, s - 2, s - 5)
    ctx.fillStyle = '#3A6EA5'
    ctx.fillRect(x + 2, y + 2, s - 4, s - 7)
    ctx.fillStyle = '#7B7B7B'
    ctx.fillRect(x + s / 2 - 2, y + s - 4, 4, 3)
  } else if (type === 'recycle-bin') {
    ctx.fillStyle = '#C0C0C0'
    ctx.beginPath()
    ctx.moveTo(x + 2, y + 3); ctx.lineTo(x + s - 2, y + 3)
    ctx.lineTo(x + s - 3, y + s); ctx.lineTo(x + 3, y + s)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#A0A0A0'
    ctx.fillRect(x + 1, y + 1, s - 2, 3)
  } else if (type === 'paint') {
    ctx.fillStyle = '#FFFFF0'
    ctx.fillRect(x + 1, y + 1, s - 2, s - 2)
    ctx.fillStyle = '#FF0000'; ctx.fillRect(x + 3, y + 3, 3, 3)
    ctx.fillStyle = '#00FF00'; ctx.fillRect(x + 7, y + 3, 3, 3)
    ctx.fillStyle = '#0000FF'; ctx.fillRect(x + 3, y + 7, 3, 3)
    ctx.fillStyle = '#FFFF00'; ctx.fillRect(x + 7, y + 7, 3, 3)
  } else {
    // folder / my-documents
    ctx.fillStyle = '#F7D774'
    ctx.fillRect(x, y + 3, s, s - 3)
    ctx.fillStyle = '#D4A840'
    ctx.fillRect(x, y + 1, s * 0.45, 4)
  }
}

// ── Window body drawing ────────────────────────────────────────────────────

function drawWindowBody(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, width: number, height: number, type: WindowType,
) {
  ctx.fillStyle = XP.windowFace
  ctx.fillRect(x, y, width, height)

  const menuH = 22
  ctx.fillStyle = XP.menuBg
  ctx.fillRect(x, y, width, menuH)
  ctx.fillStyle = XP.menuText
  ctx.font = '12px Tahoma, Arial, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  const menus = getMenuLabels(type)
  let mx = x + 8
  for (const label of menus) {
    ctx.fillText(label, mx, y + menuH / 2)
    mx += ctx.measureText(label).width + 16
  }
  ctx.fillStyle = '#ACA899'
  ctx.fillRect(x, y + menuH, width, 1)

  const contentY = y + menuH + 1
  const contentH = height - menuH - 1

  if (type === 'notepad' || type === 'paint') {
    ctx.fillStyle = XP.windowBg
    ctx.fillRect(x + 2, contentY, width - 4, contentH)
    if (type === 'notepad') {
      ctx.strokeStyle = '#E8E8E8'
      ctx.lineWidth = 1
      for (let ly = contentY + 20; ly < contentY + contentH - 5; ly += 18) {
        ctx.beginPath()
        ctx.moveTo(x + 8, ly); ctx.lineTo(x + width - 8, ly)
        ctx.stroke()
      }
      ctx.fillStyle = '#000000'
      ctx.font = '13px Courier New, monospace'
      const lines = ['Hello World!', 'This is Windows XP.', 'Notepad is great.']
      for (let i = 0; i < Math.min(lines.length, 3); i++) {
        ctx.fillText(lines[i], x + 8, contentY + 16 + i * 18)
      }
    }
  } else if (type === 'ie') {
    const toolH = 28
    ctx.fillStyle = XP.windowFace
    ctx.fillRect(x + 2, contentY, width - 4, toolH)
    ctx.fillStyle = '#ACA899'
    ctx.fillRect(x + 2, contentY + toolH, width - 4, 1)
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(x + 60, contentY + 4, width - 80, 20)
    ctx.strokeStyle = '#7F9DB9'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 60, contentY + 4, width - 80, 20)
    ctx.fillStyle = '#000000'
    ctx.font = '12px Tahoma, Arial, sans-serif'
    ctx.fillText('http://www.msn.com/', x + 64, contentY + 17)
    ctx.fillStyle = XP.windowBg
    ctx.fillRect(x + 2, contentY + toolH + 1, width - 4, contentH - toolH - 1)
    ctx.fillStyle = '#808080'
    ctx.font = '14px Tahoma, Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('The page cannot be displayed', x + width / 2, contentY + toolH + contentH / 3)
    ctx.textAlign = 'left'
  } else {
    const sideW = Math.min(180, width * 0.28)
    const sGrad = ctx.createLinearGradient(x, contentY, x + sideW, contentY)
    sGrad.addColorStop(0, XP.sidebarA)
    sGrad.addColorStop(1, XP.sidebarB)
    ctx.fillStyle = sGrad
    ctx.fillRect(x + 2, contentY, sideW, contentH)
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 12px Tahoma, Arial, sans-serif'
    ctx.fillText('System Tasks', x + 10, contentY + 20)
    ctx.font = '11px Tahoma, Arial, sans-serif'
    ctx.fillText('View system info', x + 14, contentY + 40)
    ctx.fillText('Add/Remove programs', x + 14, contentY + 56)
    ctx.fillStyle = XP.windowBg
    ctx.fillRect(x + sideW + 2, contentY, width - sideW - 4, contentH)
    drawExplorerIcons(ctx, x + sideW + 16, contentY + 16, width - sideW - 32, type)
  }
}

function getMenuLabels(type: WindowType): string[] {
  switch (type) {
    case 'notepad': return ['File', 'Edit', 'Format', 'View', 'Help']
    case 'ie': return ['File', 'Edit', 'View', 'Favorites', 'Tools', 'Help']
    case 'paint': return ['File', 'Edit', 'View', 'Image', 'Colors', 'Help']
    default: return ['File', 'Edit', 'View', 'Favorites', 'Tools', 'Help']
  }
}

function drawExplorerIcons(
  ctx: CanvasRenderingContext2D, x: number, y: number, areaW: number, type: WindowType,
) {
  const iconSize = 32
  const gap = 80
  const perRow = Math.max(1, Math.floor(areaW / gap))
  let items: { icon: IconType; label: string }[]
  if (type === 'my-computer') {
    items = [
      { icon: 'folder', label: 'Local Disk (C:)' },
      { icon: 'folder', label: 'Local Disk (D:)' },
      { icon: 'folder', label: 'CD Drive (E:)' },
      { icon: 'my-computer', label: 'Control Panel' },
    ]
  } else if (type === 'control-panel') {
    items = [
      { icon: 'my-computer', label: 'Display' },
      { icon: 'my-computer', label: 'System' },
      { icon: 'my-computer', label: 'Network' },
      { icon: 'folder', label: 'Fonts' },
    ]
  } else if (type === 'recycle-bin') {
    items = [
      { icon: 'notepad', label: 'old_file.txt' },
      { icon: 'folder', label: 'Backup' },
    ]
  } else {
    items = [
      { icon: 'folder', label: 'My Pictures' },
      { icon: 'folder', label: 'My Music' },
      { icon: 'notepad', label: 'readme.txt' },
    ]
  }
  for (let i = 0; i < items.length; i++) {
    const col = i % perRow
    const row = Math.floor(i / perRow)
    const ix = x + col * gap
    const iy = y + row * 60
    drawFileIcon(ctx, ix + (gap - iconSize) / 2, iy, items[i].icon, items[i].label, iconSize)
  }
}

// ── Window frame + composite ───────────────────────────────────────────────

function drawWindowFrame(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  ctx.shadowColor = XP.shadow
  ctx.shadowBlur = 12
  ctx.shadowOffsetX = 4
  ctx.shadowOffsetY = 4
  ctx.fillStyle = XP.windowBorder
  roundedRect(ctx, x, y, width, height, 8, 8, 4, 4)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
}

function drawWindow(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  title: string, type: WindowType, springT: number,
) {
  const scale = springEase(Math.min(springT, 1))
  if (scale <= 0.001) return
  const cx = x + w / 2
  const cy = y + h / 2
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)
  ctx.translate(-cx, -cy)
  drawWindowFrame(ctx, x, y, w, h)
  const borderW = 3
  drawTitleBar(ctx, x + borderW, y + borderW, w - borderW * 2, title, type)
  const titleH = 30
  drawWindowBody(ctx, x + borderW, y + borderW + titleH, w - borderW * 2, h - borderW * 2 - titleH, type)
  ctx.restore()
}

// ── File icon drawing ──────────────────────────────────────────────────────

function drawFileIcon(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, iconType: IconType, label: string, size: number,
) {
  const s = size
  const sc = s / 32

  ctx.save()
  ctx.translate(x, y)
  ctx.scale(sc, sc)

  if (iconType === 'folder') {
    ctx.fillStyle = '#F7D774'
    ctx.strokeStyle = '#D4A840'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(4, 10); ctx.lineTo(14, 10); ctx.lineTo(16, 7); ctx.lineTo(4, 7)
    ctx.closePath()
    ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#F7D774'
    ctx.strokeStyle = '#D4A840'
    roundedRect(ctx, 4, 10, 24, 16, 1, 1, 1, 1)
    ctx.fill(); ctx.stroke()
  } else if (iconType === 'notepad') {
    ctx.fillStyle = '#FFFFF0'
    ctx.strokeStyle = '#808080'
    ctx.lineWidth = 0.5
    roundedRect(ctx, 6, 3, 20, 26, 1, 1, 1, 1)
    ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#6699CC'
    ctx.strokeStyle = '#808080'
    roundedRect(ctx, 6, 3, 20, 4, 1, 1, 0, 0)
    ctx.fill(); ctx.stroke()
    ctx.strokeStyle = '#C0C0C0'
    ctx.lineWidth = 0.5
    for (let i = 0; i < 5; i++) {
      ctx.beginPath()
      ctx.moveTo(9, 10 + i * 3); ctx.lineTo(23, 10 + i * 3)
      ctx.stroke()
    }
  } else if (iconType === 'my-computer') {
    ctx.fillStyle = '#7B7B7B'
    ctx.strokeStyle = '#555555'
    ctx.lineWidth = 1
    roundedRect(ctx, 3, 3, 26, 18, 1, 1, 1, 1)
    ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#3A6EA5'
    ctx.fillRect(5, 5, 22, 14)
    ctx.fillStyle = '#0058A3'
    ctx.fillRect(6, 6, 20, 12)
    ctx.fillStyle = '#89D0FF'
    ctx.beginPath()
    ctx.moveTo(16, 8); ctx.lineTo(18, 12); ctx.lineTo(14, 12)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#7B7B7B'
    ctx.fillRect(12, 21, 8, 2)
    ctx.fillStyle = '#B0B0B0'
    ctx.strokeStyle = '#888888'
    ctx.lineWidth = 0.5
    roundedRect(ctx, 9, 23, 14, 3, 1, 1, 1, 1)
    ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#00C853'
    ctx.beginPath()
    ctx.arc(24, 19, 0.8, 0, Math.PI * 2)
    ctx.fill()
  } else if (iconType === 'ie') {
    ctx.fillStyle = '#0078D7'
    ctx.beginPath()
    ctx.arc(16, 16, 13, 0, Math.PI * 2)
    ctx.fill()
    ctx.save()
    ctx.translate(16, 16)
    ctx.rotate(-25 * Math.PI / 180)
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.ellipse(0, 0, 13, 6, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 14px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('e', 16, 17)
    ctx.textAlign = 'left'
  } else if (iconType === 'recycle-bin') {
    ctx.fillStyle = '#C0C0C0'
    ctx.strokeStyle = '#808080'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(8, 10); ctx.lineTo(10, 28); ctx.lineTo(22, 28); ctx.lineTo(24, 10)
    ctx.closePath()
    ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#A0A0A0'
    ctx.strokeStyle = '#808080'
    roundedRect(ctx, 7, 8, 18, 3, 1, 1, 1, 1)
    ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#B0B0B0'
    ctx.strokeStyle = '#808080'
    roundedRect(ctx, 13, 5, 6, 4, 1, 1, 1, 1)
    ctx.fill(); ctx.stroke()
    ctx.strokeStyle = '#808080'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(13, 13); ctx.lineTo(13.5, 25)
    ctx.moveTo(16, 13); ctx.lineTo(16, 25)
    ctx.moveTo(19, 13); ctx.lineTo(18.5, 25)
    ctx.stroke()
  } else if (iconType === 'my-documents') {
    ctx.fillStyle = '#F7D774'
    ctx.strokeStyle = '#D4A840'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(4, 8); ctx.lineTo(14, 8); ctx.lineTo(16, 5); ctx.lineTo(4, 5)
    ctx.closePath()
    ctx.fill(); ctx.stroke()
    roundedRect(ctx, 4, 8, 24, 19, 1, 1, 1, 1)
    ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#FFF8DC'
    ctx.fillRect(6, 10, 20, 15)
    ctx.strokeStyle = '#CCC'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(8, 13); ctx.lineTo(24, 13)
    ctx.moveTo(8, 16); ctx.lineTo(24, 16)
    ctx.moveTo(8, 19); ctx.lineTo(20, 19)
    ctx.stroke()
  }

  ctx.restore()

  // Label text below icon
  if (label) {
    ctx.fillStyle = '#000000'
    ctx.font = '11px Tahoma, Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const maxLabelW = Math.max(size, 60)
    let displayLabel = label
    if (ctx.measureText(displayLabel).width > maxLabelW) {
      while (displayLabel.length > 3 && ctx.measureText(displayLabel + '...').width > maxLabelW) {
        displayLabel = displayLabel.slice(0, -1)
      }
      displayLabel += '...'
    }
    ctx.fillText(displayLabel, x + s / 2, y + s + 4)
    ctx.textAlign = 'left'
  }
}

// ── Derived draw types ─────────────────────────────────────────────────────
// Rebuilt from the note list every frame - nothing persists across frames.

interface DerivedWindow {
  x: number
  y: number
  width: number
  height: number
  type: WindowType
  title: string
  springT: number
}

interface DerivedSprite {
  x: number
  y: number
  iconType: IconType
  label: string
}

// ── Params & ports ─────────────────────────────────────────────────────────

const PARAMS: ParamDef[] = [
  { key: 'driftSpeed', label: 'Drift Speed', min: 0, max: 3000, step: 50, default: 800 },
  { key: 'windowMinW', label: 'Window Min Width', min: 200, max: 800, step: 25, default: 350 },
  { key: 'windowMaxW', label: 'Window Max Width', min: 400, max: 1200, step: 25, default: 850 },
  { key: 'windowMinH', label: 'Window Min Height', min: 150, max: 500, step: 25, default: 250 },
  { key: 'windowMaxH', label: 'Window Max Height', min: 300, max: 900, step: 25, default: 600 },
  { key: 'springAnim', label: 'Spring Animation', type: 'boolean', default: 1 },
  { key: 'iconScale', label: 'Icon Scale', min: 0.5, max: 3, step: 0.1, default: 1.0 },
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.05, default: 1.0 },
  { key: 'spawnX', label: 'Spawn X Position', min: 0, max: 1, step: 0.05, default: 0.66 },
]
// ── Main component ─────────────────────────────────────────────────────────

function WindowsXPVisual({ trackId }: { trackId: string }) {
  const meshRef = useRef<Mesh>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textureRef = useRef<CanvasTexture | null>(null)
  const { viewport } = useThree()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_W
    canvas.height = CANVAS_H
    canvasRef.current = canvas

    const tex = new CanvasTexture(canvas)
    tex.minFilter = LinearFilter
    tex.magFilter = LinearFilter
    textureRef.current = tex
    setReady(true)

    return () => {
      tex.dispose()
    }
  }, [])

  useInstrumentFrame(trackId, (state) => {
    if (!canvasRef.current || !textureRef.current || !meshRef.current) return

    const ctx = canvasRef.current.getContext('2d')!
    const params = state.params

    const driftSpeed = params.driftSpeed ?? 800
    const windowMinW = params.windowMinW ?? 350
    const windowMaxW = params.windowMaxW ?? 850
    const windowMinH = params.windowMinH ?? 250
    const windowMaxH = params.windowMaxH ?? 600
    const enableSpring = (params.springAnim ?? 1) >= 0.5
    const iconScale = params.iconScale ?? 1.0
    const opacity = params.opacity ?? 1.0
    const spawnX = params.spawnX ?? 0.66

    // Time: the playhead in seconds is the only clock. Drift is closed-form from it,
    // so a static playhead is a static frame and scrubbing is exact.
    const currentBeat = state.beat
    const secPerBeat = state.secPerBeat
    const posOffset = driftSpeed * (currentBeat * secPerBeat)

    // Wallpaper (C1-B1): the latest wallpaper note at/before the playhead picks the
    // tint. (state.notes is sorted by beat, so the last match wins.)
    let wallpaperIndex = 0
    for (const n of state.notes) {
      if (n.beat > currentBeat) break
      if (n.pitch >= WALLPAPER_PITCH_MIN && n.pitch <= WALLPAPER_PITCH_MAX) {
        wallpaperIndex = (n.pitch - WALLPAPER_PITCH_MIN) % WALLPAPER_POOL.length
      }
    }

    // Windows (C2-B3): one window per note onset, derived fresh from the note list -
    // age in beat-seconds gives the drift-back position and the spring phase; size and
    // pool pick are seeded from the note itself so a rescrub regenerates them exactly.
    const windows: DerivedWindow[] = []
    for (const n of state.notes) {
      if (n.beat > currentBeat) break
      if (n.pitch < WINDOW_PITCH_MIN || n.pitch > WINDOW_PITCH_MAX) continue
      const ageSec = (currentBeat - n.beat) * secPerBeat
      const pitchNorm = (n.pitch - WINDOW_PITCH_MIN) / (WINDOW_PITCH_MAX - WINDOW_PITCH_MIN)
      const yNorm = 1 - pitchNorm
      const yMargin = 40
      const seed = Math.floor(n.beat * 13) + n.pitch * 7
      const w = windowMinW + seededRand(seed) * (windowMaxW - windowMinW)
      const h = windowMinH + seededRand(seed + 1) * (windowMaxH - windowMinH)
      const y = yMargin + yNorm * (CANVAS_H - h - yMargin * 2)
      const poolIndex = Math.floor(seededRand(seed + 2) * WINDOW_POOL.length)
      const poolEntry = WINDOW_POOL[poolIndex]
      const screenX = CANVAS_W * spawnX - driftSpeed * ageSec
      if (screenX + w <= -50) continue // drifted off the left edge
      windows.push({
        x: screenX,
        y,
        width: w,
        height: h,
        type: poolEntry.type,
        title: poolEntry.title,
        springT: enableSpring ? (ageSec * 1000) / SPRING_DURATION : 1,
      })
    }

    // File icon sprites (C4-B4) - 8 per beat while a note is held. Enumerate the
    // 8th-note subdivisions each note covers (up to the playhead) instead of spawning
    // on live subdivision changes; each subdivision k is one sprite, seeded by k+pitch.
    const spriteSize = 72 * iconScale
    const sprites: DerivedSprite[] = []
    // Oldest age still on screen - older sprites have drifted past the left edge, so
    // skip their subdivisions entirely (unbounded when there is no drift).
    const maxAgeBeats = driftSpeed > 0
      ? (CANVAS_W * spawnX + spriteSize + 80) / driftSpeed / secPerBeat
      : Infinity
    for (const n of state.notes) {
      if (n.beat > currentBeat) break
      if (n.pitch < ICON_PITCH_MIN || n.pitch > ICON_PITCH_MAX) continue
      const endBeat = n.beat + n.durationBeats
      let kMin = Math.ceil(n.beat * 8)
      if (Number.isFinite(maxAgeBeats)) {
        kMin = Math.max(kMin, Math.ceil((currentBeat - maxAgeBeats) * 8))
      }
      const kMax = Math.floor(Math.min(currentBeat, endBeat) * 8)
      for (let k = kMin; k <= kMax; k++) {
        const spawnBeat = k / 8
        if (spawnBeat >= endBeat) break // note released before this subdivision
        const ageSec = (currentBeat - spawnBeat) * secPerBeat
        const screenX = CANVAS_W * spawnX - driftSpeed * ageSec
        if (screenX + spriteSize <= -80) continue // drifted off the left edge
        const pitchNorm = (n.pitch - ICON_PITCH_MIN) / Math.max(1, ICON_PITCH_MAX - ICON_PITCH_MIN)
        const yNorm = 1 - pitchNorm
        const y = 40 + yNorm * (CANVAS_H - spriteSize - 100)
        const poolIdx = Math.floor(seededRand(k * 7 + n.pitch * 13) * ICON_POOL.length)
        sprites.push({
          x: screenX,
          y,
          iconType: ICON_POOL[poolIdx].type,
          label: ICON_POOL[poolIdx].label,
        })
      }
    }

    // ── Shake (C5) ──
    // Envelope + jitter are closed-form from the triggering note's age. The jitter
    // re-rolls at ~60Hz, but from a hash of the quantized age - a paused frame holds
    // still, and a retrigger wins because later notes overwrite (notes are sorted).
    let shakeX = 0
    let shakeY = 0
    for (const n of state.notes) {
      if (n.beat > currentBeat) break
      if (n.pitch !== SHAKE_PITCH) continue
      const ageSec = (currentBeat - n.beat) * secPerBeat
      if (ageSec >= 0.4) continue // 400ms shake
      const intensity = (1 - ageSec / 0.4) * 18 // max 18px, decays linearly
      const jitterSeed = Math.floor(ageSec * 60) * 7.13 + n.beat * 13
      shakeX = (seededRand(jitterSeed + 1) * 2 - 1) * intensity
      shakeY = (seededRand(jitterSeed + 2) * 2 - 1) * intensity
    }

    // ── Draw ──

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
    ctx.globalAlpha = opacity

    ctx.save()
    ctx.translate(shakeX, shakeY)

    // Background (procedural Bliss, tinted per wallpaper index)
    drawBackground(ctx, CANVAS_W, CANVAS_H, posOffset, wallpaperIndex)

    // Desktop icons
    drawDesktopIcons(ctx)

    // Draw windows
    for (const win of windows) {
      drawWindow(ctx, win.x, win.y, win.width, win.height, win.title, win.type, win.springT)
    }

    // Taskbar
    drawTaskbar(ctx, CANVAS_W, CANVAS_H)

    // Drifting file icon sprites (on top of windows and taskbar)
    for (const spr of sprites) {
      drawFileIcon(ctx, spr.x, spr.y, spr.iconType, spr.label, spriteSize)
    }

    // Watermark
    drawWatermark(ctx)

    ctx.restore() // end shake translate

    ctx.globalAlpha = 1

    // Update texture
    textureRef.current.needsUpdate = true

    // Scale mesh to fill viewport (cover-fit)
    const aspect = CANVAS_W / CANVAS_H
    const vpAspect = viewport.width / viewport.height
    if (vpAspect > aspect) {
      meshRef.current.scale.set(viewport.width, viewport.width / aspect, 1)
    } else {
      meshRef.current.scale.set(viewport.height * aspect, viewport.height, 1)
    }
  })

  if (!ready) return null

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
  )
}

// ── Instrument export ──────────────────────────────────────────────────────

export const windowsXpInstrument: ObjectInstrumentDef = {
  id: 'windowsXp',
  name: 'Windows XP',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: PARAMS,
  midiRows: [
    { pitch: 72, label: 'Screen shake', emphasized: true },
    { pitch: 67, label: 'Icon rain (hold) · high' },
    { pitch: 64, label: 'Icon rain (hold) · low' },
    { pitch: 57, label: 'Spawn window · near top' },
    { pitch: 55, label: 'Spawn window · high' },
    { pitch: 52, label: 'Spawn window · upper middle' },
    { pitch: 48, label: 'Spawn window · middle' },
    { pitch: 42, label: 'Spawn window · low' },
    { pitch: 36, label: 'Spawn window · bottom' },
    { pitch: 26, label: 'Wallpaper · autumn orange' },
    { pitch: 24, label: 'Wallpaper · Bliss green' },
  ],
  component: WindowsXPVisual,
  fullFrame: true,
}

'use client'

import { useEffect } from 'react'
import './launch.css'

export default function LaunchPage() {
  useEffect(() => {
    document.documentElement.style.height = '100%'
    document.body.style.height = '100%'
    document.body.style.overflow = 'hidden'
    document.body.style.background = '#ffffff'

    let rafId: number

    ;(() => {
      const VIEW_W = window.innerWidth
      const VIEW_H = window.innerHeight

      const ART_W = Math.max(VIEW_W * 3.2, 4800)
      const ART_H = VIEW_H

      const CELL = 10
      const COLS = Math.ceil(ART_W / CELL)
      const ROWS = Math.ceil(ART_H / CELL)

      const TOTAL_DURATION = 2.5
      const PAN_START = 0.18
      const PAN_END = 0.66
      const INITIAL_PHASE = 0.30
      const LEAD = 0.10
      const LOGO_START = 0.50
      const LOGO_END = 0.72
      const SETTLE_START = 0.78
      const SETTLE_END = 0.90
      const panMaxStatic = Math.max(0, ART_W - VIEW_W)

      const COLORS: Record<string, string> = {
        bg: '#ffffff',
        ink: '#2a1d10',
        inkLight: '#5a3c20',
        green: '#1e3320',
        greenLight: '#3d5a36',
        red: '#6e1418',
        redLight: '#9a2a26',
        yellow: '#d99820',
        yellowLight: '#e8c266',
      }
      const ACCENT_KEYS = ['inkLight', 'red', 'redLight', 'yellow', 'yellowLight', 'green', 'greenLight']

      function mulberry32(seed: number) {
        return function () {
          seed |= 0; seed = seed + 0x6D2B79F5 | 0
          let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
          t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
          return ((t ^ t >>> 14) >>> 0) / 4294967296
        }
      }
      const rand = mulberry32(42)

      type Cell = { v: number; c: string; pat: number; appearT?: number } | null
      const grid: Cell[] = new Array(COLS * ROWS).fill(null)

      function setCell(cx: number, cy: number, v: number, c: string, pat: number) {
        if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return
        const i = cy * COLS + cx
        const prev = grid[i]
        if (!prev || prev.v < v) grid[i] = { v, c, pat }
      }

      function dist(ax: number, ay: number, bx: number, by: number) {
        const dx = ax - bx, dy = ay - by
        return Math.sqrt(dx * dx + dy * dy)
      }

      function stampBlob(cx: number, cy: number, radius: number, color: string, pattern: number, jitter = 0.35) {
        const rCells = Math.ceil(radius / CELL) + 2
        const ccx = Math.round(cx / CELL), ccy = Math.round(cy / CELL)
        for (let dy = -rCells; dy <= rCells; dy++) {
          for (let dx = -rCells; dx <= rCells; dx++) {
            const gx = ccx + dx, gy = ccy + dy
            const px = gx * CELL + CELL / 2, py = gy * CELL + CELL / 2
            const d = dist(px, py, cx, cy)
            const n = (rand() - 0.5) * jitter * radius
            const t = 1 - (d + n) / radius
            if (t <= 0) continue
            setCell(gx, gy, Math.min(1, t * 1.4), color, pattern)
          }
        }
      }
      void stampBlob // suppress unused warning

      function stampWire(x1: number, y1: number, x2: number, y2: number, thickness: number, color: string, pattern: number) {
        const len = dist(x1, y1, x2, y2)
        const steps = Math.max(1, Math.ceil(len / 2))
        for (let i = 0; i <= steps; i++) {
          const t = i / steps
          const px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t
          const ccx = Math.round(px / CELL), ccy = Math.round(py / CELL)
          const tCells = Math.ceil(thickness / CELL)
          for (let dy = -tCells; dy <= tCells; dy++) {
            for (let dx = -tCells; dx <= tCells; dx++) {
              const gx = ccx + dx, gy = ccy + dy
              const cx0 = gx * CELL + CELL / 2, cy0 = gy * CELL + CELL / 2
              const d = dist(cx0, cy0, px, py)
              if (d > thickness) continue
              setCell(gx, gy, 0.75 + (1 - d / thickness) * 0.20, color, pattern)
            }
          }
        }
      }

      function stampRectE(x: number, y: number, w: number, h: number, density: number, color: string) {
        const c0x = Math.floor(x / CELL), c0y = Math.floor(y / CELL)
        const c1x = Math.ceil((x + w) / CELL), c1y = Math.ceil((y + h) / CELL)
        for (let gy = c0y; gy <= c1y; gy++) {
          for (let gx = c0x; gx <= c1x; gx++) {
            const px = gx * CELL + CELL / 2, py = gy * CELL + CELL / 2
            if (px < x || px > x + w || py < y || py > y + h) continue
            setCell(gx, gy, density, color, 3)
          }
        }
      }

      function stampCable(x1: number, y1: number, x2: number, y2: number, sag: number, thickness: number, color: string) {
        const steps = Math.max(8, Math.ceil(dist(x1, y1, x2, y2) / 3))
        for (let i = 0; i <= steps; i++) {
          const t = i / steps
          const px = x1 + (x2 - x1) * t
          const py = y1 + (y2 - y1) * t + sag * 4 * t * (1 - t)
          const ccx = Math.round(px / CELL), ccy = Math.round(py / CELL)
          const tCells = Math.ceil(thickness / CELL)
          for (let dy = -tCells; dy <= tCells; dy++) {
            for (let dx = -tCells; dx <= tCells; dx++) {
              const gx = ccx + dx, gy = ccy + dy
              const cx0 = gx * CELL + CELL / 2, cy0 = gy * CELL + CELL / 2
              const d = dist(cx0, cy0, px, py)
              if (d > thickness) continue
              setCell(gx, gy, 0.70 + (1 - d / thickness) * 0.25, color, 3)
            }
          }
        }
      }

      function stampTriangle(
        p1: { x: number; y: number },
        p2: { x: number; y: number },
        p3: { x: number; y: number },
        density: number,
        color: string
      ) {
        const minX = Math.min(p1.x, p2.x, p3.x), maxX = Math.max(p1.x, p2.x, p3.x)
        const minY = Math.min(p1.y, p2.y, p3.y), maxY = Math.max(p1.y, p2.y, p3.y)
        const c0x = Math.floor(minX / CELL), c0y = Math.floor(minY / CELL)
        const c1x = Math.ceil(maxX / CELL), c1y = Math.ceil(maxY / CELL)
        const sign = (px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }) =>
          (px - b.x) * (a.y - b.y) - (a.x - b.x) * (py - b.y)
        for (let gy = c0y; gy <= c1y; gy++) {
          for (let gx = c0x; gx <= c1x; gx++) {
            const px = gx * CELL + CELL / 2, py = gy * CELL + CELL / 2
            const d1 = sign(px, py, p1, p2)
            const d2 = sign(px, py, p2, p3)
            const d3 = sign(px, py, p3, p1)
            const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
            const hasPos = d1 > 0 || d2 > 0 || d3 > 0
            if (!(hasNeg && hasPos)) setCell(gx, gy, density, color, 3)
          }
        }
      }

      function stampDisc(cx: number, cy: number, r: number, density: number, color: string) {
        const cellsR = Math.ceil(r / CELL)
        const ccx = Math.round(cx / CELL), ccy = Math.round(cy / CELL)
        for (let dy = -cellsR; dy <= cellsR; dy++) {
          for (let dx = -cellsR; dx <= cellsR; dx++) {
            const gx = ccx + dx, gy = ccy + dy
            const px = gx * CELL + CELL / 2, py = gy * CELL + CELL / 2
            if (dist(px, py, cx, cy) > r) continue
            setCell(gx, gy, density, color, 3)
          }
        }
      }

      function bigCityLights(cx: number, cy: number, scale = 1) {
        const mapW = 900 * scale, mapH = 440 * scale
        const x0 = cx - mapW / 2, y0 = cy - mapH / 2

        for (let i = 0; i < 60; i++) {
          stampRectE(x0 + rand() * mapW, y0 + rand() * (mapH * 0.06), 2 * scale, 2 * scale, 0.6, 'yellowLight')
        }

        const streetPitchX = 18 * scale, streetPitchY = 22 * scale
        const cityTop = y0 + mapH * 0.08
        const cityH = mapH - (cityTop - y0)
        const downX = cx, downY = cy + mapH * 0.15, downR = mapW * 0.45

        function densityAt(px: number, py: number) {
          const d = Math.sqrt((px - downX) ** 2 + (py - downY) ** 2 * 1.6)
          return Math.max(0, 1 - d / downR)
        }

        for (let lx = x0 + streetPitchX * 0.5; lx < x0 + mapW; lx += streetPitchX) {
          const jx = (rand() - 0.5) * 4 * scale
          for (let py = cityTop; py < y0 + mapH; py += 3 * scale) {
            const dens = densityAt(lx, py)
            if (dens <= 0 || rand() > dens * 0.85) continue
            const ds = 2 * scale * (0.7 + rand() * 0.6)
            const col = rand() < 0.15 ? 'red' : rand() < 0.40 ? 'yellow' : 'yellowLight'
            stampRectE(lx + jx, py, ds, ds, 1.0, col)
          }
        }

        for (let ly = cityTop + streetPitchY * 0.5; ly < y0 + mapH; ly += streetPitchY) {
          const jy = (rand() - 0.5) * 4 * scale
          for (let px = x0; px < x0 + mapW; px += 3 * scale) {
            const dens = densityAt(px, ly)
            if (dens <= 0 || rand() > dens * 0.85) continue
            const ds = 2 * scale * (0.7 + rand() * 0.6)
            const col = rand() < 0.15 ? 'red' : rand() < 0.40 ? 'yellow' : 'yellowLight'
            stampRectE(px, ly + jy, ds, ds, 1.0, col)
          }
        }

        const scatterCount = Math.floor(mapW * mapH / (60 * scale * scale))
        for (let i = 0; i < scatterCount; i++) {
          const px = x0 + rand() * mapW, py = cityTop + rand() * cityH
          const dens = densityAt(px, py)
          if (rand() > dens * 0.7) continue
          const ds = 1.5 * scale * (0.6 + rand() * 0.7)
          const col = rand() < 0.08 ? 'red' : rand() < 0.30 ? 'yellow' : 'yellowLight'
          stampRectE(px, py, ds, ds, 1.0, col)
        }

        const avenues = [
          { x1: 0.10, y1: 0.55, x2: 0.95, y2: 0.45 },
          { x1: 0.45, y1: 0.20, x2: 0.55, y2: 0.95 },
          { x1: 0.05, y1: 0.30, x2: 0.95, y2: 0.85 },
          { x1: 0.30, y1: 0.95, x2: 0.80, y2: 0.15 },
        ]
        for (const av of avenues) {
          const ax1 = x0 + mapW * av.x1, ay1 = y0 + mapH * av.y1
          const ax2 = x0 + mapW * av.x2, ay2 = y0 + mapH * av.y2
          const steps = Math.ceil(dist(ax1, ay1, ax2, ay2) / (2 * scale))
          for (let s = 0; s <= steps; s++) {
            const t = s / steps
            const px = ax1 + (ax2 - ax1) * t, py = ay1 + (ay2 - ay1) * t
            if (densityAt(px, py) < 0.2) continue
            const col = rand() < 0.30 ? 'yellow' : 'yellowLight'
            stampRectE(px - scale, py - scale, 2.5 * scale, 2.5 * scale, 1.0, col)
          }
        }
      }

      function bigLeaf(cx: number, cy: number, scale = 1) {
        const towerH = 460 * scale, baseHalfW = 60 * scale, topHalfW = 18 * scale
        const baseY = cy + towerH * 0.5, topY = cy - towerH * 0.5

        stampWire(cx - baseHalfW, baseY, cx - topHalfW, topY, 4.5 * scale, 'ink', 3)
        stampWire(cx + baseHalfW, baseY, cx + topHalfW, topY, 4.5 * scale, 'ink', 3)
        stampRectE(cx - baseHalfW - 16 * scale, baseY - 3 * scale, (baseHalfW + 16 * scale) * 2, 10 * scale, 1.0, 'ink')

        const levels = 12
        for (let i = 0; i < levels; i++) {
          const t1 = i / levels, t2 = (i + 1) / levels
          const y1 = baseY + (topY - baseY) * t1, y2 = baseY + (topY - baseY) * t2
          const w1 = baseHalfW + (topHalfW - baseHalfW) * t1
          const w2 = baseHalfW + (topHalfW - baseHalfW) * t2
          stampWire(cx - w1, y1, cx + w1, y1, 2.2 * scale, 'ink', 3)
          stampWire(cx - w1, y1, cx + w2, y2, 1.6 * scale, 'ink', 3)
          stampWire(cx + w1, y1, cx - w2, y2, 1.6 * scale, 'ink', 3)
          const yMid = (y1 + y2) / 2, wMid = (w1 + w2) / 2
          stampWire(cx - wMid * 0.55, yMid, cx + wMid * 0.55, yMid, 1.2 * scale, 'ink', 3)
        }
        stampWire(cx - topHalfW, topY, cx + topHalfW, topY, 2.5 * scale, 'ink', 3)

        const armConfig = [
          { yOff: 8 * scale, halfW: 95 * scale },
          { yOff: -42 * scale, halfW: 78 * scale },
          { yOff: -90 * scale, halfW: 58 * scale },
        ]
        for (const arm of armConfig) {
          const ay = topY + arm.yOff
          stampWire(cx - arm.halfW, ay, cx + arm.halfW, ay, 3 * scale, 'ink', 3)
          stampWire(cx - arm.halfW * 0.95, ay + 12 * scale, cx + arm.halfW * 0.95, ay + 12 * scale, 2 * scale, 'ink', 3)
          stampWire(cx - topHalfW, topY + arm.yOff + 30 * scale, cx - arm.halfW, ay, 1.8 * scale, 'ink', 3)
          stampWire(cx + topHalfW, topY + arm.yOff + 30 * scale, cx + arm.halfW, ay, 1.8 * scale, 'ink', 3)
          const segs = 5
          for (let s = 0; s < segs; s++) {
            const x1 = cx - arm.halfW + 2 * arm.halfW * (s / segs)
            const x2 = cx - arm.halfW + 2 * arm.halfW * ((s + 1) / segs)
            stampWire(x1, ay, x2, ay + 12 * scale, 1.2 * scale, 'ink', 3)
          }
          for (const sgn of [-1, 1]) {
            const ix = cx + sgn * arm.halfW, iyTop = ay + 14 * scale
            stampWire(ix, iyTop, ix, iyTop + 38 * scale, 2 * scale, 'ink', 3)
            for (let j = 1; j <= 8; j++) {
              const dy = iyTop + j * 4.5 * scale
              stampWire(ix - 5.5 * scale, dy, ix + 5.5 * scale, dy, 1.4 * scale, 'ink', 3)
            }
            stampRectE(ix - 7 * scale, iyTop + 38 * scale, 14 * scale, 3 * scale, 1.0, 'ink')
          }
        }

        stampWire(cx, topY, cx, topY - 36 * scale, 2 * scale, 'ink', 3)
        stampDisc(cx, topY - 36 * scale, 3 * scale, 1.0, 'ink')

        for (const arm of armConfig) {
          const ay = topY + arm.yOff + 52 * scale
          for (const sgn of [-1, 1]) {
            stampCable(cx + sgn * arm.halfW, ay, cx + sgn * (arm.halfW + 240 * scale), ay + 18 * scale, 30 * scale, 1.6 * scale, 'ink')
          }
        }
      }

      function bigFlower(cx: number, cy: number, scale = 1, opts: { leafDX?: number; leafDY?: number; stem?: boolean; [key: string]: unknown } = {}) {
        const frameH = 320 * scale, frameW = 30 * scale, frameTopW = 20 * scale
        const frameSep = 320 * scale
        const fyBase = cy + 120 * scale, fyTop = fyBase - frameH

        for (const sgn of [-1, 1]) {
          const fx = cx + sgn * frameSep / 2
          stampWire(fx - frameW, fyBase, fx - frameTopW, fyTop, 4 * scale, 'ink', 3)
          stampWire(fx + frameW, fyBase, fx + frameTopW, fyTop, 4 * scale, 'ink', 3)
          const levels = 9
          for (let i = 0; i < levels; i++) {
            const t1 = i / levels, t2 = (i + 1) / levels
            const y1 = fyBase + (fyTop - fyBase) * t1, y2 = fyBase + (fyTop - fyBase) * t2
            const w1 = frameW + (frameTopW - frameW) * t1, w2 = frameW + (frameTopW - frameW) * t2
            stampWire(fx - w1, y1, fx + w1, y1, 2.2 * scale, 'ink', 3)
            stampWire(fx - w1, y1, fx + w2, y2, 1.5 * scale, 'ink', 3)
            stampWire(fx + w1, y1, fx - w2, y2, 1.5 * scale, 'ink', 3)
          }
          stampWire(fx - frameTopW, fyTop, fx + frameTopW, fyTop, 2.5 * scale, 'ink', 3)
          stampRectE(fx - frameW - 8 * scale, fyBase, (frameW + 8 * scale) * 2, 8 * scale, 1.0, 'ink')
        }

        const busbarY = fyTop + 6 * scale
        stampWire(cx - frameSep / 2 - frameTopW, busbarY, cx + frameSep / 2 + frameTopW, busbarY, 3.5 * scale, 'ink', 3)
        const busbarY2 = fyTop + frameH * 0.35
        stampWire(cx - frameSep / 2 + frameW, busbarY2, cx + frameSep / 2 - frameW, busbarY2, 2.5 * scale, 'ink', 3)

        const platformY = cy + 50 * scale, platformW = 240 * scale
        stampRectE(cx - platformW / 2, platformY, platformW, 8 * scale, 1.0, 'ink')
        for (let i = 0; i < 5; i++) {
          const lx = cx - platformW / 2 + i * platformW / 4
          stampRectE(lx - 3 * scale, platformY + 8 * scale, 6 * scale, 40 * scale, 1.0, 'ink')
        }

        for (const sx of [cx - 80 * scale, cx, cx + 80 * scale]) {
          const sH = 80 * scale, sTop = platformY - sH
          stampWire(sx, platformY, sx, sTop, 3 * scale, 'ink', 3)
          for (let j = 1; j <= 6; j++) {
            stampWire(sx - 7 * scale, sTop + j * sH / 7, sx + 7 * scale, sTop + j * sH / 7, 1.6 * scale, 'ink', 3)
          }
          stampRectE(sx - 18 * scale, sTop - 14 * scale, 36 * scale, 14 * scale, 1.0, 'ink')
          stampRectE(sx - 22 * scale, sTop - 12 * scale, 4 * scale, 10 * scale, 1.0, 'ink')
          stampRectE(sx + 18 * scale, sTop - 12 * scale, 4 * scale, 10 * scale, 1.0, 'ink')
          stampCable(sx - 12 * scale, sTop - 14 * scale, sx - 12 * scale, busbarY, -8 * scale, 1.4 * scale, 'ink')
          stampCable(sx + 12 * scale, sTop - 14 * scale, sx + 12 * scale, busbarY, -8 * scale, 1.4 * scale, 'ink')
        }

        const tBodyY = platformY + 48 * scale, tBodyW = 180 * scale, tBodyH = 80 * scale
        stampRectE(cx - tBodyW / 2, tBodyY, tBodyW, tBodyH, 1.0, 'ink')
        for (let i = 0; i < 9; i++) {
          const fy = tBodyY + 8 * scale + i * (tBodyH - 16 * scale) / 8
          stampRectE(cx - tBodyW / 2 - 9 * scale, fy, 9 * scale, 3 * scale, 1.0, 'ink')
          stampRectE(cx + tBodyW / 2, fy, 9 * scale, 3 * scale, 1.0, 'ink')
        }
        stampRectE(cx - tBodyW / 2 - 10 * scale, tBodyY + 6 * scale, 2 * scale, tBodyH - 12 * scale, 1.0, 'ink')
        stampRectE(cx + tBodyW / 2 + 8 * scale, tBodyY + 6 * scale, 2 * scale, tBodyH - 12 * scale, 1.0, 'ink')
        for (let i = 0; i < 3; i++) {
          const bx = cx - tBodyW / 2 + 24 * scale + i * (tBodyW - 48 * scale) / 2
          const bH = 30 * scale
          stampWire(bx, tBodyY, bx, tBodyY - bH, 3 * scale, 'ink', 3)
          for (let j = 1; j <= 4; j++) {
            stampWire(bx - 5 * scale, tBodyY - j * bH / 5, bx + 5 * scale, tBodyY - j * bH / 5, 1.6 * scale, 'ink', 3)
          }
        }

        if (opts.stem !== false) {
          const cabX = cx + (opts.leafDX ?? -90) * scale * 2
          const cabY = cy + (opts.leafDY ?? 200) * scale
          const cabW = 110 * scale, cabH = 130 * scale
          stampRectE(cabX - cabW / 2, cabY - cabH / 2, cabW, cabH, 1.0, 'ink')
          stampWire(cabX, cabY - cabH / 2 + 4 * scale, cabX, cabY + cabH / 2 - 6 * scale, scale, 'ink', 3)
          for (let i = 0; i < 8; i++) {
            const sy = cabY - cabH / 2 + 8 * scale + i * (cabH - 22 * scale) / 8
            stampRectE(cabX - cabW / 2 + 5 * scale, sy, cabW - 10 * scale, 2.5 * scale, 1.0, 'ink')
          }
          stampRectE(cabX - cabW / 2 + 4 * scale, cabY + cabH / 2, 14 * scale, 6 * scale, 1.0, 'ink')
          stampRectE(cabX + cabW / 2 - 18 * scale, cabY + cabH / 2, 14 * scale, 6 * scale, 1.0, 'ink')
        }
      }

      function bigPuff(cx: number, cy: number, scale = 1) {
        const bladeLen = 260 * scale, hubR = 18 * scale
        const towerTopHalfW = 18 * scale, towerBaseHalfW = 36 * scale
        const towerH = 460 * scale, nacelleW = 88 * scale, nacelleH = 36 * scale
        const phase = -Math.PI / 2 + 0.15

        const towerTopY = cy + nacelleH / 2 + 2 * scale, towerBotY = towerTopY + towerH
        const tL_top = { x: cx - towerTopHalfW, y: towerTopY }
        const tR_top = { x: cx + towerTopHalfW, y: towerTopY }
        const tL_bot = { x: cx - towerBaseHalfW, y: towerBotY }
        const tR_bot = { x: cx + towerBaseHalfW, y: towerBotY }
        stampTriangle(tL_top, tR_top, tR_bot, 1.0, 'ink')
        stampTriangle(tL_top, tR_bot, tL_bot, 1.0, 'ink')
        stampWire(cx, towerTopY, cx, towerBotY, scale, 'inkLight', 3)
        for (const t of [0.33, 0.66]) {
          const ry = towerTopY + towerH * t
          const rHalf = towerTopHalfW + (towerBaseHalfW - towerTopHalfW) * t + 4 * scale
          stampRectE(cx - rHalf, ry, rHalf * 2, 3 * scale, 1.0, 'ink')
        }
        stampRectE(cx - towerBaseHalfW - 8 * scale, towerBotY - 6 * scale, (towerBaseHalfW + 8 * scale) * 2, 8 * scale, 1.0, 'ink')
        stampRectE(cx - nacelleW / 2, cy - nacelleH / 2, nacelleW, nacelleH, 1.0, 'ink')
        for (let i = 0; i < 4; i++) {
          stampRectE(cx + 4 * scale + i * 10 * scale, cy - 6 * scale, 5 * scale, 12 * scale, 1.0, 'ink')
        }
        stampTriangle(
          { x: cx + nacelleW / 2, y: cy - nacelleH / 2 + 2 * scale },
          { x: cx + nacelleW / 2, y: cy + nacelleH / 2 - 2 * scale },
          { x: cx + nacelleW / 2 + 16 * scale, y: cy },
          1.0, 'ink'
        )

        for (let i = 0; i < 3; i++) {
          const a = phase + i * Math.PI * 2 / 3
          const cosA = Math.cos(a), sinA = Math.sin(a)
          const perpX = -sinA, perpY = cosA
          const rootX = cx + cosA * (hubR + 1), rootY = cy + sinA * (hubR + 1)
          const tipX = cx + cosA * bladeLen, tipY = cy + sinA * bladeLen
          const rootW = 14 * scale, tipW = 3 * scale
          const rootL = { x: rootX + perpX * rootW, y: rootY + perpY * rootW }
          const rootR = { x: rootX - perpX * rootW, y: rootY - perpY * rootW }
          const tipL = { x: tipX + perpX * tipW, y: tipY + perpY * tipW }
          const tipR = { x: tipX - perpX * tipW, y: tipY - perpY * tipW }
          stampTriangle(rootL, rootR, tipR, 1.0, 'ink')
          stampTriangle(rootL, tipR, tipL, 1.0, 'ink')
          stampWire(rootX, rootY, tipX, tipY, 0.6 * scale, 'inkLight', 3)
        }
        stampDisc(cx, cy, hubR, 1.0, 'ink')
        stampDisc(cx, cy, hubR * 0.45, 1.0, 'redLight')
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI * 2 / 8
          stampDisc(cx + Math.cos(a) * hubR * 0.7, cy + Math.sin(a) * hubR * 0.7, 1.4 * scale, 1.0, 'yellow')
        }
      }

      const PAD = 200
      const compositions = [
        { kind: 'bigLeaf', x: PAD + 200, y: ART_H * 0.50, scale: 1.6 },
        { kind: 'bigFlower', x: PAD + 1100, y: ART_H * 0.55, scale: 1.4, opts: { petalCount: 5, baseAngle: -Math.PI / 2, spread: Math.PI * 1.1 } },
        { kind: 'bigPuff', x: PAD + 2050, y: ART_H * 0.38, scale: 1.5 },
        { kind: 'bigLeaf', x: ART_W - VIEW_W - 600, y: ART_H * 0.50, scale: 1.6 },
        { kind: 'cityLights', x: ART_W - VIEW_W - 480, y: ART_H * 0.50, scale: 1.0 },
      ]

      const ambientCount = Math.floor(COLS * ROWS * 0.018)
      const waferRegionX = ART_W - VIEW_W
      for (let i = 0; i < ambientCount; i++) {
        const gx = Math.floor(rand() * COLS), gy = Math.floor(rand() * ROWS)
        if (gx * CELL >= waferRegionX) continue
        if (grid[gy * COLS + gx]) continue
        const r = rand()
        const color = r < 0.78 ? 'ink' : r < 0.88 ? 'inkLight' : r < 0.95 ? 'yellow' : 'red'
        setCell(gx, gy, 0.4 + rand() * 0.25, color, 3)
      }

      for (const c of compositions) {
        if (c.kind === 'bigFlower') bigFlower(c.x, c.y, c.scale, c.opts || {})
        else if (c.kind === 'bigLeaf') bigLeaf(c.x, c.y, c.scale)
        else if (c.kind === 'bigPuff') bigPuff(c.x, c.y, c.scale)
        else if (c.kind === 'cityLights') bigCityLights(c.x, c.y, c.scale)
      }

      type FilledCell = { i: number; appearT: number; gx: number; gy: number }
      const filled: FilledCell[] = []
      for (let i = 0; i < grid.length; i++) {
        if (!grid[i]) continue
        const gx = i % COLS, gy = (i / COLS) | 0
        const cellX = gx * CELL + CELL / 2
        let appearT: number
        if (cellX <= VIEW_W / 2) {
          appearT = rand() * INITIAL_PHASE
        } else {
          const p = (cellX - VIEW_W / 2) / panMaxStatic
          const u = Math.sqrt(Math.min(1.0, Math.max(0, p)))
          appearT = PAN_START + u * (PAN_END - PAN_START)
          if (p > 1) appearT = Math.min(PAN_END - 0.02, appearT - 0.02)
        }
        appearT += (rand() - 0.5) * 0.07
        appearT += grid[i]!.v * 0.015
        appearT = Math.max(0, Math.min(0.99, appearT))
        grid[i]!.appearT = appearT
        filled.push({ i, appearT, gx, gy })
      }
      filled.sort((a, b) => a.appearT - b.appearT)

      const canvas = document.getElementById('art') as HTMLCanvasElement
      const ctx = canvas.getContext('2d')!

      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = ART_W * dpr
      canvas.height = ART_H * dpr
      canvas.style.width = ART_W + 'px'
      canvas.style.height = ART_H + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      function colorFor(key: string) { return COLORS[key] || COLORS.ink }

      const phasePool = new Float32Array(filled.length)
      const shapePool = new Uint8Array(filled.length)
      const secColorPool = new Uint8Array(filled.length)
      const sizePool = new Float32Array(filled.length)

      for (let k = 0; k < filled.length; k++) {
        phasePool[k] = rand()
        const r = rand()
        shapePool[k] = r < 0.34 ? 0 : r < 0.62 ? 1 : r < 0.74 ? 2 : r < 0.84 ? 3 : r < 0.93 ? 4 : 5
        secColorPool[k] = Math.floor(rand() * ACCENT_KEYS.length)
        const s = rand()
        sizePool[k] = s < 0.32 ? 0.55 + rand() * 0.20 : s < 0.58 ? 0.78 + rand() * 0.12 : 0.92 + rand() * 0.08
      }

      const SHIMMER_SPEED = 0.18

      function drawDot(x: number, y: number, size: number, primary: string, secondary: string, shape: number) {
        const half = size / 2, left = x - half, top = y - half
        if (shape === 2) {
          ctx.fillStyle = primary; ctx.fillRect(left, top, size, half)
          ctx.fillStyle = secondary; ctx.fillRect(left, top + half, size, half)
        } else if (shape === 3) {
          ctx.fillStyle = primary; ctx.fillRect(left, top, half, size)
          ctx.fillStyle = secondary; ctx.fillRect(left + half, top, half, size)
        } else if (shape === 4) {
          ctx.fillStyle = primary; ctx.fillRect(left, top, size, size)
          const inset = Math.max(0.6, size * 0.26), inner = size - inset * 2
          if (inner > 0.5) { ctx.fillStyle = secondary; ctx.fillRect(left + inset, top + inset, inner, inner) }
        } else if (shape === 5) {
          ctx.fillStyle = secondary; ctx.fillRect(left, top, size, size)
          const inset = Math.max(0.6, size * 0.22), inner = size - inset * 2
          if (inner > 0.5) { ctx.fillStyle = primary; ctx.fillRect(left + inset, top + inset, inner, inner) }
        } else if (shape === 1) {
          const inset = Math.max(0.4, size * 0.20), inner = size - inset * 2
          if (inner > 0.5) { ctx.fillStyle = primary; ctx.fillRect(left + inset, top + inset, inner, inner) }
        } else {
          ctx.fillStyle = primary; ctx.fillRect(left, top, size, size)
        }
      }

      function render(t: number, shimmerT: number) {
        ctx.fillStyle = COLORS.bg
        ctx.fillRect(0, 0, ART_W, ART_H)
        for (let k = 0; k < filled.length; k++) {
          const at = filled[k].appearT, startT = at - LEAD
          if (startT > t) break
          const cell = grid[filled[k].i]
          if (!cell) continue
          const fade = t >= at ? 1 : (t - startT) / LEAD
          const px = filled[k].gx * CELL + CELL / 2
          const py = filled[k].gy * CELL + CELL / 2
          const baseSize = Math.max(1.2, cell.v * (CELL - 0.5))
          const size = baseSize * sizePool[k] * Math.max(0.35, fade)

          let primaryKey = cell.c
          if (primaryKey === 'ink') {
            const phase = (phasePool[k] + shimmerT) % 1
            if (phase < 0.78) primaryKey = 'ink'
            else if (phase < 0.86) primaryKey = 'inkLight'
            else if (phase < 0.92) primaryKey = 'yellow'
            else if (phase < 0.97) primaryKey = 'red'
            else primaryKey = 'green'
          }
          const primary = colorFor(primaryKey)
          let secondaryKey = ACCENT_KEYS[secColorPool[k]]
          if (secondaryKey === primaryKey)
            secondaryKey = ACCENT_KEYS[(secColorPool[k] + 2) % ACCENT_KEYS.length]
          const sPhase = (phasePool[k] * 1.31 + shimmerT * 0.7) % 1
          if (sPhase > 0.9)
            secondaryKey = ACCENT_KEYS[(secColorPool[k] + 3) % ACCENT_KEYS.length]
          drawDot(px, py, size, primary, colorFor(secondaryKey), shapePool[k])
        }
      }

      const cursorEl = document.getElementById('cursor')!
      const logoEl = document.getElementById('logo')!
      const markEl = logoEl.querySelector('.mark') as HTMLImageElement
      const letterEls = Array.from(logoEl.querySelectorAll('.word span')) as HTMLElement[]
      const footerEl = document.querySelector('.launch-footer') as HTMLElement

      let timelineT = 0
      let lastTickTs = performance.now()
      let shimmerPhase = 0
      let finished = false

      function frame(nowTs: number) {
        const dt = (nowTs - lastTickTs) / 1000
        lastTickTs = nowTs
        timelineT = Math.min(1, timelineT + dt / TOTAL_DURATION)

        if (timelineT >= 1 && !finished) {
          finished = true
          footerEl.classList.add('visible')
        }

        let shimmerMult: number
        if (timelineT < SETTLE_START) shimmerMult = 1
        else if (timelineT >= SETTLE_END) shimmerMult = 0
        else shimmerMult = 1 - (timelineT - SETTLE_START) / (SETTLE_END - SETTLE_START)
        shimmerPhase += dt * SHIMMER_SPEED * shimmerMult

        update(timelineT, shimmerPhase)
        rafId = requestAnimationFrame(frame)
      }

      function update(t: number, shimmerT: number) {
        let panU = (t - PAN_START) / (PAN_END - PAN_START)
        panU = Math.max(0, Math.min(1, panU))
        const panX = (panU * panU) * panMaxStatic

        render(t, shimmerT)
        canvas.style.transform = `translate(${-panX}px, 0)`

        const logoLocal = (t - LOGO_START) / (LOGO_END - LOGO_START)
        const markPhaseEnd = 0.22
        let markA = logoLocal <= 0 ? 0 : logoLocal >= markPhaseEnd ? 1 : logoLocal / markPhaseEnd
        markA = 1 - Math.pow(1 - markA, 2)
        markEl.style.opacity = markA.toFixed(3)
        markEl.style.transform = `translateY(${((1 - markA) * 6).toFixed(2)}px) scale(${(0.9 + 0.1 * markA).toFixed(3)})`

        const lettersLocal = (logoLocal - markPhaseEnd) / (1 - markPhaseEnd)
        const n = letterEls.length, stagger = 1 / n, perLetterDur = stagger * 1.6
        let visibleCount = 0
        for (let i = 0; i < n; i++) {
          const lt = lettersLocal - i * stagger
          const a = lt <= 0 ? 0 : lt >= perLetterDur ? 1 : lt / perLetterDur
          letterEls[i].style.opacity = a.toFixed(3)
          letterEls[i].style.transform = `translateY(${((1 - a) * 3).toFixed(2)}px)`
          if (a > 0.5) visibleCount = i + 1
        }

        const CURSOR_HOLD = 0.04
        const cursorActiveStart = LOGO_START + (LOGO_END - LOGO_START) * markPhaseEnd - 0.01
        if (t >= cursorActiveStart && t < LOGO_END + CURSOR_HOLD) {
          const idx = Math.min(letterEls.length - 1, Math.max(0, visibleCount - 1))
          const ref = visibleCount === 0
            ? letterEls[0].getBoundingClientRect()
            : letterEls[idx].getBoundingClientRect()
          const cx = visibleCount === 0 ? ref.left - 6 : ref.right + 1
          const cy = ref.bottom - 4
          cursorEl.style.opacity = '1'
          cursorEl.style.transform = `translate(${cx}px, ${cy}px)`
        } else {
          cursorEl.style.opacity = '0'
        }
      }

      rafId = requestAnimationFrame(frame)
    })()

    return () => {
      cancelAnimationFrame(rafId)
      document.documentElement.style.height = ''
      document.body.style.height = ''
      document.body.style.overflow = ''
      document.body.style.background = ''
    }
  }, [])

  return (
    <>
      <div id="stage">
        <canvas id="art" />
        <div id="cursor" />
        <div id="logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="mark" src="/spi-mark-filled.png" alt="Steinmetz mark" />
          <div className="word">
            {'Steinmetz'.split('').map((c, i) => <span key={i}>{c}</span>)}
          </div>
        </div>
      </div>
      <footer className="launch-footer">
        Steinmetz Power Infrastructure &copy; 2026
        &ensp;&middot;&ensp;
        <a href="/launch/demo">Grid Planning Demo &rarr;</a>
      </footer>
    </>
  )
}

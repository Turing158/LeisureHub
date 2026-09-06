/**
 * 只接受 #RGB / #RGBA / #RRGGBB / #RRGGBBAA。
 *
 * 颜色值会被直接传给 background / color 等 CSS 属性，必须挡住任意字符串，
 * 否则 localStorage 里被改过的脏数据就能注入样式。
 * 背景设置与方格底色共用这一处校验。
 *
 * 放行 4 / 8 位带 alpha 的写法，是为了让编辑对话框里的颜色能配成透明：
 * 原生取色器选不出透明度，自研的取色面板（ColorPicker）产出 #RRGGBBAA，
 * 必须能通过这里才能在整条渲染链里落位。
 */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)
}

/** 全透明档：RGB 随意取 0，只有 alpha 有意义 */
export const TRANSPARENT_HEX = '#00000000'

/**
 * 规范化成 8 位小写 hex；不合法返回 null。
 *
 * 取色器收到 legacy 6 位存档时需要把缺失的 alpha 补成不透明，这里集中处理。
 */
export function normalizeHex(value: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value)
  if (!m) return null
  const hex = m[1]
  if (hex.length === 3) return `#${[...hex].map((ch) => ch + ch).join('')}ff`
  if (hex.length === 4) return `#${[...hex].map((ch) => ch + ch).join('')}`
  if (hex.length === 6) return `#${hex}ff`
  return `#${hex}`
}

/** alpha 通道取值 0..255；非法 hex 一律按完全不透明计 */
export function hexToAlpha(value: string): number {
  const norm = normalizeHex(value)
  return norm ? Number.parseInt(norm.slice(7, 9), 16) : 255
}

/** 改写 alpha（0..255），返回 8 位 hex */
export function alphaToHex(value: string, alpha: number): string {
  const norm = normalizeHex(value) ?? TRANSPARENT_HEX
  const byte = Math.max(0, Math.min(255, Math.round(alpha)))
  return `${norm.slice(0, 7)}${byte.toString(16).padStart(2, '0')}`
}

/** 取色面板的内部颜色模型：HSVA，alpha 用 0..1 */
export interface Hsva {
  h: number // 0..360
  s: number // 0..1
  v: number // 0..1
  a: number // 0..1
}

/** 把规范化的 hex 解成 RGB 三通道 0..255 */
function hexToRgb(norm: string): [number, number, number] {
  const r = Number.parseInt(norm.slice(1, 3), 16)
  const g = Number.parseInt(norm.slice(3, 5), 16)
  const b = Number.parseInt(norm.slice(5, 7), 16)
  return [r, g, b]
}

/** 从 8 位（或兼容 6 位）hex 解码成 HSVA；非法值回落到中性灰 */
export function hexToHsva(value: string): Hsva {
  const norm = normalizeHex(value)
  if (!norm) return { h: 0, s: 0, v: 0.5, a: 1 }
  const [r, g, b] = hexToRgb(norm)

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const v = max / 255

  let h = 0
  if (d !== 0) {
    switch (max) {
      case r:
        h = ((g - b) / d) % 6
        break
      case g:
        h = (b - r) / d + 2
        break
      default:
        h = (r - g) / d + 4
    }
    h *= 60
    if (h < 0) h += 360
  }

  const s = max === 0 ? 0 : d / max
  const a = hexToAlpha(value) / 255
  return { h, s, v, a }
}

/** 由 HSVA 编码 8 位 hex */
export function hsvaToHex(h: number, s: number, v: number, a: number): string {
  const hue = ((h % 360) + 360) % 360
  const sat = Math.max(0, Math.min(1, s))
  const val = Math.max(0, Math.min(1, v))
  const alpha = Math.max(0, Math.min(1, a))

  const c = val * sat
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = val - c
  let r = 0
  let g = 0
  let b = 0
  if (hue < 60) [r, g, b] = [c, x, 0]
  else if (hue < 120) [r, g, b] = [x, c, 0]
  else if (hue < 180) [r, g, b] = [0, c, x]
  else if (hue < 240) [r, g, b] = [0, x, c]
  else if (hue < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]

  const toByte = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0')
  const alphaByte = Math.round(alpha * 255).toString(16).padStart(2, '0')
  return `#${toByte(r)}${toByte(g)}${toByte(b)}${alphaByte}`
}
import { computed, ref } from 'vue'

/** 方格边长固定值，与 style.css 的 --tile-size 保持一致 */
export const TILE_SIZE = 75

/** 读取根元素上的像素令牌，避免布局常量在 JS 与 CSS 两处各写一份 */
function readPx(name: string, fallback: number) {
  if (typeof window === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name)
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : fallback
}

/*
 * 当前画面留给方块区域的空间，模块级单例。
 *
 * 只有 TileGrid 能量到它（外层容器扣掉内边距），但设置抽屉里的
 * 「按当前画面」也要用同一份数字。做成模块级状态而不是把测量逻辑
 * 复制一遍到抽屉里：抽屉是浮层，它自己的盒子跟方块区域毫无关系，
 * 各测一次必然得出两个不同的「当前画面」。
 */
const availW = ref(0)
const availH = ref(0)

export function setAvailableArea(width: number, height: number) {
  availW.value = width
  availH.value = height
}

/** 布局常量与单元格尺寸；--gap 等令牌变了这里跟着变 */
export const gridGeometry = computed(() => {
  const gap = readPx('--gap', 20)
  const labelGap = readPx('--label-gap', 8)
  const labelHeight = readPx('--label-height', 18)
  return {
    gap,
    cellW: TILE_SIZE,
    /** 单元格 = 方格 + 名称行 */
    cellH: TILE_SIZE + labelGap + labelHeight,
  }
})

/** n 个单元格占 n * cell + (n - 1) * gap，反解得到 n */
export function fitCount(space: number, cell: number, gap: number) {
  return Math.floor((space + gap) / (cell + gap))
}

/** n 个单元格实际占多少像素，与 fitCount 互为逆运算 */
export function cellExtent(count: number, cell: number, gap: number) {
  return count <= 0 ? 0 : count * cell + (count - 1) * gap
}

/**
 * 当前画面能放下多少格 / 有多大。
 *
 * 与「最终生效的行列数」刻意分开：这一份恒定反映可用空间，
 * 不受用户已填的固定尺寸影响，否则「按当前画面」会把已经缩小过的
 * 尺寸再填回去，越点越小。
 */
export const autoFit = computed(() => {
  const { gap, cellW, cellH } = gridGeometry.value
  return {
    cols: Math.max(1, fitCount(availW.value, cellW, gap)),
    rows: Math.max(1, fitCount(availH.value, cellH, gap)),
    width: Math.round(availW.value),
    height: Math.round(availH.value),
    ready: availW.value > 0 && availH.value > 0,
  }
})

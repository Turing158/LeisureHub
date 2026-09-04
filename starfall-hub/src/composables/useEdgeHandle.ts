import { computed, ref } from 'vue'

import { useSettingsStore, type DrawerSide } from '@/stores/settings'

/** 手柄停靠侧就是抽屉停靠侧，两者共用设置里的同一个值 */
export type Edge = DrawerSide

const STORAGE_KEY = 'starfall-hub:settings-handle'
/** 位移超过该阈值才算拖拽，未超过的按点击处理 */
const DRAG_THRESHOLD = 5
/** 沿边线方向的停靠留白，避免手柄贴到屏幕角落 */
const EDGE_INSET = 0.08

const DEFAULT_RATIO = 0.5

function clampRatio(value: number) {
  return Math.min(1 - EDGE_INSET, Math.max(EDGE_INSET, value))
}

/** 只有纵向比例存在这里；停靠侧归设置 store，两处都能改它 */
function loadRatio(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_RATIO

    const parsed = JSON.parse(raw) as { ratio?: number }
    return Number.isFinite(parsed?.ratio) ? clampRatio(parsed.ratio as number) : DEFAULT_RATIO
  } catch {
    return DEFAULT_RATIO
  }
}

/**
 * 手柄的纵向位置，**模块级**。
 *
 * 提到模块级是为了让「重置为默认」能改到它：设置抽屉里那个按钮拿不到
 * SettingsHandle 组件内部的 ref，而停靠侧（归 settings store）已经会被重置——
 * 只重置左右不重置高度，会出现「手柄跳回右边但仍停在上次拖到的高度」。
 *
 * 组件里只有一处调用，所以提出来没有任何行为变化；这也与 useTodos /
 * useSearchHistory 的模块级共享同一手法。
 */
const ratio = ref(loadRatio())

function persistRatio() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ratio: ratio.value }))
  } catch {
    // 存储不可用（隐私模式 / 配额）时静默降级为内存状态
  }
}

/** 重置纵向位置，供设置里的「重置为默认」调用；停靠侧由 settings.reset 一并管 */
export function resetEdgeHandle() {
  ratio.value = DEFAULT_RATIO
  persistRatio()
}

export function useEdgeHandle() {
  const settings = useSettingsStore()

  const isDragging = ref(false)

  /** 停靠侧是设置项，拖动手柄与抽屉里的切换器改的是同一个值 */
  const edge = computed<Edge>(() => settings.drawerSide)

  let startX = 0
  let startY = 0
  let activeEl: HTMLElement | null = null
  let activePointerId: number | null = null
  let pendingEvent: PointerEvent | null = null
  let rafId: number | null = null
  /** 拖拽结束后紧随的原生 click 需要被丢弃，否则松手即打开抽屉 */
  let dragged = false

  /** 只停靠左右两边：横向取较近的一侧，纵向位置直接跟随指针 */
  function follow(clientX: number, clientY: number) {
    const width = window.innerWidth || 1
    const height = window.innerHeight || 1

    settings.setDrawerSide(clientX <= width / 2 ? 'left' : 'right')
    ratio.value = clampRatio(clientY / height)
  }

  function release() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    if (activeEl && activePointerId !== null && activeEl.hasPointerCapture(activePointerId)) {
      activeEl.releasePointerCapture(activePointerId)
    }
    pendingEvent = null
    activeEl = null
    activePointerId = null
    isDragging.value = false
  }

  function flushMove() {
    rafId = null
    const event = pendingEvent
    pendingEvent = null
    if (!event || !isDragging.value) return
    follow(event.clientX, event.clientY)
  }

  function onPointerDown(event: PointerEvent) {
    // 只响应主键，避免右键 / 中键误触发
    if (event.button !== 0) return

    dragged = false
    startX = event.clientX
    startY = event.clientY
    activeEl = event.currentTarget as HTMLElement
    activePointerId = event.pointerId
    activeEl.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: PointerEvent) {
    if (activePointerId === null || event.pointerId !== activePointerId) return

    if (!isDragging.value) {
      const moved = Math.hypot(event.clientX - startX, event.clientY - startY)
      if (moved <= DRAG_THRESHOLD) return
      isDragging.value = true
      dragged = true
    }

    pendingEvent = event
    if (rafId === null) rafId = requestAnimationFrame(flushMove)
  }

  function onPointerUp(event: PointerEvent) {
    if (activePointerId === null || event.pointerId !== activePointerId) return

    const wasDragging = isDragging.value
    // 最后一帧可能还在等 rAF，直接按松手位置定位，避免停在上一帧的边
    if (wasDragging) follow(event.clientX, event.clientY)
    release()
    if (wasDragging) persistRatio()
  }

  function onPointerCancel() {
    release()
  }

  /** 返回 true 表示这次 click 来自拖拽收尾，调用方应忽略 */
  function consumeClick() {
    if (!dragged) return false
    dragged = false
    return true
  }

  return {
    edge,
    ratio,
    isDragging,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    consumeClick,
  }
}

import { computed, ref } from 'vue'

import { useSettingsStore, type DrawerSide } from '@/stores/settings'

/** 手柄停靠侧就是抽屉停靠侧，两者共用设置里的同一个值 */
export type Edge = DrawerSide

/** 位移超过该阈值才算拖拽，未超过的按点击处理 */
const DRAG_THRESHOLD = 5

/**
 * 手柄的位置**整个归 settings store**（纵向比例 handleRatio + 停靠侧 drawerSide）。
 *
 * 这里曾有一个模块级 `ratio` ref、一份独占存档 `starfall-hub:settings-handle`、
 * 一个 `loadRatio()` 与一个 `resetEdgeHandle()`。搬走它们各有理由：
 *
 * - 那份 `loadRatio()` 是全项目唯一在**模块求值时**读存档的地方。多配置档之后
 *   存档键带 `@<档位 id>` 后缀，而档位索引要等第一次 keyFor / activePreset 才
 *   自初始化——模块求值期读盘会拼出一个指向错档的键（更早的版本里甚至读不到）。
 *   并进 settings 之后，「按档的键一律在 store setup 里读」这条纪律没有例外。
 * - 存档从六份降到五份，「重置为默认」也少一处要记得调的函数（resetEdgeHandle
 *   已删除，手柄高度由 settings.reset() 一并回正中）。
 *
 * 于是这个 composable 只剩指针手势本身：它没有任何自己的持久化状态。
 */
function clampToUnit(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5
}

export function useEdgeHandle() {
  const settings = useSettingsStore()

  const isDragging = ref(false)

  /** 停靠侧是设置项，拖动手柄与抽屉里的切换器改的是同一个值 */
  const edge = computed<Edge>(() => settings.drawerSide)
  /**
   * 纵向比例，只读转发。
   *
   * 消费方（SettingsHandle）用法不变（`handle.ratio`），但写入一律经
   * settings.setHandleRatio——两端留白的夹取在那里，见它的注释。
   */
  const ratio = computed<number>(() => settings.handleRatio)

  let startX = 0
  let startY = 0
  let activeEl: HTMLElement | null = null
  let activePointerId: number | null = null
  let pendingEvent: PointerEvent | null = null
  let rafId: number | null = null
  /** 拖拽结束后紧随的原生 click 需要被丢弃，否则松手即打开抽屉 */
  let dragged = false

  /**
   * 只停靠左右两边：横向取较近的一侧，纵向位置直接跟随指针。
   *
   * 两个值都写进 store，于是持久化由 settings 那个 persist watch 负责——
   * 不再需要在 pointerup 里手动调一次 persistRatio。代价是拖拽期间逐帧写 ref，
   * 但 follow 本身已经被 rAF 节流（见 flushMove），每帧最多一次。
   */
  function follow(clientX: number, clientY: number) {
    const width = window.innerWidth || 1
    const height = window.innerHeight || 1

    settings.setDrawerSide(clientX <= width / 2 ? 'left' : 'right')
    settings.setHandleRatio(clampToUnit(clientY / height))
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

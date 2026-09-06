import { onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'

import type { ProfilePreset } from '@/types/profile'

/** 菜单项图标名，对应 ContextMenu.vue 内置的 SVG 集合 */
export type MenuIcon = 'add' | 'edit' | 'delete' | 'refresh' | 'settings'

export interface MenuItem {
  /** 选中后回传给调用方的标识 */
  id: string
  label: string
  icon?: MenuIcon
  /** 危险动作：标红显示 */
  danger?: boolean
  /** 在该项之前画一条分隔线 */
  separatorBefore?: boolean
}

/**
 * 右键命中解析：由调用方决定这次右键该给出哪些菜单项。
 * 返回空数组或 null 表示此处不展示菜单（放行浏览器原生菜单）。
 */
type TriggerEvent = MouseEvent | PointerEvent
type Resolver = (event: TriggerEvent) => MenuItem[] | null

/** 手机长按判定时长；短按仍然保留方块自身的点击语义 */
const MOBILE_LONG_PRESS_MS = 450
const TOUCH_CANCEL_THRESHOLD = 5

interface ContextMenuOptions {
  /** 配置档类型；手机档用触摸长按后松开打开菜单 */
  preset?: ProfilePreset
}

/** 有 aria-modal 面板在场时不弹菜单：Dialog / 抽屉自身的操作优先 */
function hasModalOpen() {
  return document.querySelector('[aria-modal="true"]') !== null
}

/**
 * 全局右键菜单状态。
 *
 * 监听挂在 window 上而非某个容器：桌面上「空白处」包含网格之外的一切区域，
 * 容器级监听会在边缘手柄、页面留白等位置漏掉。
 */
export function useContextMenu(resolve: Resolver, options: ContextMenuOptions = {}) {
  const preset = options.preset ?? 'desktop'
  const isMobile = preset === 'mobile'
  const open = ref(false)
  /** 触发点的视口坐标，翻转与夹取由 ContextMenu 自己按实测尺寸完成 */
  const x = ref(0)
  const y = ref(0)
  const items = shallowRef<MenuItem[]>([])

  /** 关闭后把焦点还回右键前的元素，键盘用户不会被丢到文档开头 */
  let restoreTarget: HTMLElement | null = null

  /** 手机长按候选；菜单在松手时才打开，以便长按后移动可以进入拖拽 */
  let touchPointerId: number | null = null
  let touchStartX = 0
  let touchStartY = 0
  let touchMoved = false
  let touchDownAt = 0
  let touchFeedbackTimer: number | null = null
  const pressFeedback = reactive({
    x: 0,
    y: 0,
    visible: false,
    ready: false,
  })

  function hidePressFeedback() {
    if (touchFeedbackTimer !== null) {
      clearTimeout(touchFeedbackTimer)
      touchFeedbackTimer = null
    }
    pressFeedback.visible = false
    pressFeedback.ready = false
  }

  function clearTouchCandidate(keepFeedback = false) {
    if (touchFeedbackTimer !== null) {
      clearTimeout(touchFeedbackTimer)
      touchFeedbackTimer = null
    }
    touchPointerId = null
    touchMoved = false
    if (!keepFeedback) hidePressFeedback()
  }

  function close() {
    if (!open.value) return
    open.value = false
    items.value = []
    hidePressFeedback()
    restoreTarget?.focus()
    restoreTarget = null
  }

  function openFromEvent(event: TriggerEvent) {
    const next = resolve(event)
    if (!next || next.length === 0) {
      close()
      return
    }

    event.preventDefault()

    // 已打开时直接换位置与内容，不闪一次关闭
    if (!open.value) restoreTarget = document.activeElement as HTMLElement | null
    x.value = event.clientX
    y.value = event.clientY
    items.value = next
    open.value = true
  }

  function onContextMenu(event: MouseEvent) {
    // 菜单自身上的右键：留住菜单，也不要弹出原生菜单
    if ((event.target as HTMLElement | null)?.closest('[data-context-menu]')) {
      event.preventDefault()
      return
    }

    if (hasModalOpen()) {
      close()
      return
    }

    // 手机长按由 pointerup 统一处理；浏览器随后派发的 contextmenu 只需拦掉。
    // 外接鼠标的真实右键仍然保留电脑式菜单行为。
    if (isMobile && event.button !== 2) {
      if ((event.target as HTMLElement | null)?.closest('[data-native-menu]')) return
      event.preventDefault()
      return
    }

    openFromEvent(event)
  }

  function onPointerDown(event: PointerEvent) {
    if (!isMobile || event.pointerType !== 'touch' || open.value || hasModalOpen()) return
    if ((event.target as HTMLElement | null)?.closest('[data-context-menu]')) return
    if ((event.target as HTMLElement | null)?.closest('[data-native-menu]')) return

    touchPointerId = event.pointerId
    touchStartX = event.clientX
    touchStartY = event.clientY
    touchMoved = false
    touchDownAt = performance.now()
    pressFeedback.x = event.clientX
    pressFeedback.y = event.clientY
    pressFeedback.visible = true
    pressFeedback.ready = false
    touchFeedbackTimer = window.setTimeout(() => {
      if (touchPointerId !== event.pointerId || touchMoved) return
      pressFeedback.ready = true
      try {
        navigator.vibrate?.(10)
      } catch {
        // 部分浏览器会拒绝非顶层文档的震动请求，视觉反馈仍然有效。
      }
    }, MOBILE_LONG_PRESS_MS)
  }

  function onPointerMove(event: PointerEvent) {
    if (touchPointerId === null || event.pointerId !== touchPointerId) return
    if (Math.hypot(event.clientX - touchStartX, event.clientY - touchStartY) > TOUCH_CANCEL_THRESHOLD) {
      touchMoved = true
      clearTouchCandidate()
    }
  }

  function onPointerUp(event: PointerEvent) {
    if (touchPointerId === null || event.pointerId !== touchPointerId) return

    const elapsed = performance.now() - touchDownAt
    const shouldOpen = !touchMoved && elapsed >= MOBILE_LONG_PRESS_MS

    if (!shouldOpen) {
      clearTouchCandidate()
      return
    }
    if (hasModalOpen() || (event.target as HTMLElement | null)?.closest('[data-native-menu]')) {
      clearTouchCandidate()
      return
    }

    // 阻止后续 click，useDragSort 会看到 defaultPrevented 并结束 pending 状态。
    event.preventDefault()
    openFromEvent(event)
    clearTouchCandidate(true)
    window.setTimeout(hidePressFeedback, 140)
  }

  function onPointerCancel(event: PointerEvent) {
    if (touchPointerId === event.pointerId) clearTouchCandidate()
  }

  onMounted(() => window.addEventListener('contextmenu', onContextMenu))
  onMounted(() => {
    if (!isMobile) return
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerCancel, true)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('contextmenu', onContextMenu)
    if (!isMobile) return
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('pointermove', onPointerMove, true)
    window.removeEventListener('pointerup', onPointerUp, true)
    window.removeEventListener('pointercancel', onPointerCancel, true)
    hidePressFeedback()
  })

  return { open, x, y, items, close, pressFeedback }
}

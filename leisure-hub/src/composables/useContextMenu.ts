import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'

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
type Resolver = (event: MouseEvent) => MenuItem[] | null

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
export function useContextMenu(resolve: Resolver) {
  const open = ref(false)
  /** 触发点的视口坐标，翻转与夹取由 ContextMenu 自己按实测尺寸完成 */
  const x = ref(0)
  const y = ref(0)
  const items = shallowRef<MenuItem[]>([])

  /** 关闭后把焦点还回右键前的元素，键盘用户不会被丢到文档开头 */
  let restoreTarget: HTMLElement | null = null

  function close() {
    if (!open.value) return
    open.value = false
    items.value = []
    restoreTarget?.focus()
    restoreTarget = null
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

  onMounted(() => window.addEventListener('contextmenu', onContextMenu))
  onBeforeUnmount(() => window.removeEventListener('contextmenu', onContextMenu))

  return { open, x, y, items, close }
}

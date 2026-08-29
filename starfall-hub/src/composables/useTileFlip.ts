import { nextTick, type Ref } from 'vue'

import { MOTION_BASE_MS, motionDisabled, motionEasing } from '@/utils/motion'

/** 位移小于该像素数视为没动，不值得为它起一个动画 */
const MIN_SHIFT = 1

/**
 * 方块换位的 FLIP 过渡。
 *
 * 网格用显式 grid-column / grid-row 定位，槽位一变位置就是瞬移；
 * 被换走 / 被挤走的方块因此会「闪现」在新位置，看不出它去了哪里。
 *
 * 做法是提交数据前记下每个方块的视口矩形，提交后等 DOM 落定再测一次，
 * 用 transform 把它先拉回旧位置再放开——元素始终在自己的最终槽位里，
 * 布局不受动画影响，与拖拽浮层的飞行是同一套观感。
 *
 * 按 tile.id 而不是槽位下标配对：换位后同一个方块的下标必然变了，
 * 用下标配对得到的是「这一格前后是谁」，恰好是我们不想要的那层含义。
 */
export function useTileFlip(container: Ref<HTMLElement | null>) {
  let before: Map<string, DOMRect> | null = null
  let running: Animation[] = []

  function measure(): Map<string, DOMRect> {
    const map = new Map<string, DOMRect>()
    const root = container.value
    if (!root) return map
    for (const el of root.querySelectorAll<HTMLElement>('[data-tile-id]')) {
      const id = el.dataset.tileId
      if (id) map.set(id, el.getBoundingClientRect())
    }
    return map
  }

  /** 提交数据前调用；关闭动效时不必测量 */
  function capture() {
    before = motionDisabled() ? null : measure()
  }

  /**
   * 提交数据后调用，播放位移过渡。
   *
   * skipIds 用于排除已有其它动画负责的方块——被拖动的那个由浮层飞过去，
   * 这里再补一份 transform 就是两个动画叠在同一个元素上。
   */
  async function play(skipIds: Iterable<string> = []) {
    const prev = before
    before = null
    if (!prev) return

    // 旧动画未跑完就被再次换位：取消而不是叠加，否则 transform 会互相打断成抖动
    for (const anim of running) anim.cancel()
    running = []

    await nextTick()
    if (motionDisabled()) return

    const skip = new Set(skipIds)
    const easing = motionEasing()
    const root = container.value
    if (!root) return

    for (const el of root.querySelectorAll<HTMLElement>('[data-tile-id]')) {
      const id = el.dataset.tileId
      if (!id || skip.has(id)) continue
      const from = prev.get(id)
      if (!from) continue

      const to = el.getBoundingClientRect()
      const dx = from.left - to.left
      const dy = from.top - to.top
      if (Math.abs(dx) < MIN_SHIFT && Math.abs(dy) < MIN_SHIFT) continue

      running.push(
        el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          { duration: MOTION_BASE_MS, easing },
        ),
      )
    }
  }

  return { capture, play }
}

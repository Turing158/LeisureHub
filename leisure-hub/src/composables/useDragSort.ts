import { computed, ref } from 'vue'

import type { ProfilePreset } from '@/types/profile'
import { MOTION_BASE_MS, motionDisabled } from '@/utils/motion'

/** 位移超过该阈值才算拖拽；未超过的 pointerup 判定为点击 */
const DRAG_THRESHOLD = 5

/** 手机档需要先长按，之后移动才进入拖拽 */
const MOBILE_LONG_PRESS_MS = 450

/** 拖拽期间浮层的放大比例 */
const DRAG_SCALE = 1.06

type DragPhase = 'idle' | 'pending' | 'dragging' | 'settling'

interface StartContext {
  /** 拖拽起始槽位 */
  index: number
  /** 该槽位元素，用于计算指针相对方格的抓取偏移 */
  el: HTMLElement
  /**
   * pending 阶段暂缓 setPointerCapture，改由 window 监听驱动，越过阈值才接管指针。
   *
   * 立即捕获会把随后的原生 click 重定向到方格上——内部有控件的方块
   * （搜索方块的引擎按钮、chips、记录）就再也点不到了。暂缓的代价是
   * pending 期间指针没被锁定，所以配了两道防线：window 监听保证指针
   * 快速划出方格也能激活拖拽；onPointerMove / onPointerUp 里的 el 比对
   * 挡住指针滑过别的方格时冒泡上来的同相位事件。
   */
  deferCapture?: boolean
}

/** 落位探测所需的网格几何，由掌握布局常量的调用方给出 */
interface GridGeometry {
  /** 列数 / 行数：把 (col, row) 换算成槽位下标，并把落点夹进界内 */
  cols: number
  rows: number
  /**
   * 相邻两格锚点的间距（含 gap）。
   *
   * 横纵不等：纵向每格还多一条名称行，用同一个值会让行号越算越偏。
   */
  stepX: number
  stepY: number
}

interface DragSortOptions {
  /** 当前配置档类型；手机档触摸拖拽需要长按确认 */
  preset?: ProfilePreset
  /** 返回全部槽位元素，顺序与 slots 索引一致 */
  getSlotElements: () => (HTMLElement | null)[]
  /**
   * 网格的行列数与格间距。
   *
   * 落位探测按几何换算而不是命中槽位元素，这些尺度无法从 rects 反推
   * （槽位元素本身可能是跨格的大方块），只能由调用方提供。
   */
  getGridGeometry: () => GridGeometry
  /** 拖拽真正激活（越过阈值）时触发，用于快照浮层内容 */
  onDragStart: (index: number) => void
  /** 一次拖拽会话彻底结束（含落位动画）时触发 */
  onDragEnd: () => void
  /** 拖拽落定后提交移动 */
  onCommit: (from: number, to: number) => void
  /** 未达阈值，按点击处理 */
  onClick: (index: number) => void
  /**
   * 把悬停槽位换算成真正的落位槽位。
   *
   * 跨格方块的落点会被夹回界内，落位动画必须飞向夹紧后的位置，
   * 否则浮层停在悬停格、方块却出现在旁边一格。
   * 换算规则属于数据层，这里只接受结果。
   */
  resolveDrop?: (from: number, to: number) => number
  /**
   * 提交移动前后各调一次，供调用方给「被换走的方块」补一段位移动画。
   *
   * 换位动画必须由调用方做：受影响的是哪些方块只有数据层清楚，
   * 而这里连 slots 都看不到。
   */
  beforeCommit?: () => void
  afterCommit?: () => void
}

export function useDragSort(options: DragSortOptions) {
  const phase = ref<DragPhase>('idle')
  const fromIndex = ref<number | null>(null)
  const hoverIndex = ref<number | null>(null)
  /** 落位过渡的目标槽位；该槽位内容先隐藏，等浮层飞到位再显示 */
  const settleIndex = ref<number | null>(null)
  /** 拖拽浮层左上角坐标 */
  const layerX = ref(0)
  const layerY = ref(0)
  /** 浮层尺寸取源方格实测值：跨格方块不是正方形 */
  const layerW = ref(0)
  const layerH = ref(0)
  const layerScale = ref(DRAG_SCALE)

  let startX = 0
  let startY = 0
  /** 指针在方格内的抓取偏移，保证浮层不会跳到指针中心 */
  let grabOffsetX = 0
  let grabOffsetY = 0
  let rects: (DOMRect | null)[] = []
  let rafId: number | null = null
  let settleTimer: number | null = null
  let mobileDragTimer: number | null = null
  let mobileDragReady = false
  let pendingEvent: PointerEvent | null = null
  let activeEl: HTMLElement | null = null
  let activePointerId: number | null = null
  let activePointerType: string | null = null
  /**
   * 发起按下时的完整 StartContext。
   *
   * window 侧监听必须用**同一个** ctx 驱动状态机：里面带着 deferCapture，
   * beginDrag 靠它在激活那一刻补上指针捕获并摘除 window 监听。就地重建一个
   * 只有 index / el 的对象会把这份信息丢掉。
   */
  let activeCtx: StartContext | null = null

  /* ── 暂缓捕获的 pending 阶段（见 StartContext.deferCapture） ── */

  function onWindowPointerMove(event: PointerEvent) {
    if (phase.value !== 'pending') return
    if (event.pointerId !== activePointerId || !activeCtx || fromIndex.value === null) return
    /*
     * 按键已在别处松开而 pointerup 被吞（按住时切窗等）：暂缓捕获期间没有
     * 元素捕获兜底，若无此防线，回来后一次无按键的移动就会凭空激活拖拽。
     */
    if (event.buttons === 0) {
      reset()
      return
    }
    onPointerMove(event, activeCtx)
  }

  function onWindowPointerUp(event: PointerEvent) {
    if (phase.value !== 'pending') return
    if (event.pointerId !== activePointerId || !activeCtx || fromIndex.value === null) return
    onPointerUp(event, activeCtx)
  }

  function onWindowPointerCancel(event: PointerEvent) {
    if (event.pointerId !== activePointerId) return
    reset()
  }

  /** 同一组具名函数反复挂 / 摘，addEventListener 对相同参数天然幂等 */
  function attachWindowListeners() {
    window.addEventListener('pointermove', onWindowPointerMove, true)
    window.addEventListener('pointerup', onWindowPointerUp, true)
    window.addEventListener('pointercancel', onWindowPointerCancel, true)
  }

  function detachWindowListeners() {
    window.removeEventListener('pointermove', onWindowPointerMove, true)
    window.removeEventListener('pointerup', onWindowPointerUp, true)
    window.removeEventListener('pointercancel', onWindowPointerCancel, true)
  }

  /** 浮层在 dragging 与 settling 两个阶段都要显示 */
  const isActive = computed(() => phase.value === 'dragging' || phase.value === 'settling')
  const isDragging = computed(() => phase.value === 'dragging')
  const isSettling = computed(() => phase.value === 'settling')

  /** 释放指针捕获与待处理帧，但不清空视觉状态 */
  function releasePointer() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    detachWindowListeners()
    if (mobileDragTimer !== null) {
      clearTimeout(mobileDragTimer)
      mobileDragTimer = null
    }
    if (activeEl && activePointerId !== null && activeEl.hasPointerCapture(activePointerId)) {
      activeEl.releasePointerCapture(activePointerId)
    }
    window.removeEventListener('keydown', onKeydown)
    pendingEvent = null
    activeEl = null
    activePointerId = null
    activePointerType = null
    mobileDragReady = false
    activeCtx = null
  }

  function clearState() {
    if (settleTimer !== null) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
    const wasActivated = phase.value === 'dragging' || phase.value === 'settling'
    phase.value = 'idle'
    fromIndex.value = null
    hoverIndex.value = null
    settleIndex.value = null
    layerScale.value = DRAG_SCALE
    rects = []
    if (wasActivated) options.onDragEnd()
  }

  /** 立即结束（放弃动画），供取消与新拖拽抢占使用 */
  function reset() {
    releasePointer()
    clearState()
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') reset()
  }

  /** 拖拽期间布局不变，开始时一次性缓存全部槽位矩形即可 */
  function cacheRects() {
    rects = options.getSlotElements().map((el) => el?.getBoundingClientRect() ?? null)
  }

  /**
   * 重新缓存矩形。
   *
   * 缓存的是视口坐标，容器一滚动就全部失效——落位探测会把方块判给
   * 滚动前压在那个位置的槽位。滚动容器要在 scroll 里调它。
   */
  function refreshRects() {
    if (phase.value !== 'dragging') return
    cacheRects()
    hoverIndex.value = probeDrop()
  }

  /**
   * 网格左上角（第 0 格锚点）的视口坐标。
   *
   * 从任意一个已缓存的槽位矩形反推：该槽位的 rect.left / top 就是它锚点格的左上角，
   * 减掉 col / row 个步长即得原点。跨格方块同样成立——它的 rect 也是从锚点格起算的。
   */
  function gridOrigin(geo: GridGeometry): { x: number; y: number } | null {
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i]
      if (!rect) continue
      const col = i % geo.cols
      const row = Math.floor(i / geo.cols)
      return { x: rect.left - col * geo.stepX, y: rect.top - row * geo.stepY }
    }
    return null
  }

  /**
   * 槽位左上角的视口坐标。
   *
   * 不直接取 rects[index]：目标槽位可能正被邻格的大方块覆盖，压根没有元素，
   * 落位动画会因此退化成瞬移。按原点 + 步长算则任何界内槽位都有坐标。
   */
  function slotTopLeft(index: number): { x: number; y: number } | null {
    const geo = options.getGridGeometry()
    if (geo.cols < 1) return null
    const origin = gridOrigin(geo)
    if (!origin) return null
    return {
      x: origin.x + (index % geo.cols) * geo.stepX,
      y: origin.y + Math.floor(index / geo.cols) * geo.stepY,
    }
  }

  /**
   * 落位探测。
   *
   * 判据是**被拖方块自身的左上角**，而不是指针位置：拖一个 2×2 时指针可能在方块右下角，
   * 按指针命中会落到右下那一格，与用户看到的方块位置差一格；方块越大越明显。
   * 左上角所在的格正是数据层里的锚点。
   *
   * 用网格几何换算而不是拿采样点去命中 rects：跨格方块的 rect 覆盖好几格，
   * 采样点在它内部时会一直判回原槽位——于是大方块朝「自身仍盖住的那几个方向」
   * （右、下，以及纵向步长被低估时的上）永远挪不动一格。
   * 换算按 col / row 独立取整，四个方向因此完全对称。
   */
  function probeDrop(): number | null {
    const geo = options.getGridGeometry()
    if (geo.cols < 1 || geo.rows < 1 || geo.stepX <= 0 || geo.stepY <= 0) return null
    const origin = gridOrigin(geo)
    if (!origin) return null

    const rawCol = (layerX.value - origin.x) / geo.stepX
    const rawRow = (layerY.value - origin.y) / geo.stepY

    /** 容差：拖出网格一格以内算就近吸附，更远则视为放弃，保留回弹这条退路 */
    const tolerance = 1
    if (rawCol < -tolerance || rawCol > geo.cols - 1 + tolerance) return null
    if (rawRow < -tolerance || rawRow > geo.rows - 1 + tolerance) return null

    const col = Math.min(Math.max(Math.round(rawCol), 0), geo.cols - 1)
    const row = Math.min(Math.max(Math.round(rawRow), 0), geo.rows - 1)
    return row * geo.cols + col
  }

  // 落位探测只看浮层坐标，不再需要指针事件
  function beginDrag(ctx: StartContext) {
    const rect = ctx.el.getBoundingClientRect()
    grabOffsetX = startX - rect.left
    grabOffsetY = startY - rect.top
    layerW.value = rect.width
    layerH.value = rect.height
    layerX.value = rect.left
    layerY.value = rect.top
    layerScale.value = DRAG_SCALE

    /*
     * 暂缓捕获在这一刻补上：拖拽已经成立，此后原生 click 无所谓了，
     * 而捕获保证指针划出方格后 move / up 仍然送达。此刻指针必然活跃
     * （正在 pointermove 里），捕获不会抛错。
     */
    if (ctx.deferCapture) {
      if (activePointerId !== null) ctx.el.setPointerCapture(activePointerId)
      detachWindowListeners()
    }

    phase.value = 'dragging'
    cacheRects()
    hoverIndex.value = probeDrop()
    window.addEventListener('keydown', onKeydown)
    options.onDragStart(ctx.index)
  }

  function flushMove() {
    rafId = null
    const event = pendingEvent
    pendingEvent = null
    if (!event || phase.value !== 'dragging') return

    layerX.value = event.clientX - grabOffsetX
    layerY.value = event.clientY - grabOffsetY
    hoverIndex.value = probeDrop()
  }

  function onPointerDown(event: PointerEvent, ctx: StartContext) {
    // 只响应主键，避免右键 / 中键误触发
    if (event.button !== 0) return

    // 上一次落位动画还没跑完就再次按下：立刻收尾，避免状态叠加
    if (phase.value === 'settling') reset()

    phase.value = 'pending'
    fromIndex.value = ctx.index
    startX = event.clientX
    startY = event.clientY
    activeEl = ctx.el
    activePointerId = event.pointerId
    activePointerType = event.pointerType
    activeCtx = ctx

    const needsLongPress = options.preset === 'mobile' && event.pointerType === 'touch'
    mobileDragReady = !needsLongPress
    if (needsLongPress) {
      mobileDragTimer = window.setTimeout(() => {
        if (phase.value === 'pending' && activePointerId === event.pointerId) {
          mobileDragReady = true
        }
      }, MOBILE_LONG_PRESS_MS)
    }
    /*
     * 立即捕获（常态）还是暂缓到越过阈值（内部有控件的方块），
     * 由发起方在 StartContext 上声明，这里不感知方块内容。
     */
    if (ctx.deferCapture) attachWindowListeners()
    else ctx.el.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: PointerEvent, ctx: StartContext) {
    if (phase.value !== 'pending' && phase.value !== 'dragging') return
    // 只认发起方格的事件：暂缓捕获的 pending 期间没有锁定指针，
    // 指针滑过别的方格时那些方格也会把 move 冒泡上来
    if (ctx.el !== activeEl) return

    if (phase.value === 'pending') {
      const moved = Math.hypot(event.clientX - startX, event.clientY - startY)
      if (options.preset === 'mobile' && activePointerType === 'touch' && !mobileDragReady) {
        // 手机短按滑动只取消本次整理，只有长按后再移动才是整理方块。
        if (moved > DRAG_THRESHOLD) reset()
        return
      }
      if (moved <= DRAG_THRESHOLD) return
      beginDrag(ctx)
      return
    }

    pendingEvent = event
    if (rafId === null) rafId = requestAnimationFrame(flushMove)
  }

  function onPointerUp(event: PointerEvent, ctx: StartContext) {
    if (ctx.el !== activeEl) return
    // 手机长按菜单会在捕获阶段 preventDefault，不能再把这次按下当作点击。
    if (event.defaultPrevented) {
      reset()
      return
    }
    if (phase.value === 'pending') {
      const index = ctx.index
      reset()
      options.onClick(index)
      return
    }
    if (phase.value !== 'dragging') return

    const from = fromIndex.value
    const hovered = hoverIndex.value
    // 落点先经数据层夹紧，再决定飞向哪一格
    const to =
      from !== null && hovered !== null && options.resolveDrop
        ? options.resolveDrop(from, hovered)
        : hovered
    const isValidDrop = from !== null && to !== null && to !== from

    // 目标有效则飞向目标，否则回弹到原位
    const target = isValidDrop ? to : from
    const landing = target !== null ? slotTopLeft(target) : null

    releasePointer()

    if (isValidDrop) {
      // 换位动画的两次测量必须紧夹住这次提交，中间不能插入别的状态改动
      options.beforeCommit?.()
      options.onCommit(from, to)
      options.afterCommit?.()
    }

    // 用户关闭动效时直接落位，否则目标格会空白等待一个无意义的过渡时长
    if (!landing || motionDisabled()) {
      clearState()
      return
    }

    // 浮层此刻已渲染在指针位置，改坐标 + 挂 transition 即得到 FLIP 过渡
    phase.value = 'settling'
    settleIndex.value = isValidDrop ? to : from
    hoverIndex.value = null
    layerX.value = landing.x
    layerY.value = landing.y
    layerScale.value = 1

    settleTimer = window.setTimeout(reset, MOTION_BASE_MS)
  }

  function onPointerCancel() {
    reset()
  }

  return {
    phase,
    isActive,
    isDragging,
    isSettling,
    fromIndex,
    hoverIndex,
    settleIndex,
    layerX,
    layerY,
    layerW,
    layerH,
    layerScale,
    refreshRects,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  }
}

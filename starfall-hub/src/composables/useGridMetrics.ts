import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

import {
  cellExtent,
  fitCount,
  gridGeometry,
  setAvailableArea,
} from './useAreaViewport'
import { useSettingsStore } from '@/stores/settings'

/**
 * 决定网格实际用多大、以及能放下多少行列。
 *
 * 观测两个元素而不是一个：
 * - areaEl 是网格自身，决定「当前真正在用多大」，未指定的轴由它反解行列数；
 * - hostEl 是外层容器，扣掉内边距后就是「画面还能给多大」，写进
 *   useAreaViewport 的模块级状态，供设置里的「按当前画面」共用。
 *
 * 设置里给了固定尺寸后 areaEl 不再铺满，此时若仍拿 areaEl 当可用空间，
 * 一键填充会把已经缩小过的尺寸再填回去，越点越小。
 *
 * 两个轴全程独立处理：只填了宽度时高度仍应铺满，反之亦然，
 * 「必须两个都填才生效」会让单轴设置看起来像没反应。
 */
export function useGridMetrics(areaEl: Ref<HTMLElement | null>, hostEl: Ref<HTMLElement | null>) {
  const settings = useSettingsStore()

  const areaW = ref(0)
  const areaH = ref(0)
  let observer: ResizeObserver | null = null

  onMounted(() => {
    const area = areaEl.value
    const host = hostEl.value
    if (!area || !host) return

    const measure = () => {
      const rect = area.getBoundingClientRect()
      areaW.value = rect.width
      areaH.value = rect.height

      /*
       * 可用空间用 clientWidth / clientHeight 而不是 getBoundingClientRect：
       * 前者已经排除了滚动条与边框，正是网格真正能铺开的范围。
       * 手动扣 padding 而不用 contentRect，因为一次 ResizeObserver 回调
       * 只带一个目标的 contentRect，而这里两个元素共用同一个回调。
       */
      const style = getComputedStyle(host)
      const padX = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
      const padY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
      setAvailableArea(
        Math.max(0, host.clientWidth - (Number.isFinite(padX) ? padX : 0)),
        Math.max(0, host.clientHeight - (Number.isFinite(padY) ? padY : 0)),
      )
    }

    measure()
    observer = new ResizeObserver(measure)
    observer.observe(area)
    observer.observe(host)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
  })

  /**
   * 每个轴被指定成了多少像素；0 表示该轴跟随画面。
   *
   * 格子档在这里就换算成像素，下游只面对一种表示，
   * 不必在样式与行列数两处各判一次档位。
   */
  const fixedPx = computed(() => {
    const { gap, cellW, cellH } = gridGeometry.value
    if (settings.areaMode === 'pixel') {
      return { w: settings.areaWidth, h: settings.areaHeight }
    }
    return {
      w: cellExtent(settings.areaCols, cellW, gap),
      h: cellExtent(settings.areaRows, cellH, gap),
    }
  })

  /**
   * 网格元素的尺寸覆写。
   *
   * 高度要连 flex 一起摘掉：.grid 靠 flex: 1 在列向 flex 容器里撑满，
   * 只写 height 会被 flex-basis 覆盖，看起来像设置没生效。
   *
   * 溢出的那个轴上补 auto margin：滚动容器用的是 flex 居中，
   * 内容大于容器时被居中的部分会跑到 scroll origin 之前，那一半永远滚不到。
   * flex 项的 auto margin 只吃「剩余空间」，没有剩余时自动退化为 0，
   * 因此同一条声明既保住了未溢出时的居中，也保住了溢出时的完整可达。
   */
  const areaStyle = computed((): Record<string, string> => {
    const { w, h } = fixedPx.value
    const style: Record<string, string> = {}
    if (w > 0) {
      style.width = `${w}px`
      style.marginInline = 'auto'
    }
    if (h > 0) {
      style.height = `${h}px`
      style.flex = 'none'
      style.marginBlock = 'auto'
    }
    return style
  })

  const metrics = computed(() => {
    const { gap, cellW, cellH } = gridGeometry.value

    /*
     * 被显式指定的轴**不看测量值**，两个档位各有各的算法：
     *
     * - 格子档直接采用用户给的数。反解会把「刚好差几像素放不下第 n 行」的取整
     *   误差算进来，用户填 5 行却得到 4 行；而这一档的语义本就是「我说几行就是几行」。
     * - 像素档从**用户填的像素**反解，而不是从量到的元素尺寸反解。两者最终会相等
     *   （areaStyle 就是把这个数写成 width/height），但 ResizeObserver 是异步的，
     *   中间那一帧仍是旧尺寸——于是「改一次区域尺寸」会先按旧尺寸算出一组行列、
     *   resize 一次网格，再按新尺寸算一遍、再 resize 一次。第一次那下是有破坏性的：
     *   缩小时方块被挤进 overflow，等网格变回来时它们已经按 reflow 顺序重排了，
     *   回不到原来的锚点。**「重置为默认」正是这条路径**——它同时改布局与区域尺寸，
     *   刚放好的默认布局会被那一帧的旧尺寸压掉。
     *
     * 未指定的轴仍走实测反解，那是「跟随画面」的定义。
     */
    const byCell = settings.areaMode === 'cell'
    const measuredCols = fitCount(areaW.value, cellW, gap)
    const measuredRows = fitCount(areaH.value, cellH, gap)

    const fixed = fixedPx.value
    const cols = byCell
      ? settings.areaCols > 0
        ? settings.areaCols
        : measuredCols
      : fixed.w > 0
        ? fitCount(fixed.w, cellW, gap)
        : measuredCols
    const rows = byCell
      ? settings.areaRows > 0
        ? settings.areaRows
        : measuredRows
      : fixed.h > 0
        ? fitCount(fixed.h, cellH, gap)
        : measuredRows

    /**
     * 是否已经量到真实尺寸。
     *
     * 挂载前 areaW / areaH 是 0，反解出来的行列数是 1×1；
     * 若把它当真去 resize，网格会先被压成一格、方块几乎全被挤进 overflow，
     * 等量完再放回来时位置已经全乱了——刷新一次布局就变一次。
     * 消费方必须等 ready 为真再动 store。
     *
     * 被指定的轴不依赖测量（两档同理，见上），那一侧无需等待。
     */
    const wReady = areaW.value > 0 || fixed.w > 0
    const hReady = areaH.value > 0 || fixed.h > 0

    return {
      ready: wReady && hReady,
      cols: Math.max(1, cols),
      rows: Math.max(1, rows),
      /** 测量完成后仍连一个完整单元格都放不下；只有跟随画面的轴才可能走到 */
      tooSmall:
        (areaW.value > 0 && measuredCols < 1 && fixed.w <= 0) ||
        (areaH.value > 0 && measuredRows < 1 && fixed.h <= 0),
    }
  })

  return { metrics, areaStyle }
}

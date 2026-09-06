<script setup lang="ts">
import { computed, ref } from 'vue'

import TileIcon from './TileIcon.vue'
import TileWidget from './TileWidget.vue'
import { getWidget } from '@/data/widgets'
import type { Tile } from '@/types/tile'

const props = defineProps<{
  index: number
  tile: Tile | null
  /** 占格宽 / 高，由 TileGrid 依据 store 计算后传入 */
  spanW?: number
  spanH?: number
  /** 正被拖起的源槽位，降透明度作占位 */
  isSource?: boolean
  /** 浮层正飞向该槽位，先隐藏内容避免与浮层重影 */
  isLanding?: boolean
  /** 右键菜单当前指向该槽位，保持可见的选中态 */
  isMenuTarget?: boolean
}>()

const emit = defineEmits<{
  /**
   * 第三个参数是「暂缓捕获」标记，供内部有控件的方块使用，
   * 语义见 useDragSort 的 StartContext.deferCapture。
   */
  pointerdown: [event: PointerEvent, el: HTMLElement, deferCapture: boolean]
  pointermove: [event: PointerEvent, el: HTMLElement]
  pointerup: [event: PointerEvent, el: HTMLElement]
  pointercancel: [event: PointerEvent]
  activate: [index: number]
  /**
   * 组件自己改了配置（目前只有搜索方块的换引擎）。
   *
   * 走事件上报而不是让组件直接写 store：props 的唯一写入路径是
   * grid.updateTile，那里会做校验与落位；组件绕过去写就等于多一条不受校验的入口。
   */
  'update-props': [index: number, patch: Record<string, unknown>]
  /**
   * 名称被截断时的悬停提示：给出完整文字与名称行的视口位置，null 表示收起。
   *
   * 由 TileGrid 统一渲染成一个浮层而不是每格自己挂一个：提示要能盖过相邻方格，
   * 挂在格内会被网格的层叠顺序和滚动容器裁掉。
   */
  'name-tip': [tip: { text: string; x: number; top: number; bottom: number } | null]
  /**
   * 组件方块请求打开自己的功能对话框（目前只有待办）。
   *
   * 与 activate 分开：activate 是「方格被点了」这件通用的事，由拖拽状态机在
   * 未越过阈值时判定；这一条是组件内部自己的意图，不经过状态机。
   */
  'open-widget-dialog': [index: number]
}>()

/** 方格本体元素：拖拽起始矩形与命中检测都以它为准 */
const squareEl = ref<HTMLElement | null>(null)
/** 名称行元素：判断是否溢出、以及取提示的锚点矩形 */
const labelEl = ref<HTMLElement | null>(null)

const isEmpty = computed(() => props.tile === null)

/** 组件方块自带可读内容（如日历的完整日期），交给它自己命名 */
const isWidget = computed(() => props.tile?.kind === 'widget')

/**
 * 装了东西但没起名：名称行整个不占位，方格顺势长到名称处。
 *
 * 空格刻意不算在内——它那一格的名称行是空字符串而非「没有名称」，
 * 若一并收掉，悬停时显形的虚线框会比旁边所有方格高出一截（75 → 101），
 * 网格看起来就不齐了。
 *
 * 判据用 trim()：只打了空格的名称在方格下什么都看不见，
 * 留着一条 26px 的空白带比收掉更费解释。
 */
const isNameless = computed(() => props.tile !== null && props.tile.name.trim() === '')

/**
 * 内容自己吃掉指针的方块，改走「软启动」拖拽而不是整体退出。
 *
 * 搜索的输入框、待办的输入行与复选框都需要真正的按下-拖动（定位光标、选中文本），
 * 那条路径必须完全留给浏览器；但方块其余部分（留白、chips、引擎按钮）可以
 * 照常发起拖拽——代价是按下时不能立即 setPointerCapture（会把随后的原生
 * click 重定向到方格上，chips 就点不到了），所以带 deferCapture 让
 * useDragSort 推迟到越过阈值才接管指针。
 *
 * 判据从 `widgetId === 'search'` 改读注册表的 WidgetDef.interactive：
 * 原注释说「第二个这样的组件出现时再抽」，待办就是第二例。同一件事另有三处判定
 * 在 TabWidgetEdit 里，一并换成了这个字段——散成四份字面量，加第三个组件时
 * 就是四处漏一处的机会。
 */
const isInteractive = computed(
  () => props.tile?.kind === 'widget' && getWidget(props.tile.widgetId)?.interactive === true,
)

/**
 * 几何全部由 CSS 变量驱动，JS 不参与像素计算。
 *
 * --label-block 是「名称行连它上面那道间距一共占多高」，没起名时置 0：
 * 单元格的外部尺寸（grid-auto-rows）不变，省下来的高度全部归方格，
 * 于是方格底边正好长到名称原本所在的位置。
 */
const spanStyle = computed(() => ({
  '--span-w': String(props.spanW ?? 1),
  '--span-h': String(props.spanH ?? 1),
  ...(isNameless.value ? { '--label-block': '0px' } : {}),
}))

/**
 * 空格与链接由这里命名；组件方块返回 undefined。
 *
 * 组件的内容本身就是信息（日历里是「2026 年 8 月 27 日」），
 * 写死 aria-label 会把它盖掉，读屏只念得到方格名而听不到实际内容。
 */
const ariaLabel = computed(() => {
  if (isWidget.value) return undefined
  return props.tile ? `打开 ${props.tile.name}` : `第 ${props.index + 1} 格，空，点击添加`
})

/**
 * 指针处理只把守 pointerdown，move / up / cancel 一律放行。
 *
 * 拖拽会话是否开始、来自哪个方格，由 useDragSort 用相位与发起元素判定：
 * 这一层只知道「这一格装的是什么」，不追踪拖拽状态。放行到空闲相位的事件
 * 在那边会被就地吞掉。
 */
function onPointerDown(event: PointerEvent) {
  if (isInteractive.value) {
    const target = event.target as HTMLElement | null
    // 文本输入区的按下整体让给浏览器：定位光标、选中文本本身就是一次按下-拖动
    if (target?.closest('input, textarea')) return
    if (squareEl.value) emit('pointerdown', event, squareEl.value, true)
    return
  }
  if (squareEl.value) emit('pointerdown', event, squareEl.value, false)
}

function onPointerMove(event: PointerEvent) {
  if (squareEl.value) emit('pointermove', event, squareEl.value)
}

function onPointerUp(event: PointerEvent) {
  if (squareEl.value) emit('pointerup', event, squareEl.value)
}

function onPointerCancel(event: PointerEvent) {
  emit('pointercancel', event)
}

/**
 * 键盘 Enter / Space 等价于点击，不经过拖拽状态机。
 *
 * 可交互方块要放行：它内部的输入框与按钮各自处理这两个键，
 * 在这里 preventDefault 会让空格打不出来。
 */
function onKeydown(event: KeyboardEvent) {
  if (isInteractive.value) return
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  emit('activate', props.index)
}

/**
 * 名称溢出（触发了 ...）时才上报提示，没截断的名字不需要重复一遍。
 *
 * 判据用 scrollWidth 与 clientWidth 差 1px 以上：两者在未溢出时理论相等，
 * 但缩放比非整数时会差出零点几像素，用 > 0 会让所有名称都弹提示。
 *
 * 每次进入都重新量而不是缓存：同一个方格的名称可能被编辑，
 * 宽度也随设置里的方格尺寸变化，缓存下来必然有一份是过期的。
 */
function onLabelEnter() {
  const el = labelEl.value
  const text = props.tile?.name
  if (!el || !text) return
  if (el.scrollWidth - el.clientWidth <= 1) return

  const rect = el.getBoundingClientRect()
  emit('name-tip', {
    text,
    x: rect.left + rect.width / 2,
    top: rect.top,
    bottom: rect.bottom,
  })
}

function onLabelLeave() {
  emit('name-tip', null)
}

defineExpose({ squareEl })
</script>

<template>
  <!-- data-slot-index 挂在根节点：名称行也算这一格，右键落在文字上不该变成「空白处」 -->
  <!-- data-tile-id 是换位动画配对用的身份；空格没有身份，也不需要动 -->
  <div
    class="tile-cell"
    :data-slot-index="index"
    :data-tile-id="tile?.id"
    :style="spanStyle"
  >
    <div
      ref="squareEl"
      class="tile-cell__square"
      :class="{
        'is-empty': isEmpty,
        'is-widget': isWidget,
        'is-interactive': isInteractive,
        'is-source': isSource,
        'is-landing': isLanding,
        'is-menu-target': isMenuTarget,
      }"
      :role="isInteractive ? undefined : 'button'"
      :tabindex="isInteractive ? undefined : 0"
      :aria-label="ariaLabel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @keydown="onKeydown"
    >
      <TileWidget
        v-if="tile?.kind === 'widget'"
        :widget-id="tile.widgetId"
        :name="tile.name"
        :widget-props="tile.props"
        :span-w="spanW"
        :span-h="spanH"
        @update-props="emit('update-props', index, $event)"
        @open-widget-dialog="emit('open-widget-dialog', index)"
      />
      <TileIcon
        v-else-if="tile"
        :name="tile.name"
        :icon="'icon' in tile ? tile.icon : undefined"
        :bg-color="'bgColor' in tile ? tile.bgColor : undefined"
      />
      <span v-else class="tile-cell__plus" aria-hidden="true">+</span>
    </div>

    <!--
      名称是方格的兄弟节点，宽度硬绑 --tile-size，永远不会把单元格撑宽。

      没起名时整个不渲染，而不是渲染一个空的 span：--label-block 已经把高度
      收成 0，留着空节点还会吃掉 flex 的 gap（--label-gap 也在 --label-block 里，
      但 gap 是 .tile-cell 自己的属性，不受那个变量影响）。

      不给 title：原生 tooltip 与自绘提示会同时出现，而且它跟随指针、样式不可控、
      还要等一秒多才显形。改由 pointerenter 上报给 TileGrid 渲染成统一浮层。

      pointerdown 也收起：名称行不发起拖拽（拖拽只挂在方格上），但右键会在这里
      弹出菜单，菜单往往正好压在提示的位置上。
    -->
    <span
      v-if="!isNameless"
      ref="labelEl"
      class="tile-cell__label"
      @pointerenter="onLabelEnter"
      @pointerleave="onLabelLeave"
      @pointerdown="onLabelLeave"
    >
      {{ tile?.name ?? '' }}
    </span>
  </div>
</template>

<style scoped>
.tile-cell {
  --span-w: 1;
  --span-h: 1;
  /*
   * 名称行连它上面那道间距一共占多高。
   *
   * 抽成一个变量是为了让「没起名」只需覆写这一处（见 spanStyle）：
   * 置 0 后下面的 --square-h 自动把这段高度让给方格，而 --cell-block
   * 保持不变——单元格的外部尺寸由 grid-auto-rows 定死，收的是内部划分。
   */
  --label-block: calc(var(--label-gap) + var(--label-height));
  /* 一个单元格 = 方格 + 名称间距 + 名称行，与 useGridMetrics 的 cellH 同构 */
  --cell-block: calc(var(--tile-size) + var(--label-gap) + var(--label-height));
  --square-w: calc(var(--tile-size) * var(--span-w) + var(--gap) * (var(--span-w) - 1));
  /*
   * 纵向跨格时吞掉中间那些名称行，只在最底部留一行名称：
   * 否则 2×2 的方块中间会横着一条空白带。
   */
  --square-h: calc(
    var(--cell-block) * var(--span-h) + var(--gap) * (var(--span-h) - 1) - var(--label-block)
  );
  /* 内容尺寸取短边，保证非正方形方格里图标不溢出 */
  --content-size: min(var(--square-w), var(--square-h));

  display: flex;
  width: var(--square-w);
  flex-direction: column;
  align-items: center;
  gap: var(--label-gap);
}

.tile-cell__square {
  position: relative;
  width: var(--square-w);
  height: var(--square-h);
  border: 1px solid var(--tile-border);
  /*
   * 百分比圆角在非正方形上会算成椭圆，改为按短边取等半径；
   * 再夹一道 --tile-radius-max，跨格方块的圆角才不会大到吃掉边缘内容
   * （4×4 不夹是 79px，月历首末行的日号正落在被切掉的那一块里）。
   */
  border-radius: min(
    calc(var(--content-size) * var(--tile-radius-ratio)),
    var(--tile-radius-max)
  );
  background: var(--tile-bg);
  transition:
    transform var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease),
    box-shadow var(--dur-fast) var(--ease),
    opacity var(--dur-fast) var(--ease);
  /* 触屏拖拽时不让浏览器接管为页面滚动 */
  touch-action: none;
  cursor: pointer;
}

.tile-cell__square:hover {
  transform: translateY(-2px);
  background: var(--tile-bg-hover);
  box-shadow: var(--shadow-md);
}

/*
 * 可交互方块（搜索）保留 default 光标与 touch-action: auto。
 *
 * 拖拽现在可以从方格空白处与控件上软启动（见 onPointerDown 与
 * useDragSort 的 deferCapture），hover 抬升因此与其它可拖拽方格一致，
 * 不再单独抹平。touch-action 仍保持 auto 而不是跟随常态的 none：
 * 方块内部有滚动区（h=2 的引擎条与记录列表），none 会在触屏上把它们
 * 一并锁死；代价是触屏从方块上起手的拖拽会被滚动接管——桌面鼠标
 * 拖拽不受影响，触屏换位仍可拖别的方块过来挤位置。
 */
.tile-cell__square.is-interactive {
  cursor: default;
  touch-action: auto;
}

.tile-cell__square:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
}

.tile-cell__square.is-source {
  opacity: 0.3;
}

/*
 * 右键菜单指向的方格：给一个持续的选中态。
 * 右键不移动焦点也不触发 hover 保持，没有这个提示就看不出菜单作用在哪一格。
 */
.tile-cell__square.is-menu-target {
  border-color: var(--accent);
  background: var(--tile-bg-hover);
  box-shadow: 0 0 0 2px var(--accent);
}

/*
 * 组件方块的内容会画到边缘（日历底部的年份条就贴着底边），
 * 必须在方格这一层再裁一次，否则直角会顶出圆角之外。
 */
.tile-cell__square.is-widget {
  overflow: hidden;
}

/*
 * 空格默认完全透明，桌面保持干净。
 * 悬停 / 聚焦时才显形，否则无从下手添加内容。
 * 放在 is-source 之后，同权重下后写者生效。
 */
.tile-cell__square.is-empty {
  border-style: dashed;
  background: rgb(255 255 255 / 0.04);
  opacity: 0;
}

.tile-cell__square.is-empty:hover,
.tile-cell__square.is-empty:focus-visible,
.tile-cell__square.is-empty.is-menu-target {
  opacity: 1;
}

/* 浮层正飞向此格：内容暂时不可见，等浮层到位后一起显现 */
.tile-cell__square.is-landing > * {
  opacity: 0;
}

.tile-cell__plus {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  color: var(--color-text-dim);
  font-size: calc(var(--content-size) * 0.34);
  font-weight: 300;
  line-height: 1;
  user-select: none;
}

.tile-cell__label {
  width: var(--square-w);
  height: var(--label-height);
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--fs-base);
  line-height: var(--label-height);
  text-align: center;
  text-overflow: ellipsis;
  /* 名称直接压在背景/壁纸上，没有底色兜着，靠投影保证任意底上可读 */
  text-shadow: 0 1px 3px rgb(0 0 0 / 0.55);
  white-space: nowrap;
}
</style>

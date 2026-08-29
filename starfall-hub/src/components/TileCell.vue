<script setup lang="ts">
import { computed, ref } from 'vue'

import TileIcon from './TileIcon.vue'
import TileWidget from './TileWidget.vue'
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
  pointerdown: [event: PointerEvent, el: HTMLElement]
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
}>()

/** 方格本体元素：拖拽起始矩形与命中检测都以它为准 */
const squareEl = ref<HTMLElement | null>(null)

const isEmpty = computed(() => props.tile === null)

/** 组件方块自带可读内容（如日历的完整日期），交给它自己命名 */
const isWidget = computed(() => props.tile?.kind === 'widget')

/**
 * 内容自己吃掉指针的方块，整体退出拖拽与键盘激活。
 *
 * 目前只有搜索组件：它里面有真正的 `<input>`，而拖拽靠在方格上
 * `setPointerCapture`，两者落在同一块区域上必然互斥——不退出的话，
 * 点输入框会进入 pending 阶段，拖动会拖走整个方块而不是选中文本。
 *
 * 判据取 widgetId 而不是给注册表加一个 `interactive` 标志：目前只此一例，
 * 加标志就要在 WidgetDef 上多一个所有组件都得回答的问题。第二个这样的组件
 * 出现时再抽。
 */
const isInteractive = computed(
  () => props.tile?.kind === 'widget' && props.tile.widgetId === 'search',
)

/** 几何全部由 CSS 变量驱动，JS 不参与像素计算 */
const spanStyle = computed(() => ({
  '--span-w': String(props.spanW ?? 1),
  '--span-h': String(props.spanH ?? 1),
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

/*
 * 四个指针处理都先看 isInteractive。
 *
 * 在这里挡住而不是让 useDragSort 自己判断：那边拿到的只有 index 与元素，
 * 「这一格里装的是什么」只有这一层知道。
 */
function onPointerDown(event: PointerEvent) {
  if (isInteractive.value) return
  if (squareEl.value) emit('pointerdown', event, squareEl.value)
}

function onPointerMove(event: PointerEvent) {
  if (isInteractive.value) return
  if (squareEl.value) emit('pointermove', event, squareEl.value)
}

function onPointerUp(event: PointerEvent) {
  if (isInteractive.value) return
  if (squareEl.value) emit('pointerup', event, squareEl.value)
}

function onPointerCancel(event: PointerEvent) {
  if (isInteractive.value) return
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
      />
      <TileIcon
        v-else-if="tile"
        :name="tile.name"
        :icon="'icon' in tile ? tile.icon : undefined"
        :bg-color="'bgColor' in tile ? tile.bgColor : undefined"
      />
      <span v-else class="tile-cell__plus" aria-hidden="true">+</span>
    </div>

    <!-- 名称是方格的兄弟节点，宽度硬绑 --tile-size，永远不会把单元格撑宽 -->
    <span class="tile-cell__label" :title="tile?.name">{{ tile?.name ?? '' }}</span>
  </div>
</template>

<style scoped>
.tile-cell {
  --span-w: 1;
  --span-h: 1;
  /* 一个单元格 = 方格 + 名称间距 + 名称行，与 useGridMetrics 的 cellH 同构 */
  --cell-block: calc(var(--tile-size) + var(--label-gap) + var(--label-height));
  --square-w: calc(var(--tile-size) * var(--span-w) + var(--gap) * (var(--span-w) - 1));
  /*
   * 纵向跨格时吞掉中间那些名称行，只在最底部留一行名称：
   * 否则 2×2 的方块中间会横着一条空白带。
   */
  --square-h: calc(
    var(--cell-block) * var(--span-h) + var(--gap) * (var(--span-h) - 1) - var(--label-gap) -
      var(--label-height)
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
 * 可交互方块（搜索）不做 hover 抬升，也不显示手型。
 *
 * 抬升是「这一整块可以点、可以拖」的语言，而这一块的可点区域是它内部的
 * 输入框与按钮；整块跟着动会让人以为拖得动它。cursor 交给内容自己（输入框是
 * text，按钮是 pointer），方格这一层不表态。
 */
.tile-cell__square.is-interactive {
  cursor: default;
  touch-action: auto;
}

.tile-cell__square.is-interactive:hover {
  transform: none;
  background: var(--tile-bg);
  box-shadow: none;
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

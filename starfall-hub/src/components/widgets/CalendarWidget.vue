<script setup lang="ts">
import { computed } from 'vue'

import CalColumn from './calendar/CalColumn.vue'
import CalMicro from './calendar/CalMicro.vue'
import CalMonth from './calendar/CalMonth.vue'
import CalMonthTall from './calendar/CalMonthTall.vue'
import CalPanel from './calendar/CalPanel.vue'
import CalSplit from './calendar/CalSplit.vue'
import CalStack from './calendar/CalStack.vue'
import CalStrip from './calendar/CalStrip.vue'
import { calendarView } from './calendar/dateGrid'
import { calendarVariant } from './calendar/variant'
import { useToday } from '@/composables/useToday'
import { clampSpan } from '@/types/tile'
import { isHexColor } from '@/utils/color'

const props = defineProps<{
  /** 方格底色；缺省沿用方格自身的玻璃底 */
  bgColor?: string
  /** 次要块面：年份条、横排的日期块、今日高亮胶囊 */
  subBgColor?: string
  /** 主要文字：日期数字、年份、今日胶囊内的字 */
  textColor?: string
  /** 次要文字：月份、星期、星期头、非本月日期、周数 */
  subTextColor?: string
  /**
   * 占格宽 / 高，由 TileWidget 透传。
   *
   * 缺省时按 1×1 处理，因此只覆写了 --content-size 的调用方（拖拽浮层、
   * Dialog 预览）不传也能渲染出 micro，与改动前的行为一致。
   */
  spanW?: number
  spanH?: number
}>()

const today = useToday()

/**
 * 全部派生日期算一次，作为单个 prop 下传。
 *
 * useToday 只在这里订阅：它靠 onBeforeUnmount 做引用计数，
 * 每个子组件各订阅一次会造成十对订阅/退订，而模块级 ref 本就保证读到同一个值。
 */
const view = computed(() => calendarView(today.value))

/** 版式由占格形状唯一决定，像素换算仍全在 CSS 里 */
const variant = computed(() => calendarVariant(props.spanW, props.spanH))

/** 子组件按占格数做局部取舍（如本周条是否放得下），走同一个夹取入口 */
const span = computed(() => ({ w: clampSpan(props.spanW), h: clampSpan(props.spanH) }))

/**
 * 颜色写成内联的 CSS 变量而非直接的 color / background。
 *
 * 好处是缺省档不必在模板里逐个写三元表达式：变量没被设上时，
 * 样式里的 `var(--cal-text, <令牌>)` 自动回落到主题令牌，
 * 「未配置」与「配成当前主题色」因此是两种状态——前者跟着主题走。
 *
 * 仍要过一遍 isHexColor：这些值来自持久化数据，
 * store 已经校验过，这里是第二道，防止将来有别的写入路径绕过它。
 */
const colorStyle = computed(() => {
  const vars: Record<string, string> = {}
  const set = (name: string, value: string | undefined) => {
    if (isHexColor(value)) vars[name] = value
  }
  set('--cal-bg', props.bgColor)
  set('--cal-sub-bg', props.subBgColor)
  set('--cal-text', props.textColor)
  set('--cal-sub-text', props.subTextColor)
  return vars
})

/** `<time datetime>` 要求 YYYY-MM-DD，月日补零 */
const iso = computed(() => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${view.value.year}-${pad(view.value.month)}-${pad(view.value.day)}`
})

const fullText = computed(
  () => `${view.value.year} 年 ${view.value.month} 月 ${view.value.day} 日`,
)
</script>

<template>
  <!--
    可访问名由内容提供而非外层 aria-label：TileCell 对 widget 刻意不写 aria-label，
    否则按钮名会盖掉这里的完整日期，读屏只听得到「日历」而听不到今天几号。

    八个版式各自在根节点写 aria-hidden：month 一档有 42 个日号，
    不隐藏的话可访问名会变成「2026年8月27日 27 28 29 30 31 1 2 3…」。
    唯一的可读内容始终是下面这一个 .sr-only。
  -->
  <time class="cal" :datetime="iso" :title="fullText" :style="colorStyle">
    <span class="sr-only">{{ fullText }}</span>

    <!--
      用 v-if 链而不是 <component :is="MAP[variant]">：
      后者会让 vue-tsc 放弃检查子组件的 props，而这里正好每档传的东西都不同。
    -->
    <CalMicro v-if="variant === 'micro'" :view="view" />
    <CalStrip v-else-if="variant === 'strip'" :view="view" :span-w="span.w" />
    <CalColumn v-else-if="variant === 'column'" :view="view" :span-h="span.h" />
    <CalPanel v-else-if="variant === 'panel'" :view="view" />
    <CalSplit v-else-if="variant === 'split'" :view="view" />
    <CalStack v-else-if="variant === 'stack'" :view="view" />
    <CalMonthTall v-else-if="variant === 'monthTall'" :view="view" />
    <CalMonth v-else :view="view" :span-w="span.w" />
  </time>
</template>

<style scoped>
/*
 * 圆角继承方格：年份条贴着底边，不裁切的话它的直角会顶出方格的圆角之外。
 *
 * 三个尺寸基准，全部三级回落：
 *   --cal-w / --cal-h  真实宽高，由 TileCell 的 --square-w / --square-h 继承而来。
 *                      自定义属性穿透 scoped 边界，网格内无需额外管线。
 *   --cal-size         短边，与 TileIcon 同一套换算。micro / strip 仍按它取，
 *                      1×1 才能与改动前像素一致。
 * 回落链的末端是 --tile-size，兼容只覆写了后者的调用方（如拖拽浮层）。
 *
 * 注意：拖拽浮层把 --tile-size 设成了 min(w, h)，所以各版式一律不得直接读它，
 * 只能读上面这几个别名，否则浮层里非正方形的方块会变形。
 */
.cal {
  --cal-w: var(--square-w, var(--content-size, var(--tile-size)));
  --cal-h: var(--square-h, var(--content-size, var(--tile-size)));
  --cal-size: var(--content-size, var(--tile-size));

  /* .sr-only 是绝对定位的，没有定位祖先时会逃到初始包含块（Dialog 预览里就没有） */
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  /* 未配置时 --cal-bg 未定义，透出方格自身的玻璃底 */
  background: var(--cal-bg, transparent);
  border-radius: inherit;
  user-select: none;
}

/* 版式组件是唯一的 flex 子项，铺满除 .sr-only 以外的全部空间 */
.cal > :not(.sr-only) {
  min-width: 0;
  min-height: 0;
  flex: 1;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  border: 0;
  margin: -1px;
  padding: 0;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>

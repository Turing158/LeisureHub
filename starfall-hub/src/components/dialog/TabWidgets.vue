<script setup lang="ts">
import { WIDGETS, widgetDraft, type WidgetDef } from '@/data/widgets'
import type { TileDraft } from '@/types/tile'

const emit = defineEmits<{
  pick: [draft: TileDraft]
}>()

/**
 * 卡片预览分派：有标识图标的（日历 / 天气 / 搜索）画图标，其余渲染实况组件。
 *
 * 多数内置组件走图标：日历占格后是今天的日期、天气没配地点时是空骨架、
 * 搜索不配引擎是一个迷你输入框、倒计时没配日期是一句「未设置日期」，这些在
 * 「挑一个放进方格」的列表里都读作噪音，换成各自的标识图标（ICON_PATHS）更清楚。
 * 未来谁想回归实况，把它的 key 从 ICON_PATHS 移掉即可；
 * 没配图标的组件走下方 <component> 的实况兜底（待办就是这一档——它的实况是一份
 * 真实清单，那正是它要展示的东西）。
 */
const ICON_PATHS: Record<string, string> = {
  /*
   * 日历：圆角外框（r=2）+ 顶部两枚装订 + 一道表头分隔 + 两条日期刻度。
   * 装订从顶边 y=5 伸到 y=2.4，表头线压 y=12，日期刻度是 y=15.3 的两段短横。
   * 齐 24 视框、无色相线性，与 ContextMenu / EngineIcon 同一套语言。
   */
  calendar:
    'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 12h16M7 15.3h3.4M12.4 15.3h3.4M8 5V2.4M16 5V2.4',
  /** 一朵云——天气组件 11 个字形的共同前奏，读作「天气」 */
  weather:
    'M5.5 16.5h12a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6-1.6A4.2 4.2 0 0 0 5.5 16.5z',
  /*
   * 放大镜：圆 + 斜柄两段子路径。
   * 圆用两段半圆画满（端点精确闭合在 (10.8,5.4)，不会留一道 0.1 的缺缝），
   * 与搜索输入框内部那个自定义引擎图标（circle r5.4 + m15 15l4.4 4.4）同几何。
   */
  search:
    'M10.8 5.4a5.4 5.4 0 1 1 0 10.8a5.4 5.4 0 1 1 0-10.8M15 15l4.4 4.4',
  /*
   * 倒计时：表盘（圆 r=7.6 居中 12,12）+ 一根从圆心指向右上的指针 + 顶上一枚小旋钮。
   *
   * 圆同搜索那个放大镜的画法，用两段半圆画满（端点精确闭合在 (12,4.4)，
   * 不会留一道 0.1 的缺缝）。指针只画一根、指向右上：两根指针读作「时钟」
   * （那是「现在几点」），一根读作「计时」。
   */
  countdown:
    'M12 4.4a7.6 7.6 0 1 1 0 15.2a7.6 7.6 0 1 1 0-15.2M12 8.4V12h3.2M10.2 2.6h3.6',
} as const

/**
 * 卡片预览实况兜底的绑定（只有无图标的组件才走这一档，目前没有任何内置组件命中）。
 *
 * 只传占格，不塞会落成 DOM 属性的额外键，与 TileWidget / TabWidgetEdit
 * 对未知 prop 的处理同一条理由。
 */
function previewBindings(widget: WidgetDef): Record<string, unknown> {
  return {
    spanW: widget.defaultSpan.w,
    spanH: widget.defaultSpan.h,
  }
}
</script>

<template>
  <ul class="widgets">
    <!--
      版式与 TabRecommend 的卡片列表一致：两个 tab 都是「挑一个放进方格」。

      注释写在根元素**内部**，不能挪到 <ul> 之前：开发模式下 Vue 保留模板注释，
      根元素之前多一个注释就让本组件的根变成 Fragment，而 AddTileDialog 的
      tab 过渡是 mode="out-in"——它靠离场节点上新挂的 afterLeave 复位 isLeaving，
      setTransitionHooks 递归到 Fragment 就停了，真正离场的 <ul> 上仍是挂载时
      那套没有 afterLeave 的钩子，于是动画播完后 isLeaving 永远为 true，
      此后切到哪个 tab 都只剩一个注释占位符。
    -->
    <li v-for="widget in WIDGETS" :key="widget.id">
      <button class="card" type="button" @click="emit('pick', widgetDraft(widget))">
        <!--
          预览框内的内容：日历 / 天气 / 搜索 / 倒计时画各自的标识图标（ICON_PATHS）；
          没有配图标的组件才走实况兜底。
        -->
        <span class="card__preview">
          <svg
            v-if="ICON_PATHS[widget.id]"
            class="card__glyph"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path :d="ICON_PATHS[widget.id]" />
          </svg>
          <component
            v-else
            :is="widget.component"
            v-bind="previewBindings(widget)"
          />
        </span>

        <span class="card__meta">
          <span class="card__name">{{ widget.name }}</span>
          <span class="card__sub">{{ widget.desc }}</span>
        </span>
      </button>
    </li>
  </ul>
</template>

<style scoped>
.widgets {
  display: grid;
  min-height: 200px;
  align-content: start;
  margin: 0;
  padding: 0;
  gap: var(--sp-2);
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  list-style: none;
}

.card {
  display: flex;
  width: 100%;
  align-items: center;
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--fill);
  gap: var(--sp-3);
  text-align: left;
  transition:
    background-color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}

/* hover 用中性描边：与 TabRecommend 的卡片同一套语言 */
.card:hover {
  border-color: var(--line-strong);
  background: var(--fill-raised);
}

/*
 * 预览框是一个缩小的方格：组件内部所有尺寸都按 --content-size 换算，
 * 这里给一个卡片内的局部值，圆角同样按同一比例取，与桌面上的观感一致。
 *
 * --square-w/h 与 --content-size 同值：卡片按 defaultSpan（1×1）传占格，
 * 组件因此走 micro 版式，而 micro 只读短边，三者一致即可。
 */
.card__preview {
  --content-size: 56px;
  --square-w: 56px;
  --square-h: 56px;
  display: flex;
  width: 56px;
  height: 56px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--tile-border);
  border-radius: calc(56px * var(--tile-radius-ratio));
  background: var(--tile-bg);
}

/*
 * 日历 / 天气 / 搜索的标识图标。
 *
 * 图标本体按短边 × 0.5 给——与 TileIcon 的 0.56 同源；居中由上方
 * .card__preview 的 flex 负责。实况兜底组件填满整框（自身 width/height
 * 100%），两种内容因此都落在 56px 的圆角方形正中。
 */
.card__glyph {
  display: block;
  width: calc(var(--content-size) * 0.5);
  height: calc(var(--content-size) * 0.5);
  color: var(--color-text-dim);
}

.card__glyph path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.card__meta {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.card__name {
  font-size: var(--fs-base);
}

.card__sub {
  color: var(--color-text-dim);
  font-size: var(--fs-sm);
}
</style>

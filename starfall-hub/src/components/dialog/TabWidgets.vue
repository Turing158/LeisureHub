<script setup lang="ts">
import { WIDGETS, widgetDraft, type WidgetDef } from '@/data/widgets'
import type { TileDraft } from '@/types/tile'

const emit = defineEmits<{
  pick: [draft: TileDraft]
}>()

/**
 * 卡片预览的绑定。
 *
 * `preview` 只传给声明了它的组件（目前只有搜索），不无条件写上：
 * 不认识这个 prop 的组件会把它落成 DOM 属性（preview=""），
 * 与 TileWidget 里对 spanW / spanH 的处理是同一条理由。
 */
function previewBindings(widget: WidgetDef): Record<string, unknown> {
  return {
    spanW: widget.defaultSpan.w,
    spanH: widget.defaultSpan.h,
    ...(widget.id === 'search' ? { preview: true } : {}),
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
          预览用真实组件而非静态图：日历里就该显示今天，
          换成示意图的话用户看不出它到底会显示什么。
        -->
        <span class="card__preview">
          <component :is="widget.component" v-bind="previewBindings(widget)" />
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
  display: block;
  width: 56px;
  height: 56px;
  flex: 0 0 auto;
  overflow: hidden;
  border: 1px solid var(--tile-border);
  border-radius: calc(56px * var(--tile-radius-ratio));
  background: var(--tile-bg);
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

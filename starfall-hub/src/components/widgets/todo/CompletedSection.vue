<script setup lang="ts">
import { ref, useId } from 'vue'

import TodoRow from './TodoRow.vue'
import type { TodoItem } from '@/types/todo'

/**
 * 已完成折叠区。只在 grouped 档出现（list 档的 114px 给不出折叠头的 24px）。
 *
 * TabRecommend.vue 的分类折叠面板已经把三个坑全踩过，逐条照抄，一条都不能省：
 *
 * 1. **不用原生 `<details>`。** 折叠时浏览器根本不渲染子内容，没有可插值的
 *    起点 / 终点高度。结构是 button[aria-expanded][aria-controls] + div[role=region]，
 *    三角指示器的旋转直接挂 [aria-expanded='true']——视觉状态与无障碍状态同源。
 * 2. **grid-template-rows: minmax(0, 0fr)，不是裸 0fr。** 裸 fr 的下界是 auto，
 *    内层列表的 margin-top 会留下一条收不掉的残高（TabRecommend 实测 4px）。
 * 3. **:inert="!open || undefined"。** Vue 把 false 原样渲染成 inert="false"，
 *    而该属性只看存在性，写成 :inert="!open" 会反过来惰化**展开**的面板。
 *
 * 用 0fr → 1fr 而不是 JS 量高度：fr 之间可插值，「到内容自然高度」不必先量一遍，
 * 勾掉一条让内容变高时也不会卡在某个旧值上。时长吃 --dur-base / --dur-fast，
 * html[data-motion=off] 的全局闸会把 duration 压成 0.01ms，这里不必再判一次。
 */
const props = defineProps<{
  items: TodoItem[]
}>()

const emit = defineEmits<{
  toggle: [id: string]
  remove: [id: string]
  /** 清空全部已完成。删的是一批不可再生的数据，父级要接 UndoToast */
  clear: []
}>()

/**
 * 折叠状态存**组件内的 ref，不持久化**。
 *
 * 存进 props 要走一遍 updateTile 的整块替换 + 重新放置，为一个折叠动画付一次
 * 网格重排；存进 settings 又要加字段（而这个组件的承诺是 settings.ts 一字不改）。
 *
 * 默认收起——已完成项是回顾用的，不是每次打开都要看的。
 */
const open = ref(false)

/** aria-controls / aria-labelledby 要成对的稳定 id，交给 useId 生成，避免多方块撞名 */
const uid = useId()
</script>

<template>
  <!--
    N === 0 时整块不渲染（不是渲染一个空面板）——由父级的 v-if 决定，
    这里不再判一次：组件存在即意味着「有已完成项」。
  -->
  <section class="done">
    <div class="done__head">
      <button
        :id="`${uid}-head`"
        class="done__toggle"
        type="button"
        :aria-expanded="open"
        :aria-controls="`${uid}-panel`"
        @click="open = !open"
      >
        <span class="done__label">已完成 {{ props.items.length }}</span>
      </button>
      <!--
        「清空」放在头的右端，与折叠钮并排而不是套在里面：
        button 套 button 不是合法 HTML，浏览器会把内层提出去。
      -->
      <button class="done__clear" type="button" @click="emit('clear')">清空</button>
    </div>

    <div
      :id="`${uid}-panel`"
      class="done__panel"
      :class="{ 'is-open': open }"
      :inert="!open || undefined"
      role="region"
      :aria-labelledby="`${uid}-head`"
    >
      <div class="done__list">
        <TodoRow
          v-for="item in props.items"
          :key="item.id"
          :item="item"
          show-group
          @toggle="emit('toggle', $event)"
          @remove="emit('remove', $event)"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.done {
  display: flex;
  flex: none;
  flex-direction: column;
}

/* 折叠头 26px 写死，是 §3.4 纵向账里的固定占用之一 */
.done__head {
  display: flex;
  height: 26px;
  flex: none;
  align-items: center;
  padding: 0 4px;
  border-radius: var(--r-sm);
  /* 折叠头与计数条、输入行胶囊同属次要面板 */
  background: var(--td-sub-bg, var(--fill));
  gap: var(--sp-2);
}

.done__toggle {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  border-radius: var(--r-sm);
  gap: 5px;
  text-align: left;
}

/*
 * 三角指示器照 TabRecommend：一个旋转的「›」，角度直接读 aria-expanded，
 * 视觉状态与无障碍状态同源，不会各说一套。颜色用中性 dim，遵守无色相约束。
 */
.done__toggle::after {
  order: -1;
  color: var(--color-text-dim);
  content: '›';
  font-size: var(--fs-sm);
  line-height: 1;
  transition: transform var(--dur-base) var(--ease);
}

.done__toggle[aria-expanded='true']::after {
  transform: rotate(90deg);
}

.done__label {
  overflow: hidden;
  color: var(--td-sub-text, var(--color-text-faint));
  font-size: var(--fs-xs);
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.done__toggle:hover .done__label {
  color: var(--td-text, var(--color-text));
}

/* 方块 overflow: hidden，贴边的焦点环外描会被裁掉，一律内描 */
.done__toggle:focus-visible,
.done__clear:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.done__clear {
  flex: none;
  padding: 2px 4px;
  border-radius: var(--r-sm);
  color: var(--td-sub-text, var(--color-text-faint));
  font-size: var(--fs-xs);
  line-height: 1;
  transition: color var(--dur-fast) var(--ease);
}

.done__clear:hover {
  color: var(--danger);
}

/* ── 展开 / 折叠动画（三个坑见文件头） ───────────── */

.done__panel {
  display: grid;
  grid-template-rows: minmax(0, 0fr);
  overflow: hidden;
  opacity: 0;
  transition:
    grid-template-rows var(--dur-base) var(--ease),
    opacity var(--dur-fast) var(--ease);
}

.done__panel.is-open {
  grid-template-rows: minmax(0, 1fr);
  opacity: 1;
}

/* grid item 的自动最小高度同样会顶住 0fr，一并归零 */
.done__panel > * {
  min-height: 0;
}

/*
 * 展开后已完成列表自己也能滚：勾掉二十条之后它会比整个方块还高，
 * 不封顶的话 0fr → 1fr 会把未完成区整个挤出方块。
 * 上限用 em 而不是按 --square-h 算的系数——同一形状有两个高度，系数会差 13%。
 */
.done__list {
  display: flex;
  max-height: 7em;
  flex-direction: column;
  overflow-y: auto;
  /* 顶间距留在被裁切的内容里，折叠后不会剩下一条空隙 */
  margin: 3px 0 0;
  scrollbar-color: rgb(255 255 255 / 0.18) transparent;
  scrollbar-width: thin;
}
</style>

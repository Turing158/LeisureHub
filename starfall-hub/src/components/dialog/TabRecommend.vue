<script setup lang="ts">
import { ref, useId } from 'vue'

import TileIcon from '../TileIcon.vue'
import { RECOMMEND_CATEGORIES } from '@/data/recommend'
import type { TileDraft } from '@/types/tile'

const emit = defineEmits<{
  pick: [draft: TileDraft]
}>()

/**
 * 折叠态按分类标题记账，默认全展开（缺键即展开）。
 *
 * 记「折叠」而不是记「展开」：分类表来自静态数据，新增一类时无需在这里补初始值。
 */
const collapsed = ref<Record<string, boolean>>({})

function isOpen(title: string) {
  return !collapsed.value[title]
}

function toggle(title: string) {
  collapsed.value[title] = isOpen(title)
}

/** aria-controls / aria-labelledby 要成对的稳定 id，交给 useId 生成，避免多实例撞名 */
const uid = useId()
</script>

<template>
  <ul class="recommend">
    <!--
      原先每个分类是原生 <details open>，改成 button + region 的手风琴。
      原因是 <details> 折叠时浏览器压根不渲染子内容，没有可过渡的高度，
      CSS 无从下手；换成常驻 DOM 的面板后，高度才谈得上动画（见样式里的 0fr → 1fr）。
      无障碍语义由 aria-expanded + aria-controls 补齐，与 <summary> 等价。
    -->
    <li
      v-for="(category, i) in RECOMMEND_CATEGORIES"
      :key="category.title"
      class="recommend__category"
    >
      <h3 class="recommend__heading">
        <button
          :id="`${uid}-head-${i}`"
          class="category__head"
          type="button"
          :aria-expanded="isOpen(category.title)"
          :aria-controls="`${uid}-panel-${i}`"
          @click="toggle(category.title)"
        >
          <span class="category__name">{{ category.title }}</span>
          <span class="category__count">{{ category.items.length }}</span>
        </button>
      </h3>

      <!--
        inert 用 `|| undefined` 而非 false：Vue 会把 false 原样渲染成 inert="false"，
        而该属性只看存在性，反而把展开的面板也惰化了。
        折叠期间面板仍在 DOM 里，靠 inert 把内部按钮一并移出焦点序列与无障碍树。
      -->
      <div
        :id="`${uid}-panel-${i}`"
        class="category__panel"
        :class="{ 'is-open': isOpen(category.title) }"
        :inert="!isOpen(category.title) || undefined"
        role="region"
        :aria-labelledby="`${uid}-head-${i}`"
      >
        <ul class="category__list">
          <li v-for="item in category.items" :key="item.name">
            <button class="card" type="button" @click="emit('pick', item)">
              <span class="card__icon">
                <TileIcon
                  :name="item.name"
                  :icon="'icon' in item ? item.icon : undefined"
                  :bg-color="'bgColor' in item ? item.bgColor : undefined"
                />
              </span>
              <span class="card__meta">
                <span class="card__name">{{ item.name }}</span>
                <span class="card__sub">{{ 'url' in item ? item.url : '内置组件' }}</span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.recommend {
  min-height: 200px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.recommend__category + .recommend__category {
  margin-top: var(--sp-3);
}

/* 标题层级只为语义（分类是 h3），视觉尺寸全交给内部按钮 */
.recommend__heading {
  margin: 0;
  font-size: inherit;
  font-weight: inherit;
}

/* ── 分类折叠头 ─────────────────────────────── */

.category__head {
  display: flex;
  width: 100%;
  align-items: center;
  padding: var(--sp-2) 0;
  border-radius: var(--r-sm);
  gap: var(--sp-2);
  text-align: left;
  user-select: none;
}

/*
 * 三角指示器：未开时指向右。用一个旋转的「›」字形表示，不额外画六点小图标。
 * 旋转角度直接读 aria-expanded，视觉状态与无障碍状态同源，不会各说一套。
 * 颜色用中性 dim，遵守无色相约束。
 */
.category__head::after {
  content: '›';
  color: var(--color-text-dim);
  font-size: var(--fs-md);
  line-height: 1;
  transition: transform var(--dur-base) var(--ease);
}

.category__head[aria-expanded='true']::after {
  transform: rotate(90deg);
}

.category__name {
  flex: 1;
  font-size: var(--fs-md);
  font-weight: 600;
}

.category__count {
  color: var(--color-text-dim);
  font-size: var(--fs-sm);
}

.category__head:hover .category__name {
  color: var(--color-text);
}

.category__head:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

/* ── 展开 / 折叠动画 ───────────────────────────── */

/*
 * 高度过渡走 grid-template-rows 的 0fr → 1fr：fr 之间可插值，
 * 于是「到内容自然高度」这件事不必先用 JS 量一遍，纯 CSS 就能收敛，
 * 内容随后变化（图标加载完撑高一行）也不会卡在某个量过的旧值上。
 * 时长与总闸都吃 style.css 的令牌，data-motion=off 时自动被压成瞬时。
 */
.category__panel {
  display: grid;
  /*
   * 写 minmax(0, 0fr) 而不是裸 0fr：裸 fr 的下界是 auto，
   * 列表的 margin-top 会作为轨道的自动最小值留下 4px 收不掉的残高
   * （子元素 min-height:0 管不到 margin）。显式给 0 下界才真能压平。
   */
  grid-template-rows: minmax(0, 0fr);
  /* 折叠中内容比行高高，必须切掉，否则会溢出压住下一个分类 */
  overflow: hidden;
  opacity: 0;
  transition:
    grid-template-rows var(--dur-base) var(--ease),
    opacity var(--dur-fast) var(--ease);
}

.category__panel.is-open {
  grid-template-rows: minmax(0, 1fr);
  opacity: 1;
}

/* grid item 的自动最小高度同样会顶住 0fr，一并归零 */
.category__panel > * {
  min-height: 0;
}

/* 卡片列表：与旧版一致的网格，只是收到分类内部 */
.category__list {
  display: grid;
  /* 顶间距留在被裁切的内容里，折叠后不会剩下一条空隙 */
  margin: var(--sp-1) 0 0;
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

/* hover 用中性描边：--accent 只留给「已选中」这类状态，悬停不是状态 */
.card:hover {
  border-color: var(--line-strong);
  background: var(--fill-raised);
}

/* 焦点环内描：面板 overflow:hidden 会裁掉外扩的轮廓，贴边的卡片就看不见焦点了 */
.card:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.card__icon {
  /* TileIcon 的字号依赖 --tile-size，这里给一个卡片内的局部值 */
  --tile-size: 44px;
  display: block;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  border-radius: var(--r-md);
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
  overflow: hidden;
  color: var(--color-text-dim);
  font-size: var(--fs-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

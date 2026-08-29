<script setup lang="ts">
import { computed } from 'vue'

import CalMonthGrid from './CalMonthGrid.vue'
import type { CalendarView } from './dateGrid'

const props = defineProps<{
  view: CalendarView
  /** 3..4。h 恒为 3（h≥4 走 monthTall），所以只有宽度还需要分支 */
  spanW: number
}>()

/**
 * 周数只在 w≥4 出现。
 *
 * w=3 只有 265px 宽，「星期四 · 第 35 周」这一串加上左边的年月几乎填满整行，
 * 右端会顶到方格圆角上；周数是这一档信息价值最低的一项，先舍它。
 * w=4 有 360px，两组字之间仍有近百像素空隙，留着。
 */
const showWeek = computed(() => props.spanW >= 4)
</script>

<template>
  <!--
    w≥3, h=3（265×317、360×317）。宽度够 7 列各 37.8px，网格成为主角，
    日期数字不再放大——这一档的信息量在「整月」而不在「今天几号」。

    h≥4 由 CalMonthTall 接手：那一档纵向多出的 121px 够放一个今日区，
    而这里的公式全部按 h=3 的 317px 算。
  -->
  <div class="month" aria-hidden="true">
    <!--
      周数只在 w≥4 出现，w=3 时连分隔点一起省掉：
      265px 宽下「星期四 · 第 35 周」会把右端顶到方格圆角上。
    -->
    <div class="month__head">
      <span class="month__ym">{{ view.year }} 年 {{ view.month }} 月</span>
      <span class="month__meta">
        {{ showWeek ? `${view.weekdayText} · 第 ${view.week} 周` : view.weekdayText }}
      </span>
    </div>

    <CalMonthGrid class="month__grid" :grid="view.grid" header />
  </div>
</template>

<style scoped>
/*
 * 内边距与字号按短边给（--cal-size），不按宽给：
 * 4×3 时宽 360 高 317，按宽算的内边距会让 7 列挤到比 3×3 更窄。
 *
 * 网格字号则按宽算：列宽由宽度决定，跟着短边走会让 4×4（360×438，短边 360）
 * 与 4×3（短边 317）的字号差 13%，而两者列宽完全相同。
 */
.month {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  padding: calc(var(--cal-size) * 0.06) calc(var(--cal-size) * 0.055);
}

/*
 * 页眉比网格多缩进一道。
 *
 * 方格圆角在这一档是 26px，而网格那 0.055 的内边距只有 15..20px：
 * 两端的字正好落在圆角切走的那块里。网格自身不加这道缩进——它是 7 等分的，
 * 缩进会连带把每一列都压窄，而首末列的数字位于列心，本就够远。
 */
.month__head {
  display: flex;
  flex: 0 0 auto;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 calc(var(--cal-size) * 0.035) calc(var(--cal-size) * 0.05);
  gap: calc(var(--cal-size) * 0.04);
}

/* 折成两行的 --stack 与给网格封顶的 --tall 已随 h≥4 一起移交 CalMonthTall */
.month__ym {
  color: var(--cal-text, var(--color-text));
  font-size: calc(var(--cal-size) * 0.075);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

.month__meta {
  color: var(--cal-sub-text, var(--color-text-dim));
  font-size: calc(var(--cal-size) * 0.055);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

.month__grid {
  --cal-grid-font: calc(var(--cal-w) * 0.062);
  --cal-grid-gap: 0.2em;
  min-height: 0;
}
</style>

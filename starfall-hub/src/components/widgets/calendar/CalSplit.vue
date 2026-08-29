<script setup lang="ts">
import CalMonthGrid from './CalMonthGrid.vue'
import type { CalendarView } from './dateGrid'

defineProps<{ view: CalendarView }>()
</script>

<template>
  <!--
    w≥3, h=2（265×196 起）。整月网格横放在日期块旁边。
    年份条在这一档取消：页眉加 6 行网格已经把 196px 占满，
    再留一条 26% 高的横带，网格行高就会掉到 20px 以下。
  -->
  <div class="split" aria-hidden="true">
    <div class="split__side">
      <span class="split__wd">{{ view.weekdayText }}</span>
      <span class="split__day">{{ view.day }}</span>
      <!--
        年月不加空格，与其它版式的「2026 年 8 月」不同。
        3×2 的左栏去掉内边距只剩约 80px，两个空格就是 4px，
        nowrap 之下这一行会顶出栏外压到网格上，看起来不像独立的一行。
      -->
      <span class="split__ym">{{ view.year }}年{{ view.month }}月</span>
    </div>

    <CalMonthGrid class="split__grid" :grid="view.grid" header />
  </div>
</template>

<style scoped>
.split {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: stretch;
}

/*
 * 左栏定宽 38%：随内容伸缩的话，2 月与 12 月的网格列宽会不同，
 * 每月一次的宽度跳变比一点空隙更扎眼。
 *
 * 内边距从 0.02 提到 0.04：3×2 时左栏只有 100px，原先两侧各 5px，
 * 左边的字贴着方格圆角、右边的字贴着分隔线。
 */
.split__side {
  display: flex;
  width: 38%;
  min-width: 0;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 calc(var(--cal-w) * 0.04);
  gap: calc(var(--cal-h) * 0.03);
}

/*
 * 三行字号整体收一档（原为 0.1 / 0.34 / 0.09）。
 *
 * 关键是最长的那行：「2026 年 8 月」按 0.09 算出约 96px，比 3×2 左栏
 * 去掉内边距后剩下的 79px 还宽——nowrap 之下它会顶出栏外压到网格上，
 * 看起来像年月和网格挤在同一行。收到 0.065 后约 69px，两侧都留出余量。
 */
.split__wd {
  color: var(--cal-sub-text, var(--color-text-dim));
  font-size: calc(var(--cal-h) * 0.085);
  line-height: 1;
  white-space: nowrap;
}

.split__day {
  color: var(--cal-text, var(--color-text));
  font-size: calc(var(--cal-h) * 0.3);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: 1;
}

.split__ym {
  color: var(--cal-sub-text, var(--color-text-dim));
  font-size: calc(var(--cal-h) * 0.065);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

/*
 * 竖分隔线而非 gap：一条线明确「左右是两件事」，
 * 同样宽度的空白只会让人以为网格没对齐。
 *
 * 字号按宽算：4×2 与 3×2 高度相同（196px）而宽度差 95px，
 * 按高算会让两档字号一致、4×2 的列间多出大片空白。
 */
.split__grid {
  --cal-grid-font: calc(var(--cal-w) * 0.055);
  --cal-grid-gap: 0.15em;
  min-width: 0;
  flex: 1;
  padding: calc(var(--cal-h) * 0.05) calc(var(--cal-w) * 0.025);
  border-left: 1px solid var(--tile-border);
}
</style>

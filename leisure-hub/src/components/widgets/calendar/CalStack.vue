<script setup lang="ts">
import CalMonthGrid from './CalMonthGrid.vue'
import type { CalendarView } from './dateGrid'

defineProps<{ view: CalendarView }>()
</script>

<template>
  <!--
    w=2, h≥3（170×317 起）。只有 170px 宽，7 列各 24px，
    刚够两位数但放不下星期头，所以 CalMonthGrid 不传 header。
  -->
  <div class="stack" aria-hidden="true">
    <div class="stack__top">
      <span class="stack__wd">{{ view.weekdayText }}</span>
      <span class="stack__day">{{ view.day }}</span>
      <span class="stack__ym">{{ view.year }} 年 {{ view.month }} 月</span>
    </div>

    <CalMonthGrid class="stack__grid" :grid="view.grid" />
  </div>
</template>

<style scoped>
.stack {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
}

/*
 * 上半按比例长高（h=3 与 h=4 差 121px），网格行高保持不变：
 * 让网格吃掉全部增量会把 24px 的列宽配上 40px 的行高，格子拉成竖条。
 */
.stack__top {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: calc(var(--cal-w) * 0.03);
}

.stack__wd {
  color: var(--cal-sub-text, var(--color-text-dim));
  font-size: calc(var(--cal-w) * 0.1);
  line-height: 1;
}

.stack__day {
  color: var(--cal-text, var(--color-text));
  font-size: calc(var(--cal-w) * 0.34);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: 1;
}

.stack__ym {
  color: var(--cal-sub-text, var(--color-text-dim));
  font-size: calc(var(--cal-w) * 0.09);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

/*
 * 网格高度取「按宽算」与「按高算」的较小值。
 *
 * 只按 --cal-w 给：h=4 时上半会空出 250px，视觉重心整个塌到顶部。
 * 只按 --cal-h 给：h=4 时行高涨到 47px 而列宽仍是 24px，格子拉成竖条。
 * 取 min 后 h=3 得 174px（行高 29）、h=4 得 195px（行高 32），都与 24px 列宽接近方形。
 *
 * 字号比 0.085 收一档：170px 宽 ÷ 7 只有 24px 一列，两位数按原字号几乎顶满列宽，
 * 整片网格看起来是糊在一起的。
 *
 * 底部内边距明显大于顶部，把整片网格往上提：末行落在方格底部的圆角带里，
 * 两位数的左右两端会被圆角逼到没有余量（4×4 档圆角半径 26px）。
 */
.stack__grid {
  --cal-grid-font: calc(var(--cal-w) * 0.075);
  --cal-grid-gap: 0.15em;
  height: min(calc(var(--cal-w) * 1.15), calc(var(--cal-h) * 0.55));
  flex: 0 0 auto;
  padding: calc(var(--cal-w) * 0.05) calc(var(--cal-w) * 0.06) calc(var(--cal-w) * 0.12);
  border-top: 1px solid var(--tile-border);
}
</style>

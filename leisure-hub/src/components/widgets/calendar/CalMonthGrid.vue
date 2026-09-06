<script setup lang="ts">
import type { WeekRow } from './dateGrid'
import { WEEKDAY_LABELS } from './dateGrid'

defineProps<{
  /** 恒 6 行 × 7 列 */
  grid: WeekRow[]
  /** 是否显示顶部的星期头；窄版式（stack）省掉它换取行高 */
  header?: boolean
}>()
</script>

<template>
  <!-- 整块 aria-hidden：42 个日号会把方格的可访问名淹没 -->
  <div class="mg" aria-hidden="true">
    <div v-if="header" class="mg__head">
      <span v-for="label in WEEKDAY_LABELS" :key="label" class="mg__wd">{{ label }}</span>
    </div>

    <div class="mg__body">
      <template v-for="row in grid" :key="row.days[0].key">
        <span
          v-for="cell in row.days"
          :key="cell.key"
          class="mg__cell"
          :class="{ 'is-today': cell.isToday, 'is-outside': cell.offset !== 0 }"
          >{{ cell.day }}</span
        >
      </template>
    </div>
  </div>
</template>

<style scoped>
/*
 * 行高由 --cal-grid-row 决定，字号由 --cal-grid-font 决定，两者都由调用方给。
 * split / stack / month 三档的可用高度差一倍，共用一套比例必然有一档溢出。
 */
.mg {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--cal-grid-gap, 0.2em);
  font-size: var(--cal-grid-font, calc(var(--cal-w) * 0.055));
  line-height: 1;
}

.mg__head,
.mg__body {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}

/*
 * 星期头。
 *
 * 底色用「次要背景」这一块面而不是一条下边框线：一条 1px 线在 3×3 的方格里
 * 几乎看不见，而整块底色能一眼把「表头」与 42 个日号分开，
 * 也与年份条、今日高亮共用同一种「被强调的面」的语义。
 *
 * 圆角按字号给（em）：本组件在 split 里字号约 15px、在 month 里约 22px，
 * 固定像素会在前者显得太圆。
 */
.mg__head {
  padding: 0.35em 0;
  border-radius: 0.4em;
  background: var(--cal-sub-bg, var(--widget-band-bg));
  color: var(--cal-sub-text, var(--color-text-dim));
  font-size: 0.85em;
  margin-bottom: 0.3em;
}

.mg__body {
  min-height: 0;
  flex: 1;
  /*
   * 6 行等分，行高不随月份变化。
   * 用 grid-auto-rows: 1fr 而非 repeat(6, 1fr)：42 个格子是平铺的，
   * 行数由 7 列自动折出来，显式写行数就要在两处维护同一个 6。
   */
  grid-auto-rows: 1fr;
}

.mg__wd,
.mg__cell {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
}

.mg__cell {
  color: var(--cal-text, var(--color-text));
  font-variant-numeric: tabular-nums;
}

/* 非本月：降透明度而不换色，避免与 --color-text-dim 的 alpha 叠加失控 */
.mg__cell.is-outside {
  color: var(--cal-sub-text, var(--color-text-dim));
  opacity: 0.4;
}

/*
 * 今日高亮：小圆角矩形。
 *
 * 圆角读 --cal-active-radius（定义在 CalendarWidget 的 .cal 上），
 * 与 CalWeekRail 的今日块共用同一个值——「今天」在八个版式里是同一件事，
 * 圆角不该各档各写一个数。它是 em，故仍随当地字号等比缩放。
 * 回落值写齐，供不经 .cal 直接渲染本组件的调用方（目前没有，留作保险）。
 *
 * 不铺满整格（留 0.15em 内缩）：方格自身的圆角在 3×3 时半径达 58px，
 * 通铺的块面会被四角切掉一块。
 */
.mg__cell.is-today {
  margin: 0.15em;
  border-radius: var(--cal-active-radius, 0.3em);
  background: var(--cal-sub-bg, var(--widget-band-bg));
  color: var(--cal-text, var(--color-text));
  font-weight: 600;
}
</style>

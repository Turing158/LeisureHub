<script setup lang="ts">
import CalWeekRail from './CalWeekRail.vue'
import type { CalendarView } from './dateGrid'

defineProps<{ view: CalendarView }>()
</script>

<template>
  <!--
    2×2（170×196）。第一次同时放得下页眉、大日期与本周条：
    7 列各 24px 刚够两位数，再窄一档（strip 的 2×1）就只能省掉本周。
  -->
  <div class="panel" aria-hidden="true">
    <div class="panel__head">
      <span class="panel__ym">{{ view.year }} 年 {{ view.month }} 月</span>
      <span class="panel__wd">{{ view.weekdayText }}</span>
    </div>

    <div class="panel__main">
      <span class="panel__day">{{ view.day }}</span>
    </div>

    <CalWeekRail class="panel__rail" :week="view.currentWeek" />

    <span class="panel__year">{{ view.year }}</span>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  padding-top: calc(var(--cal-w) * 0.05);
}

/*
 * 页眉的左右缩进明显大于其它块。
 *
 * 它贴着方格顶部，两端的字正落在圆角切走的那一块里：
 * 圆角在这一档是 26px，而 0.06 的缩进只有 10px，年月的「2」与星期的「四」
 * 会碰到弧线。0.11 后两端各有 19px，与弧线拉开。
 */
.panel__head {
  display: flex;
  flex: 0 0 auto;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 calc(var(--cal-w) * 0.11);
  color: var(--cal-sub-text, var(--color-text-dim));
  font-size: calc(var(--cal-w) * 0.08);
  line-height: 1;
  gap: calc(var(--cal-w) * 0.04);
}

.panel__ym,
.panel__wd {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.panel__main {
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
}

.panel__day {
  color: var(--cal-text, var(--color-text));
  font-size: calc(var(--cal-w) * 0.34);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: 1;
}

.panel__rail {
  --rail-font: calc(var(--cal-w) * 0.085);
  flex: 0 0 auto;
  padding: calc(var(--cal-w) * 0.04) calc(var(--cal-w) * 0.03);
}

/* 年份条在这一档保留：196px 高还撑得住，且它是日历最易辨识的特征 */
.panel__year {
  display: flex;
  height: calc(var(--cal-w) * 0.17);
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  background: var(--cal-sub-bg, var(--widget-band-bg));
  color: var(--cal-text, var(--widget-band-text));
  font-size: calc(var(--cal-w) * 0.1);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  line-height: 1;
}
</style>

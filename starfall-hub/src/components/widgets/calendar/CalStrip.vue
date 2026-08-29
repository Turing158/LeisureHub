<script setup lang="ts">
import { computed } from 'vue'

import CalWeekRail from './CalWeekRail.vue'
import type { CalendarView } from './dateGrid'

const props = defineProps<{
  view: CalendarView
  /** 2..4，决定右侧是否放得下本周条 */
  spanW: number
}>()

/**
 * 本周条只在 w≥3 时出现。
 *
 * 2×1 是 170×75，左侧日期块占掉 75，右侧只剩 95px；
 * 7 列各 13px 连两位数都放不下，塞进去只会变成一片糊字。
 */
const showRail = computed(() => props.spanW >= 3)
</script>

<template>
  <div class="strip" aria-hidden="true">
    <!--
      左侧日期块是正方形，宽度硬绑高度。
      横排的高只有 75px，若沿用 micro 的横向年份条会吃掉四分之一，
      所以把「次要背景」这块面转 90 度立到左边，年月改排到右侧文字里。
    -->
    <div class="strip__box">
      <span class="strip__day">{{ view.day }}</span>
    </div>

    <div class="strip__text">
      <span class="strip__wd">{{ view.weekdayText }}</span>
      <!--
        带本周条时年份让位：3×1 里三者并排只有 265px，
        「2026 年 8 月」这一串会把本周条挤到每列 11px。
        年份在这一档不是关键信息（用户看的是今天几号），星期与月份才是。
      -->
      <span class="strip__ym">{{ showRail ? `${view.month} 月` : `${view.year} 年 ${view.month} 月` }}</span>
    </div>

    <CalWeekRail v-if="showRail" class="strip__rail" :week="view.currentWeek" />
  </div>
</template>

<style scoped>
.strip {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: stretch;
}

/* aspect-ratio 而非固定宽：--cal-h 在拖拽浮层与预览框里都不是 75px */
.strip__box {
  display: flex;
  aspect-ratio: 1;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  background: var(--cal-sub-bg, var(--widget-band-bg));
}

.strip__day {
  color: var(--cal-text, var(--widget-band-text));
  font-size: calc(var(--cal-h) * 0.5);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: 1;
}

.strip__text {
  display: flex;
  min-width: 0;
  flex: 0 0 auto;
  flex-direction: column;
  justify-content: center;
  padding: 0 calc(var(--cal-h) * 0.14);
  gap: calc(var(--cal-h) * 0.06);
}

.strip__wd {
  color: var(--cal-text, var(--color-text));
  font-size: calc(var(--cal-h) * 0.19);
  line-height: 1;
  white-space: nowrap;
}

.strip__ym {
  color: var(--cal-sub-text, var(--color-text-dim));
  font-size: calc(var(--cal-h) * 0.15);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

/*
 * 本周条吃掉剩余宽度。
 * 竖分隔线而非 gap：3×1 时右侧只有 115px，一条线比一段空白更省地方。
 * 3×1 的每列约 15px、4×1 约 29px，所以字号按可用宽而非高来取。
 */
.strip__rail {
  --rail-font: calc(var(--cal-w) * 0.032);
  min-width: 0;
  flex: 1;
  padding: 0 calc(var(--cal-h) * 0.06);
  border-left: 1px solid var(--tile-border);
}
</style>

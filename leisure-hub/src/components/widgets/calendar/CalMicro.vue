<script setup lang="ts">
import type { CalendarView } from './dateGrid'

defineProps<{ view: CalendarView }>()
</script>

<template>
  <!--
    1×1。改动前的唯一形态，比例与元素结构原样保留：
    这一档在桌面上出现得最多，任何偏移都会被当成回归。
  -->
  <div class="micro" aria-hidden="true">
    <span class="micro__main">
      <span class="micro__day">{{ view.day }}</span>
      <span class="micro__month">{{ view.month }}月</span>
    </span>
    <span class="micro__year">{{ view.year }}</span>
  </div>
</template>

<style scoped>
.micro {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
}

/* 日 + 月占据除年份条以外的全部空间，整体居中 */
.micro__main {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: calc(var(--cal-size) * 0.03);
}

/* 等宽数字：1 与 11 之间不会因字宽差异而左右跳动 */
.micro__day {
  color: var(--cal-text, var(--color-text));
  font-size: calc(var(--cal-size) * 0.42);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: 1;
}

.micro__month {
  color: var(--cal-sub-text, var(--color-text-dim));
  font-size: calc(var(--cal-size) * 0.15);
  line-height: 1;
}

.micro__year {
  display: flex;
  height: calc(var(--cal-size) * 0.26);
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  background: var(--cal-sub-bg, var(--widget-band-bg));
  color: var(--cal-text, var(--widget-band-text));
  font-size: calc(var(--cal-size) * 0.15);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  line-height: 1;
}
</style>

<script setup lang="ts">
import { computed } from 'vue'

import type { WeekRow } from './dateGrid'

/**
 * 圆点阵列：一格一点，7 列，行数由入参决定。
 *
 * 与 CalMonthGrid 是两种取舍而非重复：竖排档只有 75px 宽，
 * 7 列各 9px 放不下两位数，但一格一点仍能表达「今天落在这一周 / 这一月的什么位置」。
 * 三种状态（今日 / 本月 / 非本月）与 CalMonthGrid 一一对应。
 *
 * 传 [currentWeek] 得一行、传 grid 得六行，1×2 与 1×4 因此共用同一个组件。
 */
const props = defineProps<{ rows: WeekRow[] }>()

/**
 * 拍平成一维再交给 grid 的自动折行。
 *
 * 在 computed 里而非模板里 flatMap：模板表达式每次渲染都会重算，
 * 而这里的入参是外壳算好一次的 view，跨零点才变。
 */
const cells = computed(() => props.rows.flatMap((row) => row.days))
</script>

<template>
  <!-- 整块 aria-hidden：42 个日号会把方格的可访问名淹没，理由同 CalMonthGrid -->
  <div class="dots" aria-hidden="true">
    <span v-for="cell in cells" :key="cell.key" class="dots__cell">
      <span
        class="dots__dot"
        :class="{ 'is-today': cell.isToday, 'is-outside': cell.offset !== 0 }"
      ></span>
    </span>
  </div>
</template>

<style scoped>
/*
 * 尺寸不在这里算：直径读调用方给的 --dot-size / --dot-today-size，
 * 与 CalWeekRail 读 --rail-font 是同一分工。
 * 同一个点阵在竖排档横跨 63px、将来若用在别处宽度未必相同。
 */
.dots {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(7, 1fr);
  /* 行数由 7 列自动折出来，不显式写行数：一处维护即可 */
  grid-auto-rows: 1fr;
}

.dots__cell {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
}

/*
 * 点本身用固定宽高而非 aspect-ratio：格子只有 9px，
 * 交给比例算会因 1fr 的小数余量在相邻列间差半像素，一排点看起来大小不齐。
 */
.dots__dot {
  width: var(--dot-size, calc(var(--cal-w) * 0.05));
  height: var(--dot-size, calc(var(--cal-w) * 0.05));
  border-radius: 999px;
  background: var(--cal-sub-text, var(--color-text-dim));
}

/* 非本月：降透明度而不换色，--color-text-dim 本身已是 rgba，再叠一层色会失控 */
.dots__dot.is-outside {
  opacity: 0.35;
}

/*
 * 今日点更大更亮。
 * 只有这一点用「主要文字」色，它在点阵里是唯一需要一眼定位的那个。
 */
.dots__dot.is-today {
  width: var(--dot-today-size, calc(var(--cal-w) * 0.07));
  height: var(--dot-today-size, calc(var(--cal-w) * 0.07));
  background: var(--cal-text, var(--color-text));
}
</style>

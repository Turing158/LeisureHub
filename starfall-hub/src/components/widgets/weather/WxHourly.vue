<script setup lang="ts">
import { computed } from 'vue'

import type { WeatherHour } from './types'

const props = defineProps<{
  hours: WeatherHour[]
  /** 取前几段。横排 6 或 12，竖排 6 */
  count: number
  /** 折线下方是否画时刻标签。窄档（3×1、3×3）放不下 */
  labels?: boolean
  /**
   * 竖排：一行「时刻 + 温度」，若干行纵向排列。
   *
   * column 版式只有 75px 宽，横向 6 段折线每段 10px 已读不出起伏，
   * 只能把「时间轴」这件事从横轴转到纵轴——与 CalWeekRail 的竖排同理。
   */
  vertical?: boolean
}>()

const list = computed(() => props.hours.slice(0, props.count))

/** 「14」而非「14时」：两位数在 30px 宽的格子里刚好，加个「时」就要换行 */
function pad(hour: number): string {
  return String(hour).padStart(2, '0')
}

/**
 * 折线的点。
 *
 * viewBox 是 0 0 100 100 + preserveAspectRatio="none"，缩放全交给 CSS，
 * 组件内不做像素运算——与「几何全部由 CSS 变量驱动」一致。
 *
 * x 取每列的中心 `(i + 0.5) / n`，而不是把首末点贴在 0 与 100：
 * 下方的时刻标签是 n 等分的网格，只有点落在列中心时两者才对得上。
 * 首末点贴边还会让线头被 overflow 切掉半个线宽。
 *
 * y 反向（温度高 → y 小），并上下各留 12 的余量：
 * 满幅时线会贴着上下边缘，看起来像被裁过。
 */
const PAD_Y = 12

const points = computed(() => {
  const items = list.value
  if (items.length === 0) return ''

  const temps = items.map((item) => item.temp)
  const min = Math.min(...temps)
  const max = Math.max(...temps)
  // 全段等温时 span 为 0，画在正中而不是除以零
  const span = max - min

  return items
    .map((item, i) => {
      const x = ((i + 0.5) / items.length) * 100
      const ratio = span === 0 ? 0.5 : (item.temp - min) / span
      const y = 100 - PAD_Y - ratio * (100 - PAD_Y * 2)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
})
</script>

<template>
  <div class="hourly" :class="{ 'hourly--v': vertical }" aria-hidden="true">
    <!-- 竖排：一列「时刻 + 温度」，两项一行 -->
    <template v-if="vertical">
      <div v-for="(item, i) in list" :key="i" class="hourly__row">
        <span class="hourly__clock">{{ pad(item.hour) }}</span>
        <span class="hourly__temp">{{ item.temp }}°</span>
      </div>
    </template>

    <template v-else>
      <!--
        SVG 而非 canvas：6-12 个点的 DOM 开销可忽略，
        而 canvas 要处理 DPR、resize 与首帧空白三件事。
      -->
      <svg
        class="hourly__chart"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <polyline :points="points" />
      </svg>

      <div v-if="labels" class="hourly__ticks">
        <span v-for="(item, i) in list" :key="i" class="hourly__tick">{{ pad(item.hour) }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.hourly {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: var(--wx-hourly-gap, 2px);
}

/* ── 横排折线 ───────────────────────────────────────── */

.hourly__chart {
  display: block;
  width: 100%;
  min-height: 0;
  flex: 1;
  color: var(--wx-text, var(--color-text));
}

/*
 * vector-effect: non-scaling-stroke 是必需的。
 *
 * preserveAspectRatio="none" 把 100×100 的坐标系拉成任意长宽比，
 * 不加这一句时线宽会跟着一起被拉伸——4×1 的折线横向被拉扁 5 倍，
 * 竖笔画粗、横笔画细，看起来像手写体。拖拽浮层里长宽比又变一次，尤其明显。
 */
.hourly__chart polyline {
  fill: none;
  stroke: currentColor;
  stroke-width: var(--wx-line, 1.5);
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

/*
 * 时刻标签：n 等分网格，与折线的 x 取列中心正好对齐。
 * 不用 space-between：那会让首末两项贴边，与点的位置差半列。
 */
.hourly__ticks {
  display: grid;
  flex: 0 0 auto;
  grid-auto-columns: 1fr;
  grid-auto-flow: column;
}

.hourly__tick {
  overflow: hidden;
  color: var(--wx-sub-text, var(--color-text-dim));
  font-size: var(--wx-fs-tick, 10px);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  text-align: center;
}

/* ── 竖排 ───────────────────────────────────────────── */

.hourly--v {
  justify-content: space-between;
}

.hourly__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--wx-hourly-gap, 4px);
}

.hourly__clock {
  color: var(--wx-sub-text, var(--color-text-dim));
  font-size: var(--wx-fs-tick, 10px);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.hourly__temp {
  color: var(--wx-text, var(--color-text));
  font-size: var(--wx-fs-tick, 10px);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
</style>

<script setup lang="ts">
import { computed } from 'vue'

import WxHourly from './WxHourly.vue'
import WxIcon from './WxIcon.vue'
import WxTemp from './WxTemp.vue'
import type { WeatherView } from './types'

const props = defineProps<{
  view: WeatherView
  stale?: boolean
  /** 2..4，决定右侧是否放得下折线、折线是否带时刻标签 */
  spanW: number
}>()

/**
 * 折线仅 w≥3。
 *
 * 2×1 是 170×75，左侧图标块占掉 75，右侧只剩 95px；
 * 6 段折线每段 15px 已无可读的起伏。
 */
const showChart = computed(() => props.spanW >= 3)

/** 时刻标签仅 4×1：3×1 的折线区只有 115px，6 个两位数各 19px 会挤在一起 */
const showTicks = computed(() => props.spanW >= 4)
</script>

<template>
  <div class="strip" aria-hidden="true">
    <!--
      左侧正方形图标块，与 CalStrip 的日期块同构（aspect-ratio: 1 + 次要背景）。
      横排的高只有 75px，把「次要背景」这块面立到左边比横铺一条更省纵向空间。
    -->
    <div class="strip__box">
      <WxIcon class="strip__icon" :name="view.icon" />
    </div>

    <!--
      右侧三行，而不是设计草图上的两行。

      §6 的横向账：2×1 右侧可用 74px，「-27°」@19 约 40 + 间距 6 +
      「31/24」@11.3 约 34 = 80px，溢出 6px。所以高低温单独换到第三行，
      三行各 0.19h / 0.25h / 0.15h 共 44px < 75 − 2×7.5。
      w≥3 时右侧宽度充裕，但仍用同一个三行结构——同一档内换排法
      会让 2×1 与 3×1 看起来像两个组件。
    -->
    <div class="strip__text">
      <span class="strip__word">{{ view.text }}</span>
      <WxTemp :value="view.temp" :stale="stale" />
      <span class="strip__hl">{{ view.high }}/{{ view.low }}</span>
    </div>

    <WxHourly
      v-if="showChart"
      class="strip__chart"
      :hours="view.hours"
      :count="6"
      :labels="showTicks"
    />
  </div>
</template>

<style scoped>
/*
 * 纵向的量按 --wx-h 算（三档等高，都是 75px），
 * 横向的折线区按 --wx-w：3×1 与 4×1 差 95px，那 95px 全归折线。
 */
.strip {
  --wx-fs-temp: calc(var(--wx-h) * 0.25);
  --wx-stroke: 2;

  display: flex;
  width: 100%;
  height: 100%;
  align-items: stretch;
}

/* aspect-ratio 而非固定宽：--wx-h 在拖拽浮层与预览框里都不是 75px */
.strip__box {
  display: flex;
  aspect-ratio: 1;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  background: var(--wx-sub-bg, var(--widget-band-bg));
}

.strip__icon {
  --wx-icon: calc(var(--wx-h) * 0.44);
  color: var(--wx-text, var(--widget-band-text));
}

.strip__text {
  display: flex;
  min-width: 0;
  flex: 0 0 auto;
  flex-direction: column;
  justify-content: center;
  padding: 0 calc(var(--wx-h) * 0.12);
  gap: calc(var(--wx-h) * 0.04);
}

.strip__word {
  color: var(--wx-text, var(--color-text));
  font-size: calc(var(--wx-h) * 0.19);
  line-height: 1;
  white-space: nowrap;
}

.strip__hl {
  color: var(--wx-sub-text, var(--color-text-dim));
  font-size: calc(var(--wx-h) * 0.15);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

/*
 * 折线吃掉剩余宽度。
 * 竖分隔线而非 gap：3×1 时折线区只有 115px，一条线比一段空白更省地方，
 * 与 CalStrip 的本周条同一处理。
 */
.strip__chart {
  --wx-fs-tick: calc(var(--wx-h) * 0.12);
  --wx-line: 1.5;
  --wx-hourly-gap: calc(var(--wx-h) * 0.03);

  min-width: 0;
  flex: 1;
  padding: calc(var(--wx-h) * 0.14) calc(var(--wx-h) * 0.08);
  border-left: 1px solid var(--tile-border);
}
</style>

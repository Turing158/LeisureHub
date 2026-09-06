<script setup lang="ts">
import { computed } from 'vue'

import WxDaily from './WxDaily.vue'
import WxHourly from './WxHourly.vue'
import WxIcon from './WxIcon.vue'
import WxTemp from './WxTemp.vue'
import type { WeatherView } from './types'

const props = defineProps<{
  view: WeatherView
  stale?: boolean
  /** 3..4，决定右侧是否再分出逐日一带 */
  spanW: number
  place: string
}>()

/**
 * 4×2 的右侧上下分两块：折线在上、逐日 5 项横排在下。
 *
 * 3×2 不分：右侧只有 155px，5 项各 31px 放不下「30/23」（约 40px）。
 * 多出的 95px 恰好让每项涨到 47px，这是 4×2 与 3×2 的实质差别。
 */
const showDaily = computed(() => props.spanW >= 4)
</script>

<template>
  <div class="split" aria-hidden="true">
    <!--
      左栏 38% 与 CalSplit 同宽。

      h=2 只有 196px，没有底条的空间——高低温并入左栏文字，
      与 CalSplit 取消年份条同一个理由。
    -->
    <div class="split__side">
      <span class="split__place">{{ place }}</span>
      <div class="split__now">
        <WxIcon class="split__icon" :name="view.icon" />
        <WxTemp :value="view.temp" :stale="stale" />
      </div>
      <span class="split__word">{{ view.text }}</span>
      <span class="split__hl">{{ view.high }} / {{ view.low }}</span>
    </div>

    <!-- 竖分隔线取 --tile-border，与 CalSplit 同一条 -->
    <div class="split__right">
      <WxHourly class="split__chart" :hours="view.hours" :count="6" labels />
      <WxDaily
        v-if="showDaily"
        class="split__daily"
        :days="view.days"
        :count="5"
        row
        icon
      />
    </div>
  </div>
</template>

<style scoped>
/*
 * 纵向按 --wx-h（两档同高，196px），左栏内的横向量按 --wx-w。
 * 温度按高算：两档等高，按宽算会让 4×2 的温度比 3×2 大三成，
 * 而它们的左栏是同一个 38% 比例、真正相同的是纵向空间。
 */
.split {
  --wx-fs-temp: calc(var(--wx-h) * 0.2);
  --wx-stroke: 1.6;

  display: flex;
  width: 100%;
  height: 100%;
  align-items: stretch;
}

/*
 * 左栏定宽 38%：随内容伸缩的话，逐时区的宽度会随温度位数变化，
 * 折线的横向密度就成了个每天都在变的量。
 *
 * 底色交给「次要背景」（缺省透明）：这一档 h=2 只有 196px，
 * 没有底条也没有实心带的空间，而四项配色每一项都要有落点。
 * 左栏本就是被竖分隔线界定出的一面，是这一档唯一的候选。
 */
.split__side {
  display: flex;
  width: 38%;
  min-width: 0;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 calc(var(--wx-w) * 0.03);
  background: var(--wx-sub-bg, transparent);
  gap: calc(var(--wx-h) * 0.035);
}

/* 3×2 的左栏去掉内边距只剩约 85px，「乌鲁木齐」@8.3px 约 41px，有余量 */
.split__place {
  max-width: 100%;
  overflow: hidden;
  color: var(--wx-sub-text, var(--color-text-dim));
  font-size: calc(var(--wx-h) * 0.085);
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.split__now {
  display: flex;
  align-items: center;
  gap: calc(var(--wx-w) * 0.02);
}

.split__icon {
  --wx-icon: calc(var(--wx-h) * 0.16);
  color: var(--wx-text, var(--color-text));
}

.split__word {
  color: var(--wx-text, var(--color-text));
  font-size: calc(var(--wx-h) * 0.09);
  line-height: 1;
  white-space: nowrap;
}

.split__hl {
  color: var(--wx-sub-text, var(--color-text-dim));
  font-size: calc(var(--wx-h) * 0.075);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

/* ── 右栏 ───────────────────────────────────────────── */

.split__right {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  border-left: 1px solid var(--tile-border);
}

/*
 * 折线区。
 *
 * 字号按宽算：3×2 与 4×2 高度相同而宽度差 95px，按高算会让两档的
 * 时刻标签一样大、4×2 的标签间多出大片空白——与 CalSplit 的网格同一条。
 */
.split__chart {
  --wx-fs-tick: calc(var(--wx-w) * 0.035);
  --wx-line: 1.5;
  --wx-hourly-gap: calc(var(--wx-h) * 0.02);

  min-height: 0;
  flex: 1;
  padding: calc(var(--wx-h) * 0.09) calc(var(--wx-w) * 0.025);
}

/*
 * 逐日横排一带，高度定死。
 * 交给 flex 的话它会与折线对半分掉 196px，折线只剩 80px 高、
 * 起伏被压成一条几乎平的线。
 *
 * 字号 0.028w 是这一档最紧的一处横向账：4×2 的五列各 41px，
 * 而冬季最长态「-28 / -38」按 0.032w 要 42px——加上必需的列间距会贴死。
 * 收到 0.028w 后约 37px，留出 4px 列间距。
 */
.split__daily {
  --wx-fs-daily: calc(var(--wx-w) * 0.028);
  --wx-daily-icon: calc(var(--wx-w) * 0.036);
  --wx-daily-gap: calc(var(--wx-h) * 0.01);
  --wx-daily-col-gap: calc(var(--wx-w) * 0.012);

  height: calc(var(--wx-h) * 0.3);
  flex: 0 0 auto;
  padding: 0 calc(var(--wx-w) * 0.02);
  border-top: 1px solid var(--tile-border);
}
</style>

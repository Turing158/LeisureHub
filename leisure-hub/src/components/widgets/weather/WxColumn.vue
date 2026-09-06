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
  /** 2..4，决定追加到哪个时间尺度 */
  spanH: number
  place: string
}>()

/**
 * 一个顶条 + 若干带 + 一个底条，逐档追加，余量由 space-between 均分。
 * 与竖排日历（CalColumn）同一个机制：高度每多一档，追加一个更粗的时间尺度，
 * 而不是把同样的内容等比放大。
 *
 * 1×2（75×196）只放得下「地点 / 图标 / 温度 / 天气词 / 高低温」；
 * 1×3 多出 121px，够 6 行竖排逐时；1×4 再多 121px，够 5 行逐日。
 */
const showHourly = computed(() => props.spanH >= 3)
const showDaily = computed(() => props.spanH >= 4)
</script>

<template>
  <div class="col" aria-hidden="true">
    <!--
      地点升为顶条、高低温落为底条：两条面把内容夹住，
      与竖排日历的「月份条 + 年份条」是同一个形，没有引入第四种块面。

      地点名一律截断：它是唯一一处内容长度不受气象数据约束的地方，
      用户可以输入任意 24 字以内的名字。
    -->
    <span class="col__band col__band--place">{{ place }}</span>

    <div class="col__now">
      <WxIcon class="col__icon" :name="view.icon" />
      <WxTemp :value="view.temp" :stale="stale" />
      <span class="col__word">{{ view.text }}</span>
    </div>

    <!--
      逐时在这一档竖排：75px 放不下横向 6 段折线，
      一列「时刻 + 温度」两项刚好——与 CalWeekRail 的竖排同理。
    -->
    <WxHourly
      v-if="showHourly"
      class="col__hourly"
      :hours="view.hours"
      :count="6"
      vertical
    />

    <WxDaily v-if="showDaily" class="col__daily" :days="view.days" :count="5" />

    <span class="col__band col__band--hl">{{ view.high }}/{{ view.low }}</span>
  </div>
</template>

<style scoped>
/*
 * 全部尺寸按 --wx-w 算而非 --wx-h：三档等宽（都是 75px）不等高，
 * 按高算会让 1×4 的温度比 1×2 大一倍以上，而它们真正相同的恰是横向空间。
 * 这与 CalColumn 是同一条推理。
 *
 * 温度 0.4w = 30px：§6 的账里 0.42w 算出 66px 而可用只有 63px，
 * 收一档到 0.4 再加上 WxTemp 里负号收紧与度符号缩小两项补偿，
 * 「-27°」落在约 55px。
 */
.col {
  --wx-fs-temp: calc(var(--wx-w) * 0.4);
  --wx-stroke: 1.6;

  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  justify-content: space-between;
  gap: calc(var(--wx-w) * 0.08);
}

/* 两条条块的共性：通栏、定高、次要背景，与 CalColumn 的两条同高同色 */
.col__band {
  display: flex;
  height: calc(var(--wx-w) * 0.3);
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  background: var(--wx-sub-bg, var(--widget-band-bg));
  color: var(--wx-text, var(--widget-band-text));
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

/*
 * 地点条。
 *
 * 左右内边距 6.75px：圆角在这一档是 min(0.22 × 75, 26) = 16.5px，
 * 条通栏贴边，文字纵向居中（字顶约 y=5.8），该高度上圆弧横向切入 4.4px，
 * 小于 6.75px，所以两端的字不会碰到弧线。
 *
 * 「乌鲁木齐」@10.9px 约 54.5px，条内可用 61.5px；更长的名字靠 ellipsis。
 */
.col__band--place {
  min-width: 0;
  padding: 0 calc(var(--wx-w) * 0.09);
  font-size: calc(var(--wx-w) * 0.145);
}

.col__band--place,
.col__word {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col__band--hl {
  font-size: calc(var(--wx-w) * 0.17);
  letter-spacing: 0.02em;
}

.col__now {
  display: flex;
  min-width: 0;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  gap: calc(var(--wx-w) * 0.03);
}

.col__icon {
  --wx-icon: calc(var(--wx-w) * 0.36);
  color: var(--wx-text, var(--color-text));
}

.col__word {
  max-width: 100%;
  padding: 0 calc(var(--wx-w) * 0.06);
  color: var(--wx-text, var(--color-text));
  font-size: calc(var(--wx-w) * 0.145);
  line-height: 1;
}

/*
 * 竖排逐时吃剩余高度，但封顶 1.5w（112.5px）。
 *
 * 不封顶时 1×4 的行距会涨到 22px，六行「12  28°」之间的空白比字本身还高，
 * 读起来不像一个序列。封顶后余下的高度回落给 space-between。
 */
.col__hourly {
  --wx-fs-tick: calc(var(--wx-w) * 0.15);
  --wx-hourly-gap: calc(var(--wx-w) * 0.06);

  min-height: 0;
  flex: 1 1 auto;
  max-height: calc(var(--wx-w) * 1.5);
  padding: 0 calc(var(--wx-w) * 0.1);
}

/*
 * 逐日 5 行，高度定死而非 flex。
 *
 * 不画天气图标：一行只有 61.5px，而冬季最长态「五 -32/-42」已占 58px，
 * 图标那 12px 放不下。它是这一行里唯一的装饰项，砍它比砍读数合理。
 *
 * 交给 flex 的话它会与逐时争夺同一片余量，两块的行距会互相牵动。
 */
.col__daily {
  --wx-fs-daily: calc(var(--wx-w) * 0.125);
  --wx-daily-gap: calc(var(--wx-w) * 0.03);

  height: calc(var(--wx-w) * 1.3);
  flex: 0 0 auto;
  padding: 0 calc(var(--wx-w) * 0.08);
}
</style>

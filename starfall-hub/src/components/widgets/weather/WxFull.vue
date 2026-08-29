<script setup lang="ts">
import { computed } from 'vue'

import WxDaily from './WxDaily.vue'
import WxHourly from './WxHourly.vue'
import WxIcon from './WxIcon.vue'
import WxMetrics from './WxMetrics.vue'
import WxTemp from './WxTemp.vue'
import type { WeatherView } from './types'

const props = defineProps<{
  view: WeatherView
  stale?: boolean
  /** 3..4，决定指标项数与折线是否带时刻标签 */
  spanW: number
  place: string
}>()

/** 与 grid 同一条账：3 宽只放两项指标，4 宽放三项 */
const metricCount = computed(() => (props.spanW >= 4 ? 3 : 2))

/** 12 段折线在 265px 上每段 22px，标签只有 4 宽（每段 30px）放得下 */
const showTicks = computed(() => props.spanW >= 4)
</script>

<template>
  <div class="full" aria-hidden="true">
    <div class="full__head">
      <span class="full__place">{{ place }}</span>
      <span class="full__cond">{{ view.text }} · {{ view.windText }}</span>
    </div>

    <div class="full__now">
      <WxIcon class="full__icon" :name="view.icon" />
      <WxTemp :value="view.temp" :stale="stale" />
      <WxMetrics class="full__metrics" :view="view" :count="metricCount" />
    </div>

    <!-- 折线从 6 段加密到 12 段，覆盖 36 小时 -->
    <WxHourly
      class="full__chart"
      :hours="view.hours"
      :count="12"
      :labels="showTicks"
    />

    <!--
      438px 高把逐日从横排改成竖排 7 行：竖排一行有整个宽度，
      能容下降水概率条——这是 full 与 grid 的实质差别，
      不是「同样内容放大」。
    -->
    <WxDaily class="full__daily" :days="view.days" :count="7" pop icon />

    <!-- L7 日出日落。数据缺失（极地的极昼极夜）时整行不渲染，而不是留两个空位 -->
    <div v-if="view.sunrise && view.sunset" class="full__sun">
      <span class="full__sunitem">
        <svg class="full__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M12 5.5v-2M5.6 8.1L4.2 6.7M18.4 8.1l1.4-1.4M7 15a5 5 0 0 1 10 0M3.5 18.5h17"
          />
        </svg>
        {{ view.sunrise }}
      </span>

      <span class="full__sunitem">
        <svg class="full__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M9.5 4a6.5 6.5 0 0 0 10 8.4A7.6 7.6 0 1 1 9.5 4z" />
        </svg>
        {{ view.sunset }}
      </span>
    </div>
  </div>
</template>

<style scoped>
/*
 * 横向按 --wx-w（两档同高 438px、宽差 95px），纵向的带高按 --wx-h。
 * 温度比 grid 略大：438px 高有余量，而这一档是信息最全的一档，
 * 主读数不该与其它行同一个量级。
 */
.full {
  --wx-fs-temp: calc(var(--wx-w) * 0.13);
  --wx-stroke: 1.2;

  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  padding-top: calc(var(--wx-h) * 0.025);
}

.full__head {
  display: flex;
  min-width: 0;
  flex: 0 0 auto;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 calc(var(--wx-w) * 0.05);
  color: var(--wx-sub-text, var(--color-text-dim));
  font-size: calc(var(--wx-w) * 0.045);
  line-height: 1;
  gap: calc(var(--wx-w) * 0.03);
}

.full__place {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.full__cond {
  flex: none;
  white-space: nowrap;
}

/* gap 与 grid 同一处实测：两组之间靠 metrics 的 auto 推开，不再叠 gap */
.full__now {
  display: flex;
  min-width: 0;
  flex: 0 0 auto;
  align-items: center;
  padding: calc(var(--wx-h) * 0.028) calc(var(--wx-w) * 0.05);
  gap: calc(var(--wx-w) * 0.022);
}

.full__icon {
  --wx-icon: calc(var(--wx-w) * 0.145);
  color: var(--wx-text, var(--color-text));
}

/* 与 grid 同一处实测：冬季最长态的三项指标按 0.045w 会溢出，收到 0.038w */
.full__metrics {
  --wx-fs-metric: calc(var(--wx-w) * 0.034);
  --wx-metrics-gap: calc(var(--wx-w) * 0.022);

  min-width: 0;
  margin-left: auto;
}

/*
 * 折线区高度定死而非 flex。
 *
 * 交给 flex 的话它会与 7 行逐日争抢余量：逐日的行数是定的、行距一变
 * 就不像序列，所以余量必须落在折线这一块，但也不能全给——
 * 12 段折线在 130px 高以上就开始显得空旷。
 */
.full__chart {
  --wx-fs-tick: calc(var(--wx-w) * 0.035);
  --wx-line: 1.5;
  --wx-hourly-gap: calc(var(--wx-h) * 0.008);

  height: calc(var(--wx-h) * 0.17);
  flex: 0 0 auto;
  padding: calc(var(--wx-h) * 0.012) calc(var(--wx-w) * 0.05)
    calc(var(--wx-h) * 0.02);
}

/*
 * 逐日 7 行吃掉剩余高度。
 * 这一档它是主体，让它承担余量比让折线承担更合理：
 * 7 行的行距从 22px 到 26px 之间变化仍然读得出是一个序列。
 */
.full__daily {
  --wx-fs-daily: calc(var(--wx-w) * 0.042);
  --wx-daily-icon: calc(var(--wx-w) * 0.05);
  --wx-daily-gap: calc(var(--wx-w) * 0.025);
  --wx-pop-w: calc(var(--wx-w) * 0.14);
  --wx-pop-h: calc(var(--wx-w) * 0.012);

  min-height: 0;
  flex: 1;
  padding: calc(var(--wx-h) * 0.018) calc(var(--wx-w) * 0.05);
  border-top: 1px solid var(--tile-border);
}

/*
 * 日出日落。第二条分隔线在这一档是可以的：438px 高，两条线之间
 * 各有一块足够高的内容，不会像 317px 里那样把版面切碎。
 */
.full__sun {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-around;
  height: calc(var(--wx-h) * 0.075);
  padding: 0 calc(var(--wx-w) * 0.05) calc(var(--wx-h) * 0.01);
  border-top: 1px solid var(--tile-border);
  color: var(--wx-sub-text, var(--color-text-dim));
  font-size: calc(var(--wx-w) * 0.045);
  font-variant-numeric: tabular-nums;
}

.full__sunitem {
  display: flex;
  align-items: center;
  gap: 0.45em;
  white-space: nowrap;
}

.full__glyph {
  display: block;
  width: 1.35em;
  height: 1.35em;
  flex: none;
}

.full__glyph path {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>

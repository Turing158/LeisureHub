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

/**
 * 3×3 的指标只放两项。
 *
 * §6 的横向账（可用宽 238.4px）：图标 37 + 「-27°」约 71 + 三项指标 180
 * = 288px，超出 50px；砍到两项后 228px，余 10px。
 * 砍掉的是风级——多数日子里恒为 1-2 级，三项里它的信息量最低。
 */
const metricCount = computed(() => (props.spanW >= 4 ? 3 : 2))

/** 时刻标签仅 4×3：3×3 的折线区 238px 放 6 个两位数会挨在一起 */
const showTicks = computed(() => props.spanW >= 4)
</script>

<template>
  <div class="grid" aria-hidden="true">
    <!-- 刊头两端对齐：地点在左，「多云 · 东南风」在右 -->
    <div class="grid__head">
      <span class="grid__place">{{ place }}</span>
      <span class="grid__cond">{{ view.text }} · {{ view.windText }}</span>
    </div>

    <!-- L0 与 L5 同一行：这是 grid 相对 stack 的实质差别（宽度够并排） -->
    <div class="grid__now">
      <WxIcon class="grid__icon" :name="view.icon" />
      <WxTemp :value="view.temp" :stale="stale" />
      <WxMetrics class="grid__metrics" :view="view" :count="metricCount" />
    </div>

    <WxHourly
      class="grid__chart"
      :hours="view.hours"
      :count="6"
      :labels="showTicks"
    />

    <!--
      逐日 5 项横排。只有一条分隔线（在它上方）——
      317px 内两条横线就开始像表格，与 CalMonthTall 同一条约束。
    -->
    <WxDaily class="grid__daily" :days="view.days" :count="5" row icon />
  </div>
</template>

<style scoped>
/*
 * 横向的量按 --wx-w（两档同高 317px、宽度差 95px），
 * 纵向的带高按 --wx-h。
 */
.grid {
  --wx-fs-temp: calc(var(--wx-w) * 0.127);
  --wx-stroke: 1.2;

  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  padding-top: calc(var(--wx-h) * 0.035);
}

/*
 * 刊头缩进 0.05w = 13.3px，与 §6 的账一致（可用宽 265 − 2×13.3 = 238.4）。
 * 这一档圆角 26px，但刊头不贴顶（上方有 0.035h = 11px 的 padding），
 * 该高度上圆弧已收到 8px 以内。
 */
.grid__head {
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

/* 地点名超 4 字时刊头左端涨到 53px，右侧仍有 102px 余量，所以截断很少触发 */
.grid__place {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.grid__cond {
  flex: none;
  white-space: nowrap;
}

/*
 * 主信息行。
 *
 * gap 只留 0.022w（图标与温度之间那一处）。
 * 温度组与指标组之间靠 .grid__metrics 的 margin-left: auto 推开，
 * 不需要额外的 gap——而 4 宽档冬季最长态的三项指标正好差这十几个像素：
 * 可用 322px，图标 52 + 「-27°」77 + 三项 167 = 296，加上两道 14.4px 的 gap
 * 就溢出了。这一处与下面 --wx-fs-metric 的 0.034 是同一次实测的结果。
 */
.grid__now {
  display: flex;
  min-width: 0;
  flex: 0 0 auto;
  align-items: center;
  padding: calc(var(--wx-h) * 0.045) calc(var(--wx-w) * 0.05);
  gap: calc(var(--wx-w) * 0.022);
}

.grid__icon {
  --wx-icon: calc(var(--wx-w) * 0.14);
  color: var(--wx-text, var(--color-text));
}

/*
 * 指标靠右：温度与图标是一组，指标是另一组，中间用 auto 推开。
 *
 * 字号与间距都比刊头收一档，是按冬季最长态量的：
 * 「体感 -39°」「湿度 100%」「风 12 级」比夏季的「体感 29°」各宽一个字形，
 * 按 0.045w 算三项要 187px 而这里只有 168px。0.038w + 更紧的组间距后落到 154px。
 * §6 的账只算了 3 宽（两项）那一档，4 宽三项这一处是实测补上的。
 */
.grid__metrics {
  --wx-fs-metric: calc(var(--wx-w) * 0.034);
  --wx-metrics-gap: calc(var(--wx-w) * 0.022);

  min-width: 0;
  margin-left: auto;
}

/* 折线吃掉主信息与逐日之间的全部余量，是这一档纵向最有弹性的一块 */
.grid__chart {
  --wx-fs-tick: calc(var(--wx-w) * 0.04);
  --wx-line: 1.5;
  --wx-hourly-gap: calc(var(--wx-h) * 0.012);

  min-height: 0;
  flex: 1;
  padding: calc(var(--wx-h) * 0.02) calc(var(--wx-w) * 0.05)
    calc(var(--wx-h) * 0.03);
}

/*
 * 逐日横排一带，高度定死。
 * §6：5 项各 47.7px（3×3），「30/23」@11.9 约 40px，有余量。
 *
 * 底色缺省 transparent、配了才上色：这一档没有 micro / panel 那样的实心条，
 * 分隔靠一条 border 就够（317px 内两条横线就开始像表格）。
 * 但「次要背景」这一项必须在每档都有落点，否则用户配了它却看不出变化——
 * 于是把这块本就是独立一面的区域交给它，而不是为配色新造一条实心带。
 *
 * 底部内边距大于顶部，把内容往上提：末行落在方格底部的圆角带里，
 * 两端那两列的字会被圆弧逼到没有余量（这一档圆角 26px）。
 */
.grid__daily {
  --wx-fs-daily: calc(var(--wx-w) * 0.045);
  --wx-daily-icon: calc(var(--wx-w) * 0.055);
  --wx-daily-gap: calc(var(--wx-h) * 0.012);
  --wx-daily-col-gap: calc(var(--wx-w) * 0.015);

  height: calc(var(--wx-h) * 0.2);
  flex: 0 0 auto;
  padding: calc(var(--wx-h) * 0.02) calc(var(--wx-w) * 0.04) calc(var(--wx-h) * 0.035);
  border-top: 1px solid var(--tile-border);
  background: var(--wx-sub-bg, transparent);
}
</style>

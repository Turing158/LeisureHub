<script setup lang="ts">
import { computed } from 'vue'

import WxDaily from './WxDaily.vue'
import WxIcon from './WxIcon.vue'
import WxMetrics from './WxMetrics.vue'
import WxTemp from './WxTemp.vue'
import type { WeatherView } from './types'

const props = defineProps<{
  view: WeatherView
  stale?: boolean
  /** 3..4，决定是否插入 L5 三项指标 */
  spanH: number
  place: string
}>()

/**
 * h=4 多出 121px，插入 L5 三项指标。
 *
 * 三行一栏的键值形，比再多两天逐日的信息增量大：逐日已有 4 天，
 * 第 5、6 天的高低温预报误差已大到读它不如读体感与湿度。
 */
const showMetrics = computed(() => props.spanH >= 4)

/** 逐日行数：h=3 放 4 行，h=4 插了指标后仍放得下 5 行 */
const dailyCount = computed(() => (props.spanH >= 4 ? 5 : 4))
</script>

<template>
  <div class="stack" aria-hidden="true">
    <div class="stack__top">
      <span class="stack__place">{{ place }}</span>
      <div class="stack__now">
        <WxIcon class="stack__icon" :name="view.icon" />
        <WxTemp :value="view.temp" :stale="stale" />
      </div>
      <div class="stack__line">
        <span class="stack__word">{{ view.text }}</span>
        <span class="stack__hl">{{ view.high }}/{{ view.low }}</span>
      </div>
    </div>

    <!--
      竖排三项：170px 宽下横排三项要 145px 以上，
      而这一块还要与上方主信息共享同一片宽度。
    -->
    <WxMetrics
      v-if="showMetrics"
      class="stack__metrics"
      :view="view"
      :count="3"
      vertical
    />

    <!--
      逐日一行是「星期 + 图标 + 高/低」三项。
      §6：约 24 + 20 + 62 = 106px < 可用 150px，冬季四字温度也还有余量。
    -->
    <WxDaily class="stack__daily" :days="view.days" :count="dailyCount" icon />
  </div>
</template>

<style scoped>
/*
 * 全部按 --wx-w 算（两档等宽 170px、不等高），与 CalStack 同一条推理：
 * 按高算会让 h=4 的温度比 h=3 大三成，而它们真正相同的是横向空间。
 */
.stack {
  --wx-fs-temp: calc(var(--wx-w) * 0.26);
  --wx-stroke: 1.6;

  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
}

/*
 * 上半吃剩余高度：h=3 与 h=4 的差额在插入指标之后仍有余，
 * 让它落在这里而不是让逐日列表的行距变宽——逐日的行距一变，
 * 「7 天是一个序列」这件事就读不出来了。
 */
.stack__top {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 calc(var(--wx-w) * 0.08);
  gap: calc(var(--wx-w) * 0.03);
}

.stack__place {
  max-width: 100%;
  overflow: hidden;
  color: var(--wx-sub-text, var(--color-text-dim));
  font-size: calc(var(--wx-w) * 0.085);
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stack__now {
  display: flex;
  align-items: center;
  gap: calc(var(--wx-w) * 0.04);
}

.stack__icon {
  --wx-icon: calc(var(--wx-w) * 0.18);
  color: var(--wx-text, var(--color-text));
}

/* 天气词与高低温同一行：两者各约 40px，170px 宽里并排绰绰有余 */
.stack__line {
  display: flex;
  align-items: baseline;
  gap: calc(var(--wx-w) * 0.05);
}

.stack__word {
  color: var(--wx-text, var(--color-text));
  font-size: calc(var(--wx-w) * 0.1);
  line-height: 1;
  white-space: nowrap;
}

.stack__hl {
  color: var(--wx-sub-text, var(--color-text-dim));
  font-size: calc(var(--wx-w) * 0.09);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

/*
 * 指标区高度定死，与逐日之间只画一条线。
 * 两条线在 170px 宽的方格里会把内容切成三段、开始像表格——
 * 与 CalMonthTall 的「只有一条分隔线」同一条约束。
 */
.stack__metrics {
  --wx-fs-metric: calc(var(--wx-w) * 0.085);

  height: calc(var(--wx-w) * 0.42);
  flex: 0 0 auto;
  padding: calc(var(--wx-w) * 0.05) calc(var(--wx-w) * 0.09) 0;
}

/*
 * 逐日区高度按行数给：一行约 0.19w（32px），
 * 4 行 0.76w、5 行 0.95w。
 * 用 min() 夹一道上界防止 h=4 时行距被拉开。
 *
 * 底色交给「次要背景」（缺省透明），与 grid / split 同一处理：
 * 这一档没有实心条，而四项配色每一项都要有可见落点。
 * 逐日区是被那条 border 界定出的独立一面，也是这一档最大的一块。
 */
.stack__daily {
  --wx-fs-daily: calc(var(--wx-w) * 0.095);
  --wx-daily-icon: calc(var(--wx-w) * 0.11);
  --wx-daily-gap: calc(var(--wx-w) * 0.04);

  height: min(calc(var(--wx-w) * 1), calc(var(--wx-h) * 0.42));
  flex: 0 0 auto;
  padding: calc(var(--wx-w) * 0.05) calc(var(--wx-w) * 0.09) calc(var(--wx-w) * 0.08);
  border-top: 1px solid var(--tile-border);
  background: var(--wx-sub-bg, transparent);
}
</style>

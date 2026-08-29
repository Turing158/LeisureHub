<script setup lang="ts">
import { computed } from 'vue'

import type { WeatherView } from './types'

const props = defineProps<{
  view: WeatherView
  /**
   * 取几项。
   *
   * 3×3 只能放两项（§6 的横向账：三项要 288px > 可用 238.4px），
   * 4×3 与 full 放三项。
   */
  count: number
  /** 竖排：一行一项的键值形，stack(h=4) 用 */
  vertical?: boolean
}>()

/**
 * 三项指标的顺序即重要性：体感 > 湿度 > 风。
 *
 * 体感排第一是因为它与当前温度直接可比（「27° 但体感 29°」是有用的一句），
 * 而风级在多数日子里恒为 1-2 级，信息量最低，所以缩档时它先被砍。
 */
const items = computed(() => {
  const all = [
    { key: '体感', value: `${props.view.apparent}°` },
    { key: '湿度', value: `${props.view.humidity}%` },
    { key: '风', value: `${props.view.windLevel} 级` },
  ]
  return all.slice(0, props.count)
})
</script>

<template>
  <div class="metrics" :class="{ 'metrics--v': vertical }" aria-hidden="true">
    <div v-for="item in items" :key="item.key" class="metrics__item">
      <span class="metrics__key">{{ item.key }}</span>
      <span class="metrics__value">{{ item.value }}</span>
    </div>
  </div>
</template>

<style scoped>
/*
 * 横排：键值成对、对与对之间留间距。
 * 不用等分网格：三项的宽度差很大（「风 3 级」比「湿度 62%」窄），
 * 等分会在「风」那一列留下一块与其它列不成比例的空白。
 */
.metrics {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: var(--wx-metrics-gap, 10px);
}

.metrics__item {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 0.3em;
}

.metrics__key {
  color: var(--wx-sub-text, var(--color-text-dim));
  font-size: var(--wx-fs-metric, 11px);
  line-height: 1;
  white-space: nowrap;
}

.metrics__value {
  color: var(--wx-text, var(--color-text));
  font-size: var(--wx-fs-metric, 11px);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

/* ── 竖排（stack h=4） ─────────────────────────────── */

/*
 * 一行一项，键左值右。
 * 170px 宽下这是唯一读得顺的排法：横排三项要 145px 以上，
 * 而这一档还要在同一块面里容下上方的主信息。
 */
.metrics--v {
  flex-direction: column;
  align-items: stretch;
  justify-content: space-between;
}

.metrics--v .metrics__item {
  justify-content: space-between;
}
</style>

<script setup lang="ts">
import { computed } from 'vue'

import { WEATHER_PATHS } from './icons'
import type { WeatherIconName } from './types'

const props = defineProps<{ name: WeatherIconName }>()

/** 未知名回落到「阴」，不渲染空 svg：空图标位比一个不精确的图标更难解释 */
const path = computed(() => WEATHER_PATHS[props.name] ?? WEATHER_PATHS.overcast)
</script>

<template>
  <!--
    尺寸与描边都由调用方通过 CSS 变量给（--wx-icon / --wx-stroke）。
    写成 props 的话每个版式都要在模板里插一次 JS 算出的像素，
    而版式的像素本来全在 CSS 里——那会让「几何全由 CSS 变量驱动」这条破一个口。

    aria-hidden：可访问名由 WeatherWidget 的 .sr-only 统一提供。
  -->
  <svg class="wx-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
    <path :d="path" />
  </svg>
</template>

<style scoped>
/*
 * 正方形，边长读 --wx-icon。
 * flex: none 是必需的：多数版式把它放在 flex 行里，不锁死的话
 * 「-27°」这类长文字会把图标压扁成椭圆。
 */
.wx-icon {
  display: block;
  width: var(--wx-icon, 24px);
  height: var(--wx-icon, 24px);
  flex: none;
}

/*
 * stroke 相关全写在 CSS 而非 SVG 属性上。
 *
 * 关键是 stroke-width 要能读 var(--wx-stroke)：presentation attribute 的值
 * 不解析 var()，写成 stroke-width="var(...)" 会被当成非法值而回落到 1。
 * 各版式据图标的实际像素选一档（见 icons.ts 顶部的三档说明）。
 */
.wx-icon path {
  fill: none;
  stroke: currentColor;
  stroke-width: var(--wx-stroke, 1.6);
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>

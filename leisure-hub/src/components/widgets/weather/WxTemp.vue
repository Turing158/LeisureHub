<script setup lang="ts">
defineProps<{
  value: number
  /** 陈旧标记：温度旁一个半透明小点 */
  stale?: boolean
}>()
</script>

<template>
  <!--
    主温度。八档里都用它，所以「负号收紧 + 度符号缩小」这两处补偿只写一遍。

    度符号单独成 span 而不是直接写在文本里：它要缩到 0.7em。
    §6 的横向账里 column 一档的「-27°」按 0.42w 算溢出 3px，
    letter-spacing 收 0.04em 加上这里缩小的度符号，两项合计省回约 8px。
  -->
  <span class="temp" :class="{ 'temp--neg': value < 0 }">
    {{ value }}<span class="temp__deg">°</span>
    <!-- 陈旧点：形状 + 透明度表达，不靠颜色单独承载 -->
    <span v-if="stale" class="temp__stale" aria-hidden="true"></span>
  </span>
</template>

<style scoped>
/*
 * 字号由调用方给 --wx-fs-temp。
 * tabular-nums：27° 与 8° 之间切换时数字不左右跳；
 * 但它只保证每个数字等宽，不保证字数，所以 -27° 这个四字形态仍要逐档验。
 */
.temp {
  position: relative;
  color: var(--wx-text, var(--color-text));
  font-size: var(--wx-fs-temp);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: 1;
  white-space: nowrap;
}

/* 负温多一个字形，再收一档字距把宽度拉回正数档附近 */
.temp--neg {
  letter-spacing: -0.04em;
}

/*
 * 度符号缩到 0.7em 并抵掉字距。
 * 不省掉它：单看「27」读不出是温度，而「27℃」的 ℃ 在小字号下会糊成一团。
 */
.temp__deg {
  font-size: 0.7em;
  letter-spacing: 0;
}

/*
 * 陈旧点贴在右上角，绝对定位以免把行宽撑开——
 * 它出现与消失都不该让温度左右挪动。
 */
.temp__stale {
  position: absolute;
  top: 0.06em;
  right: -0.34em;
  width: 0.16em;
  height: 0.16em;
  border-radius: var(--r-full);
  background: currentColor;
  opacity: 0.5;
}
</style>

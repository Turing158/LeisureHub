<script setup lang="ts">
import { computed } from 'vue'

import { isHexColor } from '@/utils/color'

const props = defineProps<{
  name: string
  icon?: string
  bgColor?: string
}>()

/** 只有明确像 URL 的才当图片加载，emoji / 文字走文本渲染 */
const isImage = computed(() => {
  const icon = props.icon
  if (!icon) return false
  return /^(https?:\/\/|data:image\/|\/)/.test(icon)
})

/** 底色直接进 background，先过一遍校验，挡住脏数据注入样式 */
const safeBg = computed(() => (isHexColor(props.bgColor) ? props.bgColor : undefined))

/** 无图标时用名称首字符兜底 */
const fallbackChar = computed(() => [...props.name.trim()][0] ?? '·')
</script>

<template>
  <span class="tile-icon" :style="{ background: safeBg }">
    <img v-if="isImage" class="tile-icon__img" :src="icon" alt="" aria-hidden="true" />
    <span v-else class="tile-icon__text">{{ icon || fallbackChar }}</span>
  </span>
</template>

<style scoped>
.tile-icon {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: inherit;
}

/*
 * 图片与文字都按 --content-size（方格短边）取尺寸，而不是相对自身容器取百分比：
 * 跨格方块不是正方形，百分比会在两个轴上给出不同的绝对值，
 * object-fit 虽能保住比例，但图标会偏小且不居中。
 * --content-size 缺省时回落到 --tile-size，兼容只覆写了后者的调用方。
 */
.tile-icon__img {
  width: calc(var(--content-size, var(--tile-size)) * 0.56);
  height: calc(var(--content-size, var(--tile-size)) * 0.56);
  object-fit: contain;
}

.tile-icon__text {
  /* 字号跟随方格尺寸，缩放时视觉比例保持一致 */
  font-size: calc(var(--content-size, var(--tile-size)) * 0.42);
  line-height: 1;
  user-select: none;
}
</style>

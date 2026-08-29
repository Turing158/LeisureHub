<script setup lang="ts">
/**
 * 引擎图标。
 *
 * 一律内置字形，**不取各站 favicon**：favicon 要么跨域取不到、要么每次渲染都发
 * 一次外部请求暴露访问行为（01-方案设计.md §10 已把「favicon 跨域拿不到」
 * 列为已知风险）。字母 / 几何形与 ContextMenu 的图标集同源：同一套 24 视框、
 * currentColor、1.7 描边。
 *
 * 首字母而非品牌标识：品牌 logo 有版权，且在 16px 下多数糊成一团。
 */
import type { EngineIcon } from '@/data/engines'

defineProps<{ name: EngineIcon }>()
</script>

<template>
  <svg class="engine-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <!-- 百度：熊掌轮廓的简化——一个圆头 + 三点，比「百」字在 16px 下更可辨 -->
    <template v-if="name === 'baidu'">
      <circle cx="12" cy="13.5" r="5.2" stroke="currentColor" stroke-width="1.6" />
      <circle cx="7.4" cy="6.6" r="1.9" fill="currentColor" />
      <circle cx="12" cy="5.4" r="1.9" fill="currentColor" />
      <circle cx="16.6" cy="6.6" r="1.9" fill="currentColor" />
    </template>

    <!-- Bing：一笔折线，取其字标里那个向右上的锐角 -->
    <template v-else-if="name === 'bing'">
      <path
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.7"
        d="M8 4v13.4l4.4 2.4L18 15.6l-6-3"
      />
    </template>

    <!-- Google：开口圆环 + 横杠，即那个「G」的骨架 -->
    <template v-else-if="name === 'google'">
      <path
        stroke="currentColor"
        stroke-linecap="round"
        stroke-width="1.7"
        d="M16.8 8.2A6.2 6.2 0 1 0 18.2 13H12"
      />
    </template>

    <!-- 知乎：「知」字左半的横折 + 一点，两笔即可辨 -->
    <template v-else-if="name === 'zhihu'">
      <path
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.7"
        d="M4.5 8h8M8.5 8v8.5m0 0L5 20m11.5-12v9.5m0 0L20 20m-3.5-9.5H13"
      />
    </template>

    <!-- 自定义：放大镜。用户填什么站点都成立，不猜它的品牌 -->
    <template v-else>
      <circle cx="10.8" cy="10.8" r="5.4" stroke="currentColor" stroke-width="1.7" />
      <path stroke="currentColor" stroke-linecap="round" stroke-width="1.7" d="m15 15 4.4 4.4" />
    </template>
  </svg>
</template>

<style scoped>
/* 尺寸由调用方给（菜单 16px、按钮 18px、chip 14px），这里只保证不被拉伸 */
.engine-icon {
  width: 100%;
  height: 100%;
  flex: none;
}
</style>

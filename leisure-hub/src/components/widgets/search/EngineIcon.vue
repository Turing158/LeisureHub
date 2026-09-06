<script setup lang="ts">
/**
 * 引擎图标。
 *
 * 分两种来源：
 *  - **本站字形**（bing / google / custom）：内联线性 SVG。字母 / 几何形与
 *    ContextMenu 的图标集同源：统一的 24 视框、currentColor、1.7 描边。
 *  - **站点 favicon**（baidu / zhihu）：彩色位图，渲染成 `<img>`。
 *
 * 判断靠 name 是不是 URL——与 TileIcon 处理「URL 还是文字兜底」同一条逻辑。
 * favicon 只选两家在全站 UI 都会出现的引擎：它们的彩色图标确实比简化字形
 * 好认，代价是带色相、偏离了无色相语言；其余仍用本站字形，稳且无色相。
 */
import { computed } from 'vue'

import type { EngineIcon } from '@/data/engines'

const props = defineProps<{ name: EngineIcon }>()

/** 只有明确像 URL 的才当图片加载；字形名 / 自定义兜底走内置字形 */
const isImage = computed(() => /^(https?:\/\/|data:image\/)/.test(props.name))
</script>

<template>
  <!--
    favicon：加载站点真实彩色图标。
    referrerpolicy=no-referrer 不把本站地址带给第三方；loading=lazy 免得惯藏着不动。
  -->
  <img
    v-if="isImage"
    class="engine-favicon"
    :src="name"
    alt=""
    aria-hidden="true"
    loading="lazy"
    referrerpolicy="no-referrer"
    draggable="false"
  />

  <!-- 内置线性字形（本站自绘，无色相） -->
  <svg v-else class="engine-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
/* 字形 / favicon 尺寸都由调用方给（菜单 16px、按钮 18px、chip 14px），这里只保证不被拉伸 */
.engine-icon,
.engine-favicon {
  display: block;
  width: 100%;
  height: 100%;
  flex: none;
}

/* favicon 是彩色位图，按 contain 等比容纳，不出格外；给一点圆角不硌眼 */
.engine-favicon {
  border-radius: 2px;
  object-fit: contain;
}
</style>
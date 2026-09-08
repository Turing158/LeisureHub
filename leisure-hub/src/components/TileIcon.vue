<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'

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

/**
 * 图标加载状态：转圈 → 淡入，或失败后回到首字符兜底。
 *
 * 推荐 tab 里那批 icon 是各站的 favicon 直链，跨网络取图，慢的那几个会让方格
 * 空着好几百毫秒——看起来像坏了。给一个转圈占位，图到了再淡入。
 *
 * 失败也在这里收：原先 <img> 加载不出来就是一块空白，现在回落到首字符，
 * 与「压根没配 icon」表现一致（data/recommend.ts 的注释提到过这个兜底期望）。
 */
type IconStatus = 'loading' | 'ready' | 'error'
const status = ref<IconStatus>('loading')

const img = useTemplateRef<HTMLImageElement>('img')

/**
 * 换图要回到 loading。
 *
 * immediate + flush:'post' 是给「缓存命中」这种情形兜底：img 已经 complete 时
 * load 事件不会再补发一次，只靠监听会永远停在 loading。等 DOM 落好后查一次
 * complete，naturalWidth 为 0 说明是已失败的缓存条目。
 */
watch(
  () => props.icon,
  () => {
    if (!isImage.value) return
    status.value = 'loading'
    const el = img.value
    if (el?.complete) status.value = el.naturalWidth > 0 ? 'ready' : 'error'
  },
  { immediate: true, flush: 'post' },
)
</script>

<template>
  <span class="tile-icon" :style="{ background: safeBg }">
    <!--
      失败后整个 <img> 撤掉而不是留着透明：它仍会占位，也仍是那张破图的 alt 锚点。
      转圈与图共存于同一位置，图淡入的同时转圈淡出，中间不会闪一下空白。
    -->
    <template v-if="isImage && status !== 'error'">
      <span v-if="status === 'loading'" class="tile-icon__spin" aria-hidden="true"></span>
      <!--
        draggable=false 是必须的，不是保险。
        <img> 默认可拖，从图标上按下拖动会触发浏览器原生的 HTML5 拖放（拽出一张
        图片链接的幽灵图），它会抢掉 useDragSort 的指针拖拽——表现为「有图标的方格
        从图标上拖不动，只能从名称或边缘拖」。CSS 的 user-select 管不到这条，
        原生图片拖拽是独立机制。
      -->
      <img
        ref="img"
        class="tile-icon__img"
        :class="{ 'is-ready': status === 'ready' }"
        :src="icon"
        alt=""
        aria-hidden="true"
        draggable="false"
        @contextmenu.prevent
        @load="status = 'ready'"
        @error="status = 'error'"
      />
    </template>
    <span v-else class="tile-icon__text">{{ isImage ? fallbackChar : icon || fallbackChar }}</span>
  </span>
</template>

<style scoped>
.tile-icon {
  /* 转圈要绝对定位叠在图的位置上，锚点给在这里 */
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: inherit;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}

/*
 * 取图中的转圈。
 * 与 PlaceField 的 .place__spin 同一套做法：中性描边 + 一段亮弧，不用 accent
 * （它是进度提示，不是状态标记）。data-motion='off' 时 style.css 把动画压到
 * 0.01ms，静止的圆环仍读得出「在忙」。
 *
 * 尺寸跟着 --content-size 走，与图标本体的 0.56 同源，这样小方格里不会顶满、
 * 大方格里也不会缩成一点。下限 10px 是描边宽度决定的：再小圆环就糊成一坨。
 */
.tile-icon__spin {
  position: absolute;
  width: max(10px, calc(var(--content-size, var(--tile-size)) * 0.22));
  height: max(10px, calc(var(--content-size, var(--tile-size)) * 0.22));
  border: 2px solid var(--line-strong);
  border-top-color: var(--color-text-dim);
  border-radius: var(--r-full);
  animation: tile-icon-spin 0.7s linear infinite;
}

@keyframes tile-icon-spin {
  to {
    transform: rotate(360deg);
  }
}

/*
 * 图片与文字都按 --content-size（方格短边）取尺寸，而不是相对自身容器取百分比：
 * 跨格方块不是正方形，百分比会在两个轴上给出不同的绝对值，
 * object-fit 虽能保住比例，但图标会偏小且不居中。
 * --content-size 缺省时回落到 --tile-size，兼容只覆写了后者的调用方。
 */
.tile-icon__img {
  /*
   * iOS Safari 长按图片会直接弹出预览 / 分享菜单。
   * draggable=false 只关闭 HTML5 拖拽，不能关闭 WebKit 的 touch callout；
   * pointer-events:none 让长按命中方格而不是图片本身，方格的拖拽状态机仍能收到事件。
   */
  width: calc(var(--content-size, var(--tile-size)) * 0.56);
  height: calc(var(--content-size, var(--tile-size)) * 0.56);
  object-fit: contain;
  -webkit-touch-callout: none;
  -webkit-user-drag: none;
  -webkit-user-select: none;
  user-select: none;
  pointer-events: none;
  /*
   * 未就绪时透明，is-ready 时淡入。
   * 只动 opacity 不动 display / v-if：图必须一直在文档里，否则它压根不会开始下载，
   * load 事件也就永远等不到。
   */
  opacity: 0;
  transition: opacity var(--dur-base) var(--ease);
}

.tile-icon__img.is-ready {
  opacity: 1;
}

.tile-icon__text {
  /* 字号跟随方格尺寸，缩放时视觉比例保持一致 */
  font-size: calc(var(--content-size, var(--tile-size)) * 0.42);
  line-height: 1;
  user-select: none;
}
</style>

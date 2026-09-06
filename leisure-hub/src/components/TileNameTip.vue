<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  /** 完整名称，本组件只负责显示，不判断该不该显示 */
  text: string
  /** 锚点（名称行）的视口坐标：横向中线、上边、下边 */
  x: number
  top: number
  bottom: number
}>()

/** 与视口边缘的最小留白 */
const MARGIN = 8

const tipEl = ref<HTMLElement | null>(null)
/** 实测尺寸后再定位，避免首帧闪一下错位 */
const placed = ref(false)
const left = ref(0)
const top = ref(0)

/**
 * 就地盖住名称行：提示的**底边**压在名称行底边上，向上生长。
 *
 * 不在名称上方留间距，而是直接覆盖那一行——名称只有一行时，提示恰好把被截断的
 * 那行原地替换成完整版，视线不用挪位；名称长到要换行时，多出来的行往上叠，
 * 于是「最后一行」始终落在原名称的位置上。
 *
 * 上方装不下（名称行贴着视口顶部）就改为从名称行顶边向下生长：仍然贴着名称，
 * 只是换个方向，比夹到 8px 处再悬空一段更容易看出它属于哪一格。
 *
 * 必须等 DOM 渲染后再量：提示会换行，高度随名称长度和窗口宽度变化，不是常量。
 */
async function place() {
  placed.value = false
  await nextTick()
  const el = tipEl.value
  if (!el) return

  const { width, height } = el.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight

  /*
   * 对齐的是「最后一行文字」而不是提示的外框：内边距与边框要还回去，
   * 否则整块往上偏 6px，覆盖上去的完整名称和原本那行差着半行，看着像抖了一下。
   */
  const cs = getComputedStyle(el)
  const tail = Number.parseFloat(cs.paddingBottom) + Number.parseFloat(cs.borderBottomWidth)
  const rawTop = props.bottom + tail - height
  const fitsAbove = rawTop >= MARGIN

  left.value = Math.min(Math.max(MARGIN, props.x - width / 2), Math.max(MARGIN, vw - width - MARGIN))
  top.value = fitsAbove
    ? rawTop
    : Math.min(Math.max(MARGIN, props.top), Math.max(MARGIN, vh - height - MARGIN))
  placed.value = true
}

onMounted(place)
onBeforeUnmount(() => {
  placed.value = false
})

// 同一次悬停中换了锚点（相邻方格之间移动指针，父组件复用本实例）：重新定位
watch(() => [props.x, props.top, props.bottom, props.text] as const, place)
</script>

<template>
  <!--
    aria-hidden：名称本身已在方格的 aria-label 里念全了，这层纯属视觉补偿，
    读屏再念一遍只是重复。Teleport 与进出场由外层 OverlayLayer 负责。
  -->
  <div
    ref="tipEl"
    class="tip"
    :class="{ 'is-placed': placed }"
    :style="{ left: `${left}px`, top: `${top}px` }"
    aria-hidden="true"
  >
    {{ text }}
  </div>
</template>

<style scoped>
/*
 * 不跟随指针：位置一次算定，锚在名称行上。
 *
 * pointer-events: none 是关键——提示浮在方格上方，若能接指针，
 * 它遮住的那块区域会先发出 pointerleave（提示消失）再发 pointerenter（提示出现），
 * 指针一停在边界上就开始闪。
 */
.tip {
  position: fixed;
  z-index: var(--z-tip);
  max-width: min(320px, calc(100vw - 2 * var(--sp-2)));
  padding: 5px var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-menu);
  backdrop-filter: var(--glass-menu);
  color: var(--color-text);
  font-size: var(--fs-base);
  /*
   * 行高与字号都照抄名称行（--label-height / --fs-base）：
   * 提示是就地盖在名称上的，最后一行文字必须与被盖住的那行严格重合，
   * 差一两像素在原地替换的场景下看得很清楚。
   */
  line-height: var(--label-height);
  box-shadow: var(--shadow-md);
  /* 与名称行同为居中：提示盖上去时，重合的那行文字才不会左右错开 */
  text-align: center;
  /* 名称可以很长：允许换行，长串（URL 式的无空格名）也要能断开 */
  white-space: normal;
  overflow-wrap: anywhere;
  pointer-events: none;
  /* 定位前藏起来：高度随换行变化，必须先量后放 */
  opacity: 0;
}

@supports not (backdrop-filter: blur(1px)) {
  .tip {
    background: var(--surface-3);
  }
}

.tip.is-placed {
  /* 显隐由 opacity 直接决定，动画只负责观感；动效被禁用时提示仍然可见 */
  opacity: 1;
}

/*
 * 进出场。选择器都带上 .tip 才能与上面的 .tip.is-placed 同权重
 * ——同权重下后写者生效，退场的 opacity: 0 才盖得住 is-placed 的 1。
 */
.tip.tip-enter-active,
.tip.tip-leave-active {
  transition: opacity var(--dur-fast) var(--ease);
  will-change: opacity;
}

/*
 * 只淡入淡出，不带位移。
 *
 * 提示是原地盖在名称上的，任何位移都会让那行文字在进场时相对原名称滑一段，
 * 恰好破坏「原地展开成完整名称」的观感。
 */
.tip.tip-enter-from,
.tip.tip-leave-to {
  opacity: 0;
}
</style>

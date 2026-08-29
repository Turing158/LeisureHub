<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { cellExtent, gridGeometry } from '@/composables/useAreaViewport'

/*
 * 令牌相对 --tile-size 的比例，取自 style.css 的 :root
 * （gap 20 / label-gap 8 / label-height 18 / radius-max 26，基准 tile-size 75）。
 *
 * 预览缩放的是整套令牌而不只是 --tile-size：单缩方格却留着 20px 的 gap，
 * 跨格方块的接缝会宽得不成比例，形状就不再是桌面上那个样子。
 *
 * 只有 fit 模式（下面那一档）用它们；zoom 模式不换算比例，直接读真实令牌。
 */
const GAP_K = 20 / 75
const LABEL_GAP_K = 8 / 75
const LABEL_HEIGHT_K = 18 / 75
const RADIUS_MAX_K = 26 / 75

/**
 * 舞台固定尺寸。
 *
 * 不让方格自己撑开容器：尺寸档位一改，整个表单就会上下跳。
 * 定死之后尺寸改动只影响方格自身的大小。
 */
const STAGE_W = 176
const STAGE_H = 160

/**
 * 缩放上限。
 *
 * 1×1 在舞台里能放到近 150px，比桌面上的 75px 大一倍，看着虚胖且失真。
 * 压到 96px：仍显著大于舞台尺寸，又不至于让预览比实物夸张太多。
 */
const TILE_MAX = 96

/*
 * 名称行在预览里固定尺寸，不随 --tile-size 缩。
 *
 * 按比例缩的话，4×4 档的名称行只有 6px 高、字号不到 5px，糊成一条灰边；
 * 而它在预览里要回答的问题是「名称会占一行、过长会截断」——宽度仍绑 --square-w，
 * 这两点都保留了，字号跟着缩反而把信息缩没了。
 */
const LABEL_HEIGHT = 14
const LABEL_GAP = 4

const props = withDefaults(
  defineProps<{
    /** 占格宽 / 高；范围随内容种类不同（链接 1..4，搜索宽到 6），这里只按数值缩放 */
    spanW: number
    spanH: number
    /** 传入即在方格下方预览名称行；不传则只画方格 */
    label?: string
    /**
     * 缩放方式。
     *
     * `fit`（默认）——把方格缩到贴满一个固定舞台，并**按比例缩掉整套令牌**。
     *   代价是内容里所有绝对尺寸（字号、描边、内边距）都不跟着缩，
     *   于是 1×1 与 4×4 里的文字是同一个大小，看到的是「同一份内容装在
     *   不同大小的框里」。日历 / 天气能接受这一点：它们的内部尺寸全部按
     *   `--content-size` 比例算，会跟着一起缩。
     *
     * `zoom`——按真实令牌（--tile-size: 75px 等）把方格搭出来，再用
     *   `transform: scale()` 整体缩放到容器宽度。字号、描边、内边距一起缩，
     *   所以是**桌面上那块方块的等比照片**。搜索方块必须走这一档：
     *   它的输入框高度、字号、圆角全是 clamp() 出来的绝对值，
     *   在 fit 模式下不会跟着缩，2×1 与 6×2 的预览会长得一样。
     */
    mode?: 'fit' | 'zoom'
  }>(),
  { mode: 'fit' },
)

const hasLabel = computed(() => props.label !== undefined)

/**
 * 方格宽 / 高相对 --tile-size 的倍数。
 *
 * 就是 TileCell 的 --square-w / --square-h 那两条公式，只是把 --tile-size 提了出来。
 * 纵向同样要吞掉跨格时中间的那些名称行，否则 2 高的预览中间会横着一条空白带。
 */
const factors = computed(() => {
  const w = props.spanW
  const h = props.spanH
  const cellK = 1 + LABEL_GAP_K + LABEL_HEIGHT_K
  return {
    w: w + GAP_K * (w - 1),
    h: cellK * h + GAP_K * (h - 1) - LABEL_GAP_K - LABEL_HEIGHT_K,
  }
})

/**
 * 解出让方格刚好填满舞台的 --tile-size。
 *
 * 取两轴的较小值，长宽比因此始终等于桌面上的真实比例，只是整体缩放到贴边为止：
 * 定死一个 --tile-size 的老做法会让 1×1 在 4×4 大小的舞台里只占一个小角。
 *
 * 这一步放在 JS 而不是 CSS：它是「给定盒子反解令牌」，CSS 里只能写成除以一个
 * var() 出来的数，而这套比例本来就要在 JS 里配一份给下面的几何量用。
 */
const tileSize = computed(() => {
  const room = STAGE_H - (hasLabel.value ? LABEL_GAP + LABEL_HEIGHT : 0)
  return Math.min(STAGE_W / factors.value.w, room / factors.value.h, TILE_MAX)
})

/** 几何量一次算齐交给 CSS，模板里不做像素运算 */
const cellVars = computed(() => {
  const t = tileSize.value
  const squareW = t * factors.value.w
  const squareH = t * factors.value.h
  return {
    '--square-w': `${squareW}px`,
    '--square-h': `${squareH}px`,
    // 内容尺寸取短边，与 TileCell 一致：非正方形方格里图标才不会溢出
    '--content-size': `${Math.min(squareW, squareH)}px`,
    // 圆角上限随缩放一起收，否则小尺寸预览的角会比桌面上圆得多
    '--tile-radius-max': `${t * RADIUS_MAX_K}px`,
    '--label-height': `${LABEL_HEIGHT}px`,
    '--label-gap': `${LABEL_GAP}px`,
  }
})

const stageVars = { '--stage-w': `${STAGE_W}px`, '--stage-h': `${STAGE_H}px` }

/* ── zoom 模式 ───────────────────────────────────────── */

/**
 * 真实像素下的方格尺寸。
 *
 * 走 useAreaViewport 的 gridGeometry / cellExtent 而不是上面那套比例：
 * 那一份是「相对 --tile-size 的倍数」，用于反解一个虚拟令牌；
 * 这里要的是桌面上的真实值，而 gridGeometry 已经是那组数字的唯一入口
 * （它从 --gap / --label-* 令牌读，改令牌会跟着变）。
 *
 * 高度同样吞掉跨格时中间的名称行，与 TileCell 的 --square-h 同构。
 */
const realSize = computed(() => {
  const { gap, cellW, cellH } = gridGeometry.value
  const labelBlock = cellH - cellW
  return {
    w: cellExtent(props.spanW, cellW, gap),
    h: cellExtent(props.spanH, cellH, gap) - labelBlock,
  }
})

const rootEl = ref<HTMLElement | null>(null)
/** 容器可用宽度；0 表示还没量到 */
const roomW = ref(0)
let observer: ResizeObserver | null = null

onMounted(() => {
  const el = rootEl.value
  if (!el) return
  const measure = () => (roomW.value = el.clientWidth)
  measure()
  observer = new ResizeObserver(measure)
  observer.observe(el)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

/**
 * 缩放系数。
 *
 * **上限是 1，绝不放大超过真实尺寸。** 把 2 格宽（170px）撑满 496px 的容器，
 * 12.75px 的字会渲染成 37px——那不再是「落格后长什么样」，而是一张放大镜下的照片。
 * 封在 1 以内后，预览会随尺寸档位从 170px 长到 550px，这正是「按比例缩放」
 * 要给出的信息：它在桌面上有多大。
 *
 * 量不到宽度（首帧）时按 1 走：随后 ResizeObserver 会立刻修正，
 * 而给 0 会让方块先塌成一条线再弹开。
 */
const zoom = computed(() => {
  if (roomW.value <= 0) return 1
  return Math.min(1, roomW.value / realSize.value.w)
})

/** 缩放后的实际占位尺寸；transform 不参与布局，得由外层显式收出这个盒子 */
const zoomBoxStyle = computed(() => ({
  width: `${Math.round(realSize.value.w * zoom.value)}px`,
  height: `${Math.round(realSize.value.h * zoom.value)}px`,
}))

/**
 * 内层用真实令牌搭出来，只有 transform 在缩放。
 *
 * 这样字号、描边、内边距、圆角全部跟着一起缩——SearchWidget 的输入框高度与
 * 字号都是 clamp() 出来的绝对值，只缩 --tile-size 的话它们不会动。
 *
 * transform-origin 取 top left，**不是 center**：内层往往比外层宽（6 格是 550px，
 * 而窄面板里只有 284px 可用），此时 `margin-inline: auto` 解析为 0、
 * 绕中心缩放会把结果整体推到右边并被裁掉。从左上角缩，缩完正好落在
 * 上面那个 zoomBox 里，居中由 zoomBox 自己（margin-inline: auto）负责。
 */
const zoomInnerStyle = computed(() => ({
  width: `${realSize.value.w}px`,
  height: `${realSize.value.h}px`,
  '--square-w': `${realSize.value.w}px`,
  '--square-h': `${realSize.value.h}px`,
  '--content-size': `${Math.min(realSize.value.w, realSize.value.h)}px`,
  transform: `scale(${zoom.value})`,
}))

/* 尺寸档位变了要重量一次：容器宽度没变，但缩放系数变了 */
watch(realSize, () => {
  if (rootEl.value) roomW.value = rootEl.value.clientWidth
})
</script>

<template>
  <!--
    zoom 模式：真实尺寸搭出来再整体 scale，所以字号 / 描边 / 内边距一起缩，
    看到的就是桌面上那块方块的等比照片。

    三层各有一件事：.zoom 铺满一行以量出可用宽度（缩放系数的分母）；
    .zoom__box 是缩放后的占位盒并负责居中（transform 不参与布局，
    这个盒子必须显式给出尺寸，否则外层会塌成 0 或留下一片空白）；
    .zoom__inner 才是那块方块本身。
  -->
  <span v-if="mode === 'zoom'" ref="rootEl" class="zoom">
    <span class="zoom__box" :style="zoomBoxStyle">
      <span class="zoom__inner" :style="zoomInnerStyle">
        <slot />
      </span>
    </span>
  </span>

  <!-- fit 模式：固定舞台 + 按比例缩掉整套令牌，日历 / 天气用这一档 -->
  <span v-else class="stage" :style="stageVars">
    <span class="cell" :style="cellVars">
      <span class="frame">
        <slot />
      </span>
      <span v-if="hasLabel" class="cell__label">{{ label }}</span>
    </span>
  </span>
</template>

<style scoped>
/* ── zoom 模式 ───────────────────────────────────────── */

/*
 * 最外层只用来量可用宽度（缩放系数的分母），不参与视觉。
 */
.zoom {
  display: block;
  width: 100%;
}

/*
 * 缩放后的占位盒。
 *
 * 尺寸由 JS 写成行内值：transform 不参与布局，不给的话这一层要么塌成 0
 * （下面的控件压上来），要么留着未缩放的大盒子（多出一片空白）。
 * overflow: hidden 只是兜底——盒子尺寸已经等于缩放结果，正常路径下没有溢出。
 */
.zoom__box {
  display: block;
  overflow: hidden;
  margin-inline: auto;
}

/*
 * 方块本体，用真实令牌搭出来，只有 transform 在缩。
 *
 * 边框与圆角逐条对齐 TileCell__square，包括那条「按短边取等半径再夹上限」的
 * 圆角公式；--tile-radius-max 不覆写，直接吃 :root 的 26px，因为这一档没有缩令牌
 * ——它和其它绝对尺寸一样由 transform 一并缩掉。
 *
 * transform-origin 取 top left，理由见 zoomInnerStyle 的注释。
 */
.zoom__inner {
  display: block;
  overflow: hidden;
  border: 1px solid var(--tile-border);
  border-radius: min(calc(var(--content-size) * var(--tile-radius-ratio)), var(--tile-radius-max));
  background: var(--tile-bg);
  transform-origin: top left;
}

/* ── fit 模式 ────────────────────────────────────────── */

.stage {
  display: grid;
  width: var(--stage-w);
  height: var(--stage-h);
  flex: 0 0 auto;
  place-items: center;
}

.cell {
  display: flex;
  width: var(--square-w);
  flex-direction: column;
  align-items: center;
  gap: var(--label-gap);
}

.frame {
  display: block;
  width: var(--square-w);
  height: var(--square-h);
  overflow: hidden;
  border: 1px solid var(--tile-border);
  /* 与 TileCell__square 同一条：按短边取等半径，再夹一道上限 */
  border-radius: min(calc(var(--content-size) * var(--tile-radius-ratio)), var(--tile-radius-max));
  background: var(--tile-bg);
}

/* 宽度绑 --square-w：名称过长时的截断表现与桌面上一致 */
.cell__label {
  width: var(--square-w);
  height: var(--label-height);
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--fs-sm);
  line-height: var(--label-height);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

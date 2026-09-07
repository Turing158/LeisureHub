<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { hexToHsva, hsvaToHex, normalizeHex, type Hsva } from '@/utils/color'

const props = defineProps<{
  /** 当前颜色，8 位 hex（兼容 6 位 legacy 存档） */
  modelValue: string
  /** 锚点矩形（左/顶/底/宽，来自触发行的实测，纯数据、不经响应式代理） */
  anchor: { left: number; top: number; bottom: number; width: number }
  /** 无障碍名称，拼进各控件的 aria-label */
  label: string
  /**
   * 是否给透明度滑杆。默认给（背景纯色档要用）。
   *
   * 传 false 是给「消费方只接受不透明色」的场景（如主题色）用的：那些地方会把
   * alpha 强制成 255，滑杆留着反而会打架——拖下去、值被改回不透明、watch 再把
   * 手柄弹回顶端，看着像坏了。索性不给这个控件。
   */
  alpha?: boolean
}>()

/** 未传即视为给滑杆，保持既有调用点行为不变 */
const alphaEnabled = computed(() => props.alpha !== false)

const emit = defineEmits<{
  /** 拖动 / 输入中逐帧上报 8 位 hex */
  'update:modelValue': [value: string]
  close: []
}>()

/**
 * 内部模型走 HSVA（alpha 取值 0..1）。
 *
 * 与 hex 只在打开与键盘输入两个节点互相转：拖滑杆只需改一个分量再整体重编码，
 * 不涉及字符串拼接。
 */
const hsva = ref<Hsva>(hexToHsva(props.modelValue || '#808080'))

/**
 * 当前 8 位 hex，同时供预览 chip 与输入框草稿使用。
 *
 * 关掉滑杆时在这里就把 alpha 钉成 1——这是唯一的出口（emit 与草稿都读它），
 * 所以不管 alpha 是从初始值、外部改值还是手打 8 位 hex 进来的，出去都是不透明。
 */
const current = computed(() =>
  hsvaToHex(hsva.value.h, hsva.value.s, hsva.value.v, alphaEnabled.value ? hsva.value.a : 1),
)

/** 输入框本地草稿：编辑期间只动草稿，回车 / 失焦才提交，与 NumberField 同一手法 */
const draft = ref(current.value)

// 外部改值（比如别处点了色板）时把内部状态与草稿一次拉齐
watch(
  () => props.modelValue,
  (value) => {
    if (!value) return
    hsva.value = hexToHsva(value)
    // 读 current 而不是自己再编一遍：让「关掉滑杆时钉死 alpha」只有一处实现
    draft.value = current.value
  },
)

/* ── 背景与手柄位置 ───────────────────────────────────── */

/** SV 方块三层底：纯 hue + 白→透明（饱和度 0→满）+ 透明→黑（明度满→0） */
const svBg = computed(() => ({
  backgroundColor: `hsl(${hsva.value.h} 100% 50%)`,
  backgroundImage:
    'linear-gradient(90deg, #fff, rgba(255,255,255,0)),' +
    'linear-gradient(0deg, #000, transparent)',
}))

/** SV 手柄：x = 饱和度，y = 1 − 明度 */
const svHandle = computed(() => ({
  left: `${hsva.value.s * 100}%`,
  top: `${(1 - hsva.value.v) * 100}%`,
}))

/** 色相满圈渐变 */
const hueBg = 'linear-gradient(90deg, #f00, #ff0, #0f0, #0ae, #00f, #f0f, #f00)'
const hueHandle = computed(() => ({ left: `${(hsva.value.h / 360) * 100}%` }))

/**
 * 透明度滑杆是竖直的，贴 SV 方块右侧，顶满透明朝下走。
 *
 * 实色上层（棋盘底 CSS 里给）从顶部不透明渐变到底部全透明；
 * 手柄位置反过来记：a = 1 在顶部（top 0%），a = 0 在底部（top 100%）。
 */
const alphaMask = computed(() => {
  const { h, s, v } = hsva.value
  return `linear-gradient(180deg, hsl(${h} ${Math.round(s * 100)}% ${Math.round(v * 100)}%), transparent)`
})
const alphaHandle = computed(() => ({ top: `${(1 - hsva.value.a) * 100}%` }))

/** 每次改动重编码并逐帧上报；消费方（预览 / 持久化）自担开销 */
function emitNow() {
  emit('update:modelValue', current.value)
}

/* ── 输入框：草稿提交 ─────────────────────────────────── */

function onHexInput(event: Event) {
  draft.value = (event.target as HTMLInputElement).value
}

/** 合法才提交；不合法保留草稿等用户续打，不打断光标 */
function commitHex() {
  const norm = normalizeHex(draft.value)
  if (!norm) return
  hsva.value = hexToHsva(norm)
  // 同上：手打 8 位 hex 时，关掉滑杆的场景要让 current 把 alpha 抹平
  draft.value = current.value
  emitNow()
}

/* ── 拖动 ────────────────────────────────────────────── */

type Kind = 'sv' | 'hue' | 'alpha'

function beginDrag(event: PointerEvent, kind: Kind) {
  const el = event.currentTarget as HTMLElement
  el.setPointerCapture(event.pointerId)

  const apply = (ev: PointerEvent) => {
    const rect = el.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height))
    switch (kind) {
      case 'sv':
        hsva.value.s = x
        hsva.value.v = 1 - y
        break
      case 'hue':
        hsva.value.h = x * 360
        break
      case 'alpha':
        // 竖直滑杆：顶端不透明（a=1），底端全透明（a=0）
        hsva.value.a = 1 - y
        break
    }
    emitNow()
  }

  // 命中的这一次也要立刻生效
  apply(event)

  const onMove = (ev: PointerEvent) => apply(ev)
  const onEnd = () => {
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onEnd)
    el.removeEventListener('pointercancel', onEnd)
  }
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onEnd)
  el.addEventListener('pointercancel', onEnd)
}

/** 键盘微调：sv 走双轴，色相走水平，透明度走竖直（跟 SV 的明度同向，上移变不透明） */
function onKeydownTrack(kind: Kind, dx: number, dy = 0) {
  switch (kind) {
    case 'sv':
      hsva.value.s = Math.min(1, Math.max(0, hsva.value.s + dx))
      hsva.value.v = Math.min(1, Math.max(0, hsva.value.v - dy))
      break
    case 'hue':
      hsva.value.h = (hsva.value.h + dx * 360 + 360) % 360
      break
    case 'alpha':
      hsva.value.a = Math.min(1, Math.max(0, hsva.value.a - dy))
      break
  }
  emitNow()
}

/* ── 展开定位：量真实尺寸后再放，避免首帧闪错位 ────────── */

const MARGIN = 8
const panel = ref<HTMLElement | null>(null)
const placed = ref(false)
const left = ref(0)
const top = ref(0)

function place() {
  placed.value = false
  const el = panel.value
  if (!el) return

  const { width, height } = el.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight

  // 默认贴着锚点左下展开；底部放不下则朝上翻折，左右只做夹取不进翻转
  const flipY = props.anchor.bottom + height + MARGIN > vh
  left.value = Math.min(Math.max(MARGIN, props.anchor.left), Math.max(MARGIN, vw - width - MARGIN))
  top.value = flipY
    ? Math.max(MARGIN, props.anchor.top - height - MARGIN)
    : Math.min(props.anchor.bottom + MARGIN, vh - height - MARGIN)
  placed.value = true
}

/* ── 关闭：窗外 / Esc / Tab / 视口变化 ───────────────── */

function detach() {
  window.removeEventListener('pointerdown', onDownOutside, true)
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('scroll', onLayoutChange)
  window.removeEventListener('resize', onLayoutChange)
}

function onDownOutside(event: Event) {
  const target = event.target as HTMLElement | null
  if (target?.closest('[data-color-picker]')) return
  // 允许颜色列表中的删除按钮在取色器打开时继续收到 click：先关闭面板，
  // 再让明确标记的底层动作完成，避免捕获阶段拦截掉用户的删除意图。
  if (target?.closest('[data-color-picker-action]')) {
    onClose()
    return
  }
  event.preventDefault()
  event.stopPropagation()
  onClose()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    onClose()
  } else if (event.key === 'Tab') {
    event.preventDefault()
    onClose()
  }
}

/**
 * 视口滚动 / resize 后锚点已失效，直接关闭而非漂移。
 *
 * scroll 事件不冒泡：window 上的默认（非捕获）监听只收到「视图滚动」发出的
 * scroll，不会命中弹窗内 .panel__body 这类内层滚动容器——那并不影响 fixed 面板
 * 相对锚点的定位。若仍被误报（target 不是滚动视图），直接放行即可。
 */
function onLayoutChange(event: Event) {
  if (event.type === 'scroll') {
    const se = document.scrollingElement ?? document.documentElement
    // 只有滚动视图本身 / document / window 的 scroll 才真的移动了锚点；内层容器忽略
    if (event.target !== window && event.target !== se && event.target !== document) return
  }
  onClose()
}

function onClose() {
  detach()
  emit('close')
}

onMounted(async () => {
  await nextTick()
  place()
  window.addEventListener('pointerdown', onDownOutside, true)
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('scroll', onLayoutChange)
  window.addEventListener('resize', onLayoutChange)
})

onBeforeUnmount(() => {
  detach()
})
</script>

<template>
  <!-- Teleport 与进出场过渡由外层 OverlayLayer 负责 -->
  <div
    ref="panel"
    class="cp"
    :class="{ 'is-placed': placed }"
    data-color-picker
    :style="{
      left: `${left}px`,
      top: `${top}px`,
    }"
  >
    <!-- 主体：左 SV 方块 + 右竖直透明度滑杆 -->
    <div class="cp__main">
      <!-- SV 方块：x 饱和度，y 明度 -->
      <div
        class="cp__sv"
        role="slider"
        tabindex="0"
        :style="svBg"
        :aria-label="`${label}：饱和度与明度`"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="Math.round(hsva.s * 100)"
        :aria-valuetext="`饱和度 ${Math.round(hsva.s * 100)}%，明度 ${Math.round(hsva.v * 100)}%`"
        @pointerdown="beginDrag($event, 'sv')"
        @keydown.left.prevent="onKeydownTrack('sv', -0.02)"
        @keydown.right.prevent="onKeydownTrack('sv', 0.02)"
        @keydown.up.prevent="onKeydownTrack('sv', 0, -0.02)"
        @keydown.down.prevent="onKeydownTrack('sv', 0, 0.02)"
      >
        <span class="cp__thumb" :style="svHandle" aria-hidden="true" />
      </div>

      <!-- 竖直透明度滑杆（消费方只收不透明色时整列不给） -->
      <div v-if="alphaEnabled" class="cp__alpha">
        <span
          class="cp__track cp__track--alpha"
          role="slider"
          tabindex="0"
          :aria-label="`${label}：透明度`"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="Math.round(hsva.a * 100)"
          :style="{ '--alpha-mask': alphaMask }"
          @pointerdown="beginDrag($event, 'alpha')"
          @keydown.up.prevent="onKeydownTrack('alpha', 0, -0.01)"
          @keydown.down.prevent="onKeydownTrack('alpha', 0, 0.01)"
        >
          <span class="cp__thumb cp__thumb--vbar" :style="alphaHandle" aria-hidden="true" />
        </span>
        <span class="cp__col" aria-hidden="true">{{ Math.round(hsva.a * 100) }}%</span>
      </div>
    </div>

    <!-- 色相滑杆 -->
    <div class="cp__row">
      <span
        class="cp__track"
        :style="{ background: hueBg }"
        role="slider"
        tabindex="0"
        :aria-label="`${label}：色相`"
        aria-valuemin="0"
        aria-valuemax="359"
        :aria-valuenow="Math.round(hsva.h)"
        @pointerdown="beginDrag($event, 'hue')"
        @keydown.left.prevent="onKeydownTrack('hue', -0.01)"
        @keydown.right.prevent="onKeydownTrack('hue', 0.01)"
      >
        <span class="cp__thumb cp__thumb--hbar" :style="hueHandle" aria-hidden="true" />
      </span>
    </div>

    <!-- 预览 + hex 输入 -->
    <div class="cp__foot">
      <span class="cp__swatch" aria-hidden="true">
        <span class="cp__swatch-inner" :style="{ backgroundColor: current }" />
      </span>
      <input
        class="cp__hexinput"
        type="text"
        spellcheck="false"
        autocomplete="off"
        :aria-label="`${label}：十六进制代码（如 ${alphaEnabled ? '#RRGGBBAA' : '#RRGGBB'}）`"
        :value="draft"
        :placeholder="alphaEnabled ? '#RRGGBBAA' : '#RRGGBB'"
        @input="onHexInput"
        @keydown.enter.prevent="commitHex"
        @blur="commitHex"
      />
    </div>
  </div>
</template>

<style scoped>
/* 外观全部走中性浮层令牌：面板与右键菜单同一档玻璃，不引入新的面 */

.cp {
  position: fixed;
  z-index: var(--z-menu);
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-menu);
  backdrop-filter: var(--glass-menu);
  box-shadow: var(--shadow-md);
  user-select: none;
}

@supports not (backdrop-filter: blur(1px)) {
  .cp {
    background: var(--surface-3);
  }
}

.cp__sv {
  position: relative;
  width: 168px;
  height: 168px;
  border-radius: var(--sp-2);
  touch-action: none;
  cursor: crosshair;
}

/* 主体一行：SV 方块在左，竖直透明度滑杆在右，等高对齐 */
.cp__main {
  display: flex;
  align-items: stretch;
  gap: var(--sp-3);
}

/* 竖直透明度滑杆的架子：轨道 + 底下百分比读数 */
.cp__alpha {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
}

/* 手柄：SV 方块用圆环，滑杆（透明/色相）用 --bar 的窄圆角矩形 */
.cp__thumb {
  position: absolute;
  width: 13px;
  height: 13px;
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.45);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

/*
 * 滑杆手柄：窄 4px 的圆角矩形，沿各自轨道方向拉长，圆点已废弃。
 * 位置分两半：主轴（竖直滑杆的 top / 横杆的 left）由手柄样式钉在轨道计算值上，
 * 另一半（vbar 的 left / hbar 的 top）必须自己钉在 50%——否则落到 auto 的静态位，
 * 宽 16px 的细条相对 12px 轨道就偏到左上角，看起来整条往上/往左移了一截。
 */
.cp__thumb--vbar,
.cp__thumb--hbar {
  position: absolute;
  border-radius: 2px;
  background: var(--color-text);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.5);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

/* 竖直透明度轨道上的横向细条：top 由 handler 给定，left 钉在轨道中线 */
.cp__thumb--vbar {
  width: 16px;
  height: 4px;
  left: 50%;
}

/* 色相横杆上的纵向细条：left 由 handler 给定，top 钉在轨道中线 */
.cp__thumb--hbar {
  width: 4px;
  height: 16px;
  top: 50%;
}

.cp__row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}

.cp__track {
  position: relative;
  flex: 1;
  height: 12px;
  border-radius: var(--r-full);
  box-shadow: inset 0 0 0 1px var(--line);
  touch-action: none;
  cursor: pointer;
}

.cp__track--alpha {
  /* 竖直轨道：宽 12px，高撑满 .cp__alpha（与 SV 方块等高） */
  width: 12px;
  height: auto;
  flex: 1 0 auto;
  /* 棋盘底（中性深浅灰）+ 当前色的不透明→透明上层（--alpha-mask），两层叠出透明度 */
  background-image:
    linear-gradient(45deg, rgb(0 0 0 / 0.2) 25%, transparent 25%),
    linear-gradient(-45deg, rgb(0 0 0 / 0.2) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgb(0 0 0 / 0.2) 75%),
    linear-gradient(-45deg, transparent 75%, rgb(0 0 0 / 0.2) 75%),
    var(--alpha-mask, none);
  background-size:
    9px 9px,
    9px 9px,
    9px 9px,
    9px 9px,
    100% 100%;
  background-repeat: repeat;
  background-color: var(--fill);
}

.cp__col {
  flex: none;
  width: 38px;
  color: var(--color-text-dim);
  font-size: var(--fs-sm);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.cp__foot {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
  padding-top: var(--sp-2);
  border-top: 1px solid var(--line);
}

.cp__swatch {
  width: 34px;
  height: 24px;
  flex: none;
  overflow: hidden;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background-image:
    linear-gradient(45deg, rgb(0 0 0 / 0.2) 25%, transparent 25%),
    linear-gradient(-45deg, rgb(0 0 0 / 0.2) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgb(0 0 0 / 0.2) 75%),
    linear-gradient(-45deg, transparent 75%, rgb(0 0 0 / 0.2) 75%);
  background-position:
    0 0,
    0 4.5px,
    4.5px -4.5px,
    -4.5px 0;
  background-size: 9px 9px;
}

.cp__swatch-inner {
  width: 100%;
  height: 100%;
}

.cp__hexinput {
  flex: 1;
  min-width: 0;
  padding: var(--sp-2) var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--fill);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--fs-sm);
  text-transform: uppercase;
}

.cp__hexinput:focus {
  border-color: var(--focus);
  outline: none;
}
</style>

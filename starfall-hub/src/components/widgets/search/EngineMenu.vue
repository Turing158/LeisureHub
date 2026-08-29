<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import EngineIcon from './EngineIcon.vue'
import type { EngineDef } from '@/data/engines'

const props = defineProps<{
  /** 触发按钮的视口矩形，菜单贴着它的下沿左对齐展开 */
  anchor: { left: number; top: number; bottom: number }
  engines: EngineDef[]
  /** 当前引擎 id，带选中标记 */
  currentId: string
}>()

const emit = defineEmits<{
  select: [id: string]
  close: []
}>()

/** 与视口边缘的最小留白，翻转后也不贴边 */
const MARGIN = 8
/** 菜单与按钮之间的缝，与 --sp-1 同量级 */
const OFFSET = 4

const menuEl = ref<HTMLElement | null>(null)
const itemEls = ref<HTMLElement[]>([])
/** 键盘高亮项；-1 表示尚未用键盘进入 */
const activeIndex = ref(-1)
/** 实测尺寸后再定位，避免首帧闪一下错位 */
const placed = ref(false)
const left = ref(0)
const top = ref(0)
const origin = ref('left top')

/**
 * 定位：默认在按钮下方左对齐；下方空间不足则翻到上方，仍不足则夹到边内。
 *
 * 与 ContextMenu 同一套「挂载后实测再定位」的做法（菜单高度随引擎条数变化，
 * 不是常量），差别只在锚点是一个矩形而不是一个点——所以翻转时贴的是
 * 按钮的上沿而非同一个 y。
 */
async function place() {
  placed.value = false
  await nextTick()
  const el = menuEl.value
  if (!el) return

  const { width, height } = el.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight

  const flipY = props.anchor.bottom + OFFSET + height + MARGIN > vh
  const rawTop = flipY ? props.anchor.top - OFFSET - height : props.anchor.bottom + OFFSET

  origin.value = `left ${flipY ? 'bottom' : 'top'}`
  left.value = Math.min(Math.max(MARGIN, props.anchor.left), Math.max(MARGIN, vw - width - MARGIN))
  top.value = Math.min(Math.max(MARGIN, rawTop), Math.max(MARGIN, vh - height - MARGIN))
  placed.value = true

  /*
   * 焦点收到菜单容器上。
   *
   * 与 ContextMenu 一致，也与 SuggestList 刻意相反：引擎菜单没有需要保住焦点的
   * 输入框，把焦点挪进来才能让方向键归菜单管；而建议列表必须把焦点留在输入框里，
   * 否则输入法状态和光标位置一起丢掉（见 SearchWidget 的键盘处理）。
   */
  el.focus()
}

/** 在选项之间移动高亮；纯模运算循环，与 ContextMenu.move 同构 */
function move(delta: number) {
  const count = props.engines.length
  if (count === 0) return
  const from = activeIndex.value
  const next = from === -1 ? (delta > 0 ? 0 : count - 1) : (from + delta + count) % count
  activeIndex.value = next
  itemEls.value[next]?.focus()
}

function focusAt(index: number) {
  activeIndex.value = index
  itemEls.value[index]?.focus()
}

function onKeydown(event: KeyboardEvent) {
  switch (event.key) {
    case 'Escape':
      // 现有浮层的 Esc 处理都在 window 上并带 stopPropagation，不拦的话会连带关掉抽屉
      event.stopPropagation()
      requestClose()
      break
    case 'ArrowDown':
      event.preventDefault()
      move(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      move(-1)
      break
    case 'Home':
      event.preventDefault()
      focusAt(0)
      break
    case 'End':
      event.preventDefault()
      focusAt(props.engines.length - 1)
      break
    // Tab 不在菜单内循环而是直接关闭：菜单是瞬时浮层，不做焦点陷阱
    case 'Tab':
      event.preventDefault()
      requestClose()
      break
  }
}

/** 视口变化后锚点矩形已无意义，直接关闭而不是漂移到别处 */
function onViewportChange() {
  requestClose()
}

/**
 * 摘掉全局监听。
 *
 * 关闭时立即调用而不是等 onBeforeUnmount——退场过渡期间组件还挂着，
 * 那段时间里捕获阶段的 pointerdown 会把用户紧接着的一次点击吞掉。幂等。
 */
function detach() {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
  window.removeEventListener('pointerdown', onPointerDownOutside, true)
}

function requestClose() {
  detach()
  emit('close')
}

function onSelect(id: string) {
  detach()
  emit('select', id)
}

function onPointerDownOutside(event: PointerEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('[data-engine-menu]')) return
  /*
   * 触发按钮上的按下**完全放行**：不关闭、不 preventDefault、不 stopPropagation。
   *
   * 关闭交给按钮自己的 click（它会看到 menuOpen 仍为 true 而收起菜单）。
   * 在这里抢先关掉的话，随后的 click 看到的已经是「关着」，于是又打开一次——
   * 表现为「再点一次关不掉」。
   */
  if (target?.closest('[data-engine-toggle]')) return

  event.preventDefault()
  event.stopPropagation()
  requestClose()
}

onMounted(() => {
  place()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
  // 捕获阶段监听：菜单外任何按下都关闭，且不让该次按下继续触发下层交互
  window.addEventListener('pointerdown', onPointerDownOutside, true)
})

onBeforeUnmount(detach)

/*
 * 暴露 detach 给父组件。
 *
 * 父组件用 v-if 收起菜单时（点触发按钮的第二下），组件在退场过渡期间仍然挂着，
 * 那段时间里捕获阶段的 pointerdown 会把用户紧接着的一次点击吞掉。
 * onBeforeUnmount 太晚——它在过渡结束后才跑。所以父组件在改 v-if 之前先调这个。
 * 幂等，与自身的关闭路径共用同一个函数。
 */
defineExpose({ detach })
</script>

<template>
  <!-- Teleport 与进出场过渡由外层 OverlayLayer 负责 -->
  <div
    ref="menuEl"
    class="engines"
    :class="{ 'is-placed': placed }"
    :style="{ left: `${left}px`, top: `${top}px`, transformOrigin: origin }"
    data-engine-menu
    role="menu"
    aria-label="搜索引擎"
    tabindex="-1"
  >
    <button
      v-for="(engine, i) in engines"
      :key="engine.id"
      :ref="(el) => { if (el) itemEls[i] = el as HTMLElement }"
      class="engines__item"
      type="button"
      role="menuitemradio"
      :aria-checked="engine.id === currentId"
      tabindex="-1"
      @click="onSelect(engine.id)"
      @mouseenter="activeIndex = i"
    >
      <span class="engines__icon">
        <EngineIcon :name="engine.icon" />
      </span>
      <span class="engines__label">{{ engine.name }}</span>
      <!-- 勾号而非底色：底色已被 hover 占用，两者叠在一起分不出「选中」与「所指」 -->
      <span v-if="engine.id === currentId" class="engines__check" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="m5 12.5 4.5 4.5L19 7"
          />
        </svg>
      </span>
    </button>
  </div>
</template>

<style scoped>
/*
 * 面板语言与 ContextMenu 完全一致（同一组令牌），只有层级不同：
 * --z-engine-menu 950 高于 --z-drag 900、低于 --z-dialog 1000——
 * 搜索弹层不该盖住 Dialog 与抽屉，但要盖住拖拽浮层。
 */
.engines {
  position: fixed;
  z-index: var(--z-engine-menu);
  display: flex;
  min-width: 148px;
  flex-direction: column;
  padding: var(--sp-1);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-menu);
  backdrop-filter: var(--glass-menu);
  box-shadow: var(--shadow-md);
  gap: 2px;
  /* 定位前藏起来：高度随引擎条数变化，必须先量后放 */
  opacity: 0;
}

@supports not (backdrop-filter: blur(1px)) {
  .engines {
    background: var(--surface-3);
  }
}

.engines.is-placed {
  /* 显隐由 opacity 直接决定，动画只负责观感；动画被禁用时菜单仍然可见 */
  opacity: 1;
}

/*
 * 进出场。选择器都带上 .engines 才能与上面的 .is-placed 同权重——
 * 同权重下后写者生效，于是退场的 opacity: 0 能盖住 is-placed 的 opacity: 1。
 */
.engines.engine-menu-enter-active,
.engines.engine-menu-leave-active {
  transition:
    transform var(--dur-fast) var(--ease),
    opacity var(--dur-fast) var(--ease);
  will-change: transform, opacity;
}

/* 退场中的菜单不再接受点击，否则收起动画期间还能选中已经关掉的项 */
.engines.engine-menu-leave-active {
  pointer-events: none;
}

.engines.engine-menu-enter-from,
.engines.engine-menu-leave-to {
  transform: scale(0.96);
  opacity: 0;
}

.engines__item {
  position: relative;
  display: flex;
  align-items: center;
  /* 36px：与 ContextMenu 同一档密度 */
  min-height: 36px;
  padding: 0 var(--sp-2);
  border-radius: var(--r-sm);
  color: var(--color-text);
  font-size: var(--fs-base);
  gap: var(--sp-2);
  text-align: left;
  white-space: nowrap;
  transition: background-color var(--dur-fast) var(--ease);
}

.engines__item:hover {
  background: var(--fill-raised);
}

.engines__item:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.engines__icon {
  display: grid;
  width: 16px;
  height: 16px;
  flex: none;
  opacity: 0.82;
  place-items: center;
}

.engines__label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.engines__check {
  display: grid;
  width: 14px;
  height: 14px;
  flex: none;
  color: var(--color-text-dim);
  place-items: center;
}

.engines__check svg {
  width: 14px;
  height: 14px;
}

/* 触屏下把行高提到 44px 满足最小命中尺寸，与 ContextMenu 一致 */
@media (pointer: coarse) {
  .engines__item {
    min-height: 44px;
  }
}
</style>

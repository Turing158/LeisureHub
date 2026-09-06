<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { MenuItem } from '@/composables/useContextMenu'

const props = defineProps<{
  /** 触发点视口坐标 */
  x: number
  y: number
  items: MenuItem[]
}>()

const emit = defineEmits<{
  select: [id: string]
  close: []
}>()

/** 与视口边缘的最小留白，翻转后也不贴边 */
const MARGIN = 8

const menuEl = ref<HTMLElement | null>(null)
const itemEls = ref<HTMLElement[]>([])
/** 键盘高亮项；-1 表示尚未用键盘进入 */
const activeIndex = ref(-1)
/** 实测尺寸后再定位，避免首帧闪一下错位 */
const placed = ref(false)
const left = ref(0)
const top = ref(0)
/** 缩放原点：随翻转方向变化，动画始终从指针处展开 */
const origin = ref('left top')

/**
 * 定位：默认右下展开；空间不足则朝反方向翻转，仍不足则夹到边内。
 * 必须等 DOM 渲染后量真实尺寸——菜单项数量随命中区域变化，高度不是常量。
 */
async function place() {
  placed.value = false
  await nextTick()
  const el = menuEl.value
  if (!el) return

  const { width, height } = el.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight

  const flipX = props.x + width + MARGIN > vw
  const flipY = props.y + height + MARGIN > vh

  const rawLeft = flipX ? props.x - width : props.x
  const rawTop = flipY ? props.y - height : props.y

  // 入场缩放的原点贴着触发点，翻转后动画也是从指针处展开
  origin.value = `${flipX ? 'right' : 'left'} ${flipY ? 'bottom' : 'top'}`
  left.value = Math.min(Math.max(MARGIN, rawLeft), Math.max(MARGIN, vw - width - MARGIN))
  top.value = Math.min(Math.max(MARGIN, rawTop), Math.max(MARGIN, vh - height - MARGIN))
  placed.value = true

  /*
   * 焦点收到菜单容器（而非首项）上：
   * 与原生右键菜单一致——打开时没有预选项，Enter 不会误触第一项；
   * 同时把焦点从触发元素挪走，方格自身的 Enter / Space 处理不会隔着菜单继续生效。
   */
  el.focus()
}

/** 在可选项之间移动高亮，跳过（当前没有的）禁用项 */
function move(delta: number) {
  const count = props.items.length
  if (count === 0) return
  const from = activeIndex.value
  const next = from === -1 ? (delta > 0 ? 0 : count - 1) : (from + delta + count) % count
  activeIndex.value = next
  itemEls.value[next]?.focus()
}

function onKeydown(event: KeyboardEvent) {
  switch (event.key) {
    case 'Escape':
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
      activeIndex.value = 0
      itemEls.value[0]?.focus()
      break
    case 'End': {
      event.preventDefault()
      const last = props.items.length - 1
      activeIndex.value = last
      itemEls.value[last]?.focus()
      break
    }
    // Tab 不在菜单内循环，而是直接关闭：菜单是瞬时浮层，不该做焦点陷阱。
    // 拦掉默认行为让焦点回到触发元素，否则 close() 的归还与 Tab 的移动会互相打断。
    case 'Tab':
      event.preventDefault()
      requestClose()
      break
  }
}

/** 视口变化后原坐标已无意义，直接关闭而不是漂移到别处 */
function onViewportChange() {
  requestClose()
}

/**
 * 摘掉全局监听。
 *
 * 关闭时立即调用，而不是等 onBeforeUnmount——退场过渡期间组件还挂着，
 * 那段时间里捕获阶段的 pointerdown 会把用户紧接着的一次点击吞掉。
 * 幂等，卸载时再兜一次也没问题。
 */
function detach() {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
  window.removeEventListener('pointerdown', onPointerDownOutside, true)
}

/** 所有关闭路径都先摘监听再上报，退场动画期间菜单不再拦事件 */
function requestClose() {
  detach()
  emit('close')
}

function onSelect(id: string) {
  detach()
  emit('select', id)
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

function onPointerDownOutside(event: PointerEvent) {
  if ((event.target as HTMLElement | null)?.closest('[data-context-menu]')) return
  // 右键放行：随后的 contextmenu 会把菜单挪到新位置。
  // 若在此 preventDefault，兼容性 mousedown 被取消，某些平台就不再派发 contextmenu。
  if (event.button === 2) return
  event.preventDefault()
  event.stopPropagation()
  requestClose()
}

// 同一次打开中换了位置（在别处再次右键）：重新定位并复位键盘高亮
watch(
  () => [props.x, props.y, props.items] as const,
  () => {
    activeIndex.value = -1
    itemEls.value = []
    place()
  },
)
</script>

<template>
  <!-- Teleport 与进出场过渡由外层 OverlayLayer 负责 -->
  <div
    ref="menuEl"
    class="menu"
    :class="{ 'is-placed': placed }"
    :style="{ left: `${left}px`, top: `${top}px`, transformOrigin: origin }"
    data-context-menu
    role="menu"
    aria-label="快捷菜单"
    tabindex="-1"
    @contextmenu.prevent
  >
    <button
      v-for="(item, i) in items"
      :key="item.id"
      :ref="(el) => { if (el) itemEls[i] = el as HTMLElement }"
      class="menu__item"
      :class="{ 'is-danger': item.danger, 'has-separator': item.separatorBefore && i > 0 }"
      type="button"
      role="menuitem"
      tabindex="-1"
      @click="onSelect(item.id)"
      @mouseenter="activeIndex = i"
    >
      <span class="menu__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
          <template v-if="item.icon === 'add'">
            <path stroke-linecap="round" d="M12 5v14M5 12h14" />
          </template>
          <template v-else-if="item.icon === 'edit'">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20Z"
            />
          </template>
          <template v-else-if="item.icon === 'delete'">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13M10 11v6M14 11v6"
            />
          </template>
          <template v-else-if="item.icon === 'refresh'">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4"
            />
          </template>
          <template v-else-if="item.icon === 'settings'">
            <!-- 滑块而非齿轮：齿轮在 16px 下细节糊成一团，且与抽屉内的设置项图标同源 -->
            <path stroke-linecap="round" d="M4 7h9m3 0h4M4 17h4m3 0h9" />
            <circle cx="15" cy="7" r="2.2" />
            <circle cx="9.5" cy="17" r="2.2" />
          </template>
        </svg>
      </span>
      <span class="menu__label">{{ item.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.menu {
  position: fixed;
  z-index: var(--z-menu);
  display: flex;
  min-width: 148px;
  flex-direction: column;
  padding: var(--sp-1);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-menu);
  backdrop-filter: var(--glass-menu);
  /* 单层阴影，不再叠顶部内高光——与抽屉、弹窗同一套面板语言 */
  box-shadow: var(--shadow-md);
  gap: 2px;
  /* 定位前藏起来：菜单高度随项数变化，必须先量后放，否则首帧会闪一下错位 */
  opacity: 0;
}

@supports not (backdrop-filter: blur(1px)) {
  .menu {
    background: var(--surface-3);
  }
}

.menu.is-placed {
  /* 显隐由 opacity 直接决定，动画只负责观感；动画被禁用时菜单仍然可见 */
  opacity: 1;
}

/*
 * 进出场。
 *
 * 选择器都带上 .menu，才能和上面的 .menu.is-placed 同权重——同权重下后写者生效，
 * 于是退场的 opacity: 0 能盖住 is-placed 的 opacity: 1。
 *
 * 入场只需等 place() 量完尺寸：nextTick 属于微任务，早于 Vue 移除 enter-from 用的
 * requestAnimationFrame，所以过渡开始时坐标已是最终值，不会从 (0,0) 滑进来。
 */
.menu.menu-enter-active,
.menu.menu-leave-active {
  transition:
    transform var(--dur-fast) var(--ease),
    opacity var(--dur-fast) var(--ease);
  /* 动画期间独立成层，避免每帧牵动父级表面；class 移除后自动撤销 */
  will-change: transform, opacity;
}

/* 退场中的菜单不再接受点击，否则收起动画期间还能选中已经关掉的项 */
.menu.menu-leave-active {
  pointer-events: none;
}

/* 缩放原点已随翻转贴住指针，因此这里的缩放看起来就是「从指针处展开 / 收回」 */
.menu.menu-enter-from,
.menu.menu-leave-to {
  transform: scale(0.96);
  opacity: 0;
}

.menu__item {
  position: relative;
  display: flex;
  align-items: center;
  /* 高度 36px：桌面右键菜单的常规密度，命中区域仍远大于文字行高 */
  min-height: 36px;
  padding: 0 var(--sp-2);
  border-radius: var(--r-sm);
  color: var(--color-text);
  font-size: var(--fs-base);
  gap: var(--sp-2);
  text-align: left;
  white-space: nowrap;
  transition:
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.menu__item:hover {
  background: var(--fill-raised);
}

.menu__item:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

/* 危险项：红色文字 + 悬停红色底，颜色之外还有独立的删除图标区分 */
.menu__item.is-danger {
  color: var(--danger);
}

.menu__item.is-danger:hover {
  background: var(--danger-bg);
}

/* 分隔线用伪元素画，不额外插入需要 aria 处理的节点 */
.menu__item.has-separator {
  margin-top: 5px;
}

.menu__item.has-separator::before {
  position: absolute;
  height: 1px;
  background: var(--line-strong);
  content: '';
  inset: -3px var(--sp-1) auto;
}

.menu__icon {
  display: grid;
  width: 16px;
  height: 16px;
  flex: none;
  color: currentcolor;
  opacity: 0.82;
  place-items: center;
}

.menu__icon svg {
  width: 16px;
  height: 16px;
}

.menu__label {
  flex: 1;
}

/* 触屏长按也会唤出此菜单，粗指针下把行高提到 44px 满足最小命中尺寸 */
@media (pointer: coarse) {
  .menu__item {
    min-height: 44px;
  }
}
</style>

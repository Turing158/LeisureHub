<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import TabCustom from './TabCustom.vue'
import TabRecommend from './TabRecommend.vue'
import TabWidgetEdit from './TabWidgetEdit.vue'
import TabWidgets from './TabWidgets.vue'
import { useSettingsStore } from '@/stores/settings'
import type { LinkTile, Tile, TileDraft, WidgetTile } from '@/types/tile'

type TabKey = 'custom' | 'widget' | 'recommend'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'custom', label: '自定义' },
  { key: 'widget', label: '组件' },
  { key: 'recommend', label: '推荐' },
]

const props = defineProps<{
  /**
   * 传入即为编辑模式：tab 栏换成标题，只显示对应类型的表单。
   * link 走 TabCustom，widget 走 TabWidgetEdit。
   */
  editing?: Tile
}>()

const emit = defineEmits<{
  close: []
  submit: [draft: TileDraft]
}>()

const isEdit = computed(() => props.editing !== undefined)

const settings = useSettingsStore()

/** 点遮罩关闭：由设置开关控制，关掉后表单不会因误点空白处丢失 */
function onScrimPointerDown() {
  if (settings.closeOnScrim) requestClose()
}

/** 两个编辑表单按类型二选一，模板里各用一个窄类型，避免在模板里做类型收窄 */
const editingLink = computed(() =>
  props.editing?.kind === 'link' ? (props.editing as LinkTile) : undefined,
)
const editingWidget = computed(() =>
  props.editing?.kind === 'widget' ? (props.editing as WidgetTile) : undefined,
)

const active = ref<TabKey>('custom')
const panelEl = ref<HTMLElement | null>(null)
const bodyEl = ref<HTMLElement | null>(null)
const tabRefs = ref<HTMLElement[]>([])

/** 内容切换方向：决定新旧面板往哪一侧滑，与 tab 的相对位置一致 */
const swapDir = ref<'fwd' | 'back'>('fwd')

const activeIndex = computed(() => {
  const found = TABS.findIndex((tab) => tab.key === active.value)
  return found < 0 ? 0 : found
})

/**
 * 滑块位置，同 SegmentedControl 的算法。
 *
 * 宽度按 tab 数等分（扣掉容器两侧内边距），translateX 的百分比相对自身宽度，
 * 所以「第 n 格」正好是 n * 100%，容器随视口缩放时无需实测重算。
 */
const thumbStyle = computed(() => ({
  width: `calc((100% - var(--tabs-inset) * 2) / ${TABS.length})`,
  transform: `translateX(${activeIndex.value * 100}%)`,
}))

/** 切 tab 的唯一入口：先定方向再改值，过渡名在同一次更新里就位 */
function setActive(key: TabKey) {
  if (key === active.value) return
  swapDir.value = TABS.findIndex((tab) => tab.key === key) > activeIndex.value ? 'fwd' : 'back'
  active.value = key
}

/** tab 栏方向键切换（role="tablist" 的键盘约定） */
function onTabKeydown(event: KeyboardEvent, index: number) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const delta = event.key === 'ArrowRight' ? 1 : -1
  const next = (index + delta + TABS.length) % TABS.length
  setActive(TABS[next].key)
  tabRefs.value[next]?.focus()
}

/*
 * 面板高度接管。
 *
 * 三个 tab 的自然高度差不小，若不管高度，切换时面板会在一帧内从旧高度跳到新高度，
 * 跳变比滑动本身更抢眼。于是离场时把当前高度钉住，新内容挂载后量出目标高度再过渡过去，
 * 过渡结束把高度交还 auto——否则内容自身变高（例如表单冒出报错）时面板不会跟着长。
 */
let lockedHeight = 0
let raf = 0
let onHeightEnd: ((event: TransitionEvent) => void) | null = null

/**
 * 高度钉死期间连带锁掉纵向滚动。
 *
 * 变高的那半段里内容已经比钉住的高度高，滚动条会闪一下再消失。
 */
const heightLocked = ref(false)

/** 内边距从计算样式读，避免在 JS 里再抄一份 .panel__body 的 padding */
function bodyPadding(body: HTMLElement): number {
  const style = getComputedStyle(body)
  return Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
}

/** 撤掉上一轮未跑完的收尾动作：连点 tab 时新一轮要从干净状态起跳 */
function clearPending() {
  if (raf) {
    cancelAnimationFrame(raf)
    raf = 0
  }
  if (onHeightEnd && bodyEl.value) {
    bodyEl.value.removeEventListener('transitionend', onHeightEnd)
  }
  onHeightEnd = null
}

/** 解除高度钉死，把布局交还 auto */
function releaseHeight() {
  clearPending()
  heightLocked.value = false
  if (bodyEl.value) bodyEl.value.style.height = ''
}

function onSwapLeave() {
  const body = bodyEl.value
  if (!body) return
  /*
   * 先量后清：连点时量到的是上一轮过渡中途的插值高度，新一轮正好从当前视觉位置续上。
   * 若先 clearPending 把待写的目标值撤掉再量，量到的仍是插值，顺序其实无碍，
   * 但保持「量 → 清 → 钉」的次序更直白。
   */
  lockedHeight = body.offsetHeight
  clearPending()
  heightLocked.value = true
  body.style.height = `${lockedHeight}px`
}

function onSwapEnter(el: Element) {
  const body = bodyEl.value
  if (!body) return

  const target = (el as HTMLElement).offsetHeight + bodyPadding(body)

  // 高度没变就没有过渡可等，transitionend 不会来，必须当场解锁
  if (target === lockedHeight) {
    releaseHeight()
    return
  }

  /*
   * 解锁交给 height 自己的 transitionend，不搭在 afterEnter 上。
   *
   * 目标值要等下一帧才写（同帧写两次不产生过渡），高度过渡因此比内容过渡晚起跑，
   * 若在 afterEnter 解锁，高度会在最后十几毫秒被抹平成 auto 而出现一次轻微跳动。
   */
  onHeightEnd = (event: TransitionEvent) => {
    if (event.target !== body || event.propertyName !== 'height') return
    releaseHeight()
  }
  body.addEventListener('transitionend', onHeightEnd)

  body.style.height = `${lockedHeight}px`
  raf = requestAnimationFrame(() => {
    raf = 0
    body.style.height = `${target}px`
  })
}

/** 焦点陷阱：Tab 在面板内循环，Esc 关闭 */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    requestClose()
    return
  }
  if (event.key !== 'Tab' || !panelEl.value) return

  const focusables = panelEl.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )
  if (focusables.length === 0) return

  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const current = document.activeElement as HTMLElement | null

  if (!event.shiftKey && current === last) {
    event.preventDefault()
    first.focus()
  } else if (event.shiftKey && current === first) {
    event.preventDefault()
    last.focus()
  }
}

/**
 * 关闭时立刻摘掉键盘监听，而不是等卸载。
 *
 * 退场过渡期间组件还挂着，若监听还在，这段时间的 Tab 会被焦点陷阱抓回正在消失的面板里。
 * 幂等，卸载时再兜一次也没问题。
 */
function detach() {
  window.removeEventListener('keydown', onKeydown)
}

function requestClose() {
  detach()
  emit('close')
}

/** 提交同样会让调用方关掉面板，走一样的收尾 */
function onSubmit(draft: TileDraft) {
  detach()
  emit('submit', draft)
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  await nextTick()
  panelEl.value?.querySelector<HTMLElement>('input, button')?.focus()
})

onBeforeUnmount(() => {
  detach()
  releaseHeight()
})
</script>

<template>
  <!--
    遮罩拆成三层，理由同 SettingsDrawer：磨砂层属性恒定，
    只让纯色的 __tint 参与淡入淡出，避免每帧重做全屏 backdrop-filter。
    Teleport 与进出场过渡由外层 OverlayLayer 负责。
  -->
  <div class="overlay" @pointerdown.self="onScrimPointerDown">
    <div class="overlay__glass" aria-hidden="true" />
    <div class="overlay__tint" aria-hidden="true" />

    <div ref="panelEl" class="panel" role="dialog" aria-modal="true" aria-labelledby="add-tile-title">
      <div class="panel__head" :class="{ 'is-edit': isEdit }">
        <!-- 编辑模式只改现有条目，切到「组件」「推荐」没有意义，用标题替掉整栏 -->
        <div v-if="!isEdit" class="tabs" role="tablist" aria-label="添加方式">
          <span class="tabs__thumb" :style="thumbStyle" aria-hidden="true" />

          <button
            v-for="(tab, i) in TABS"
            :key="tab.key"
            :ref="(el) => { if (el) tabRefs[i] = el as HTMLElement }"
            class="tabs__item"
            :class="{ 'is-active': active === tab.key }"
            type="button"
            role="tab"
            :aria-selected="active === tab.key"
            :tabindex="active === tab.key ? 0 : -1"
            @click="setActive(tab.key)"
            @keydown="onTabKeydown($event, i)"
          >
            {{ tab.label }}
          </button>
        </div>

        <h2 id="add-tile-title" :class="isEdit ? 'panel__title' : 'sr-only'">
          {{ isEdit ? (editingWidget ? '编辑组件' : '编辑方格') : '添加内容到方格' }}
        </h2>

        <button class="close" type="button" aria-label="关闭" @click="requestClose">×</button>
      </div>

      <!--
        out-in：新旧内容不重叠，同一时刻只有一份参与布局，滑动方向由 swapDir 决定。
        高度改由 onSwapLeave / onSwapEnter 接管，避免交接那一帧的高度跳变。
      -->
      <div
        ref="bodyEl"
        class="panel__body"
        :class="{ 'is-locked': heightLocked }"
        :role="isEdit ? undefined : 'tabpanel'"
      >
        <Transition
          :name="`swap-${swapDir}`"
          mode="out-in"
          @leave="onSwapLeave"
          @enter="onSwapEnter"
        >
          <TabWidgetEdit
            v-if="editingWidget"
            key="widget-edit"
            :tile="editingWidget"
            @submit="onSubmit"
          />
          <TabCustom
            v-else-if="isEdit || active === 'custom'"
            key="custom"
            :initial="editingLink"
            @submit="onSubmit"
          />
          <TabWidgets v-else-if="active === 'widget'" key="widget" @pick="onSubmit" />
          <TabRecommend v-else key="recommend" @pick="onSubmit" />
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  z-index: var(--z-dialog);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-5);
  inset: 0;
}

/* 装饰层不吃事件，@pointerdown.self 仍命中 .overlay 本身 */
.overlay__glass,
.overlay__tint {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* 磨砂层：不参与任何过渡 */
.overlay__glass {
  backdrop-filter: var(--glass-scrim);
}

.overlay__tint {
  background: var(--overlay-tint);
}

/* 不支持 backdrop-filter 时退化为更深的纯色半透明 */
@supports not (backdrop-filter: blur(1px)) {
  .overlay__tint {
    background: rgb(6 6 8 / 0.82);
  }
}

.panel {
  position: relative;
  display: flex;
  width: min(560px, 100%);
  max-height: min(560px, 100%);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--panel-radius);
  background: var(--bg-panel);
  backdrop-filter: var(--glass-panel);
  box-shadow: var(--shadow-lg);
}

@supports not (backdrop-filter: blur(1px)) {
  .panel {
    background: var(--surface-2);
  }
}

/*
 * tab 栏居中，关闭按钮改为绝对定位。
 *
 * 若让关闭按钮继续参与流内布局，居中的就是「tab 栏 + 按钮」这一组，
 * tab 栏本身会被按钮的宽度推得偏左。
 */
.panel__head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px var(--sp-3) 2px;
}

/* 编辑模式没有 tab 栏，标题回到左侧常规位置 */
.panel__head.is-edit {
  justify-content: flex-start;
  padding-left: var(--sp-4);
}

.panel__title {
  margin: 0;
  flex: 1;
  font-size: var(--fs-md);
  font-weight: 600;
}

/* 与 SegmentedControl 的 .seg 同构：同一套分段控件语言，值必须一致 */
.tabs {
  --tabs-inset: 4px;

  position: relative;
  display: flex;
  padding: var(--tabs-inset);
  border: 1px solid var(--line-subtle);
  border-radius: var(--r-md);
  background: var(--fill);
}

/* 滑块垫在按钮下层（靠 z-index 分层，按钮自身不加底色），切换时才有连续位移感 */
.tabs__thumb {
  position: absolute;
  z-index: 0;
  top: var(--tabs-inset);
  bottom: var(--tabs-inset);
  left: var(--tabs-inset);
  border-radius: var(--r-sm);
  background: var(--fill-raised);
  box-shadow: var(--shadow-sm);
  transition: transform var(--dur-base) var(--ease);
}

.tabs__item {
  position: relative;
  z-index: 1;
  /* 等分滑块的宽度算法要求每格实际等宽，否则滑块会对不上文字 */
  width: 72px;
  padding: 7px var(--sp-1);
  border-radius: var(--r-sm);
  color: var(--color-text-dim);
  font-size: var(--fs-base);
  line-height: 1.2;
  white-space: nowrap;
  transition: color var(--dur-fast) var(--ease);
}

.tabs__item:hover {
  color: var(--color-text);
}

.tabs__item.is-active {
  color: var(--color-text);
  font-weight: 500;
}

.tabs__item:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.close {
  position: absolute;
  top: var(--sp-3);
  right: var(--sp-3);
  width: 30px;
  height: 30px;
  border-radius: var(--r-sm);
  color: var(--color-text-dim);
  font-size: 20px;
  line-height: 1;
}

.close:hover {
  background: var(--fill-raised);
  color: var(--color-text);
}

.panel__body {
  /* 横向必须切掉：内容滑入滑出期间会短暂溢出，否则底部闪出一条横向滚动条 */
  overflow: hidden auto;
  padding: 20px;
  transition: height var(--dur-base) var(--ease);
  /* 与设置抽屉 .drawer__body 保持同一套细滚动条 */
  scrollbar-color: rgb(255 255 255 / 0.18) transparent;
  scrollbar-width: thin;
}

/* 高度过渡期间内容可能暂时高于容器，别让滚动条闪进来 */
.panel__body.is-locked {
  overflow: hidden;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* ── tab 内容切换：旧内容向一侧淡出，新内容从另一侧淡入 ─── */

/*
 * 位移量走 em：与内容字号同尺度，面板宽度变化时手感一致。
 * out-in 让两段过渡串联，各自只占一半时间，整体仍是 --dur-base 的观感。
 */
.swap-fwd-enter-active,
.swap-fwd-leave-active,
.swap-back-enter-active,
.swap-back-leave-active {
  transition:
    transform var(--dur-fast) var(--ease),
    opacity var(--dur-fast) var(--ease);
  will-change: transform, opacity;
}

/* 往右切：新内容自右侧进场，旧内容向左侧退场 */
.swap-fwd-enter-from,
.swap-back-leave-to {
  transform: translateX(1.4em);
  opacity: 0;
}

.swap-fwd-leave-to,
.swap-back-enter-from {
  transform: translateX(-1.4em);
  opacity: 0;
}


/*
 * 过渡刻意不落在 .overlay 上：祖先的 opacity < 1 会建立新的 backdrop root，
 * 让 .panel 的模糊只采样到遮罩内部，白付每帧全屏读回的代价。
 */
.dialog-enter-active .overlay__tint,
.dialog-leave-active .overlay__tint {
  transition: opacity var(--dur-base) var(--ease);
  will-change: opacity;
}

/* 退场期间组件还挂着，遮罩得让出点击，否则关闭后有一段时间点不动下面的方格 */
.dialog-leave-active {
  pointer-events: none;
}

.dialog-enter-from .overlay__tint,
.dialog-leave-to .overlay__tint {
  opacity: 0;
}

.dialog-enter-active .panel,
.dialog-leave-active .panel {
  transition:
    transform var(--dur-base) var(--ease),
    opacity var(--dur-base) var(--ease);
  will-change: transform, opacity;
}

/* 从略小 + 偏下进场，退场沿同一路径回收 */
.dialog-enter-from .panel,
.dialog-leave-to .panel {
  transform: translateY(8px) scale(0.97);
  opacity: 0;
}
</style>

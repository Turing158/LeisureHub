<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import CompletedSection from '../widgets/todo/CompletedSection.vue'
import TodoInput from '../widgets/todo/TodoInput.vue'
import TodoRow from '../widgets/todo/TodoRow.vue'
import OverlayLayer from '../OverlayLayer.vue'
import UndoToast from '../UndoToast.vue'
import { useTodoActions } from '@/composables/useTodoActions'
import { useSettingsStore } from '@/stores/settings'

/**
 * 完整待办对话框。
 *
 * 方块里的 grouped 档已经有全部能力，但它受占格挤压：列表只露几行、已完成折叠区
 * 封顶 7em、正文两格宽里一行放得下十几个字。这个对话框给的是**同一套能力去掉尺寸
 * 约束**——不是新功能，是同一份数据的一个不受限的切面（与「桌面上放多个待办方块」
 * 同一个说法，见 useTodos 的文件头）。
 *
 * 入口有两条，判据是「这一档有没有可点的控件」（见 variant.opensOnTileClick）：
 * 宽=1 的四档（count / rail）整块可点，其余三档走方块右上角的进入图标。
 *
 * 结构与 Esc / 焦点陷阱**逐条照 AddTileDialog**，它是本项目唯一的对话框范式：
 * 没有可复用的 BaseDialog，三层遮罩、`detach()` 先于 emit、mount 即打开
 * （没有 open prop）这三条都是那边踩出来的，不能省。
 */
const emit = defineEmits<{
  close: []
}>()

const settings = useSettingsStore()

/**
 * 写操作走共享的组合式函数，与方块里那份是同一套取舍。
 *
 * 不传 live：对话框永远是实时的（预览态里不会出现它——预览渲染的是方块内容），
 * 默认的 `() => true` 正确。
 */
const { todos, undo, notice, add, toggle, remove, clearCompleted, undoLast } = useTodoActions()

/** 点遮罩关闭：与 AddTileDialog 共用同一个设置开关 */
function onScrimPointerDown() {
  if (settings.closeOnScrim) requestClose()
}

const panelEl = ref<HTMLElement | null>(null)
const inputRef = ref<InstanceType<typeof TodoInput> | null>(null)

/** 标题右侧那句摘要：与方块的 .sr-only 同源，但这里是看得见的正文 */
const countText = computed(() =>
  todos.activeCount.value === 0 ? '已清空' : `${todos.activeCount.value} 项未完成`,
)

/* ── 键盘 ────────────────────────────────────────── */

/**
 * 可聚焦的行。
 *
 * **收起的已完成折叠区里那些要排除掉**：那个面板折叠时仍在 DOM 里，靠 inert 移出
 * 焦点序列（CompletedSection 的第三个坑），而 querySelectorAll 照样找得到它们。
 * 与 TodoWidget.focusables 同一份逻辑——它挑的是 [data-todo-focus]，
 * 那个标记就长在 TodoRow 的复选框上，两处消费同一个标记而非各写一套选择器。
 */
function focusables(): HTMLElement[] {
  const root = panelEl.value
  if (!root) return []
  return [...root.querySelectorAll<HTMLElement>('[data-todo-focus]')].filter(
    (el) => el.closest('[inert]') === null,
  )
}

/**
 * ↑ / ↓ 在行间移动焦点，不做循环（到底就停）。
 *
 * 与方块里那份的差别只有一处：这里挂在 .panel 上而不是方块根节点上，
 * 因为已完成折叠区是列表的兄弟节点，挂在列表上时从折叠区里按 ↓ 到不了处理函数。
 */
function onListKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  // 输入行自己处理这两个键；不放行会双重处理（按一次 ↑ 跳两行）
  if ((event.target as HTMLElement | null)?.closest('input[type="text"]')) return

  const list = focusables()
  const at = list.indexOf(document.activeElement as HTMLElement)
  if (at < 0) return
  event.preventDefault()

  const next = at + (event.key === 'ArrowDown' ? 1 : -1)
  if (next < 0) return
  if (next >= list.length) {
    inputRef.value?.focus()
    return
  }
  list[next].focus()
}

/**
 * 焦点陷阱 + Esc。
 *
 * 选择器用 SettingsDrawer 那份完整的 FOCUSABLE 而不是 AddTileDialog 的三项简版：
 * 这个面板里有 a[href] 之外的 select / textarea 虽暂时没有，但漏掉它们是
 * 「将来加一个控件就跳出陷阱」的隐患，而写全没有代价。
 *
 * Escape 用 stopPropagation 不用 preventDefault，且监听在**冒泡**相位——
 * 这样内部浮层（若将来有取色面板一类）用捕获相位就能先于它收掉 Esc。
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    /*
     * 内层控件已经处理过这个 Esc 就让路。
     *
     * 判据是 **defaultPrevented**，不是「输入框里还有字」。后者试过，不成立：
     * TodoInput 的 `@keydown.esc.prevent` 长在 input 上，冒泡时**先于**这个
     * window 监听跑完，等事件到这里 `target.value` 已经被它清成空串了——
     * 于是「打了半句按 Esc」会连带关掉整个面板（实测如此）。
     *
     * TodoInput 的两级 Esc 因此完整成立：有字 → 它清空并 prevent，这里让路；
     * 已空 → 它同样 prevent 但发出 escape 事件，由下面的 @escape 关闭面板。
     * 焦点在别处（某一行的复选框）时没人 prevent，走这里关闭。
     */
    if (event.defaultPrevented) return

    event.stopPropagation()
    requestClose()
    return
  }
  if (event.key !== 'Tab' || !panelEl.value) return

  const list = panelEl.value.querySelectorAll<HTMLElement>(FOCUSABLE)
  if (list.length === 0) return
  const first = list[0]
  const last = list[list.length - 1]
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
 * 关闭时立刻摘掉监听，而不是等卸载。
 *
 * 退场过渡期间组件还挂着，监听若还在，这段时间的 Tab 会被焦点陷阱抓回正在消失的
 * 面板里。幂等，卸载时再兜一次也没问题。
 */
function detach() {
  window.removeEventListener('keydown', onKeydown)
}

function requestClose() {
  detach()
  emit('close')
}

/** 新建后焦点留在输入行：连续录入不用来回点 */
async function onSubmitted(text: string, group: string | undefined) {
  add(text, group)
  await nextTick()
  inputRef.value?.focus()
}

/** 输入行按 ↑：回到列表最后一行 */
function onInputUp() {
  const list = focusables()
  list[list.length - 1]?.focus()
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  await nextTick()
  // 直接对焦输入行：打开这个面板最常见的意图就是记一条
  inputRef.value?.focus()
})

onBeforeUnmount(detach)
</script>

<template>
  <!--
    遮罩三层，理由同 AddTileDialog / SettingsDrawer：磨砂层属性恒定不参与过渡，
    只让纯色的 __tint 淡入淡出，避免每帧重做全屏 backdrop-filter。
    Teleport 与进出场过渡由外层 OverlayLayer 负责，这里不能自带 Teleport。
  -->
  <div class="overlay" @pointerdown.self="onScrimPointerDown">
    <div class="overlay__glass" aria-hidden="true" />
    <div class="overlay__tint" aria-hidden="true" />

    <div
      ref="panelEl"
      class="panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="todo-dialog-title"
      @keydown="onListKeydown"
    >
      <div class="panel__head">
        <h2 id="todo-dialog-title" class="panel__title">待办</h2>
        <span class="panel__count">{{ countText }}</span>
        <button class="close" type="button" aria-label="关闭" @click="requestClose">×</button>
      </div>

      <div class="panel__body">
        <!-- 空清单同样有文案，不留白（与方块里那句同一条纪律） -->
        <p v-if="todos.activeCount.value === 0" class="empty">
          还没有待办。在下面加一条，或用「组名: 内容」分组。
        </p>

        <!--
          按组分节。全部条目都未分组时不画任何标题——只有一个组的时候标题是纯噪音，
          与方块的 grouped 档同一个判据。
        -->
        <template v-else>
          <section v-for="group in todos.groups.value" :key="group.key" class="group">
            <h3 v-if="todos.groups.value.length > 1" class="group__head">{{ group.label }}</h3>
            <TodoRow
              v-for="item in group.items"
              :key="item.id"
              :item="item"
              @toggle="toggle"
              @remove="remove"
            />
          </section>
        </template>
      </div>

      <div class="panel__foot">
        <CompletedSection
          v-if="todos.completedCount.value > 0"
          :items="todos.completed.value"
          @toggle="toggle"
          @remove="remove"
          @clear="clearCompleted"
        />
        <TodoInput ref="inputRef" @submit="onSubmitted" @up="onInputUp" @escape="requestClose" />
      </div>
    </div>

    <!--
      浮条走 OverlayLayer 而不是留在面板里：面板 overflow: hidden 会把它裁掉。
      它的 z-index 是 --z-menu，高于 --z-dialog，所以压在这个面板之上。
    -->
    <OverlayLayer name="toast">
      <UndoToast
        v-if="undo"
        :message="undo.message"
        action-label="撤销"
        @action="undoLast"
        @close="undo = null"
      />
      <UndoToast v-else-if="notice" :message="notice" @close="notice = ''" />
    </OverlayLayer>
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

/* 磨砂层：属性在整个生命周期内恒定，绝不进入任何过渡 */
.overlay__glass {
  backdrop-filter: var(--glass-scrim);
}

.overlay__tint {
  background: var(--overlay-tint);
}

@supports not (backdrop-filter: blur(1px)) {
  .overlay__tint {
    background: rgb(6 6 8 / 0.82);
  }
}

/*
 * 面板比 AddTileDialog 窄一点（460 vs 560）、可以更高（680 vs 560）。
 *
 * 一条待办是一行文字，宽度超过 60 字符反而读得累；而清单是纵向的，
 * 高度才是这个面板的价值——它存在的理由就是「不再只露三行」。
 */
.panel {
  position: relative;
  display: flex;
  width: min(460px, 100%);
  max-height: min(680px, 100%);
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

.panel__head {
  display: flex;
  flex: none;
  align-items: baseline;
  padding: 14px var(--sp-4) var(--sp-2);
  gap: var(--sp-2);
}

.panel__title {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 600;
}

/* 计数跟在标题后面作次要信息，不做徽标：这里空间充足，一句话比一个色块清楚 */
.panel__count {
  flex: 1;
  color: var(--color-text-faint);
  font-size: var(--fs-xs);
}

.close {
  width: 30px;
  height: 30px;
  flex: none;
  align-self: center;
  border-radius: var(--r-sm);
  color: var(--color-text-dim);
  font-size: 20px;
  line-height: 1;
}

.close:hover {
  background: var(--fill-raised);
  color: var(--color-text);
}

.close:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

/*
 * 列表区吃掉余量并内部滚动。
 *
 * flex: 1 + min-height: 0：给 none 会让长清单把输入行顶出面板，
 * 与方块里 .td__body 的那条注释同一个理由。
 */
.panel__body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow-y: auto;
  padding: 0 var(--sp-4);
  scrollbar-color: rgb(255 255 255 / 0.18) transparent;
  scrollbar-width: thin;
}

/*
 * 折叠区与输入行钉在底部，不随列表滚。
 *
 * 输入行是这个面板的主要入口，滚到清单第四十条时它必须还在手边。
 */
.panel__foot {
  display: flex;
  flex: none;
  flex-direction: column;
  border-top: 1px solid var(--line-subtle);
  padding: var(--sp-3) var(--sp-4);
  gap: var(--sp-2);
}

.empty {
  margin: 0;
  padding: var(--sp-2) 0;
  color: var(--color-text-disabled);
  font-size: var(--fs-sm);
  line-height: 1.6;
}

.group {
  display: flex;
  flex: none;
  flex-direction: column;
}

/*
 * 分组标题吸顶——滚到第三组时还知道自己在看哪组。
 * sticky 需要不透明的底，否则滚过的行会从字缝里透出来。
 */
.group__head {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 22px;
  flex: none;
  margin: 0;
  background: var(--surface-2);
  color: var(--color-text-faint);
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: 0.03em;
  line-height: 22px;
}

/* ── 进出场：与 AddTileDialog 同构，只换过渡名 ────── */

/*
 * 过渡刻意不落在 .overlay 上：祖先的 opacity < 1 会建立新的 backdrop root，
 * 让 .panel 的模糊只采样到遮罩内部，白付每帧全屏读回的代价。
 */
.todo-dialog-enter-active .overlay__tint,
.todo-dialog-leave-active .overlay__tint {
  transition: opacity var(--dur-base) var(--ease);
  will-change: opacity;
}

/* 退场期间组件还挂着，遮罩得让出点击，否则关闭后有一段时间点不动下面的方格 */
.todo-dialog-leave-active {
  pointer-events: none;
}

.todo-dialog-enter-from .overlay__tint,
.todo-dialog-leave-to .overlay__tint {
  opacity: 0;
}

.todo-dialog-enter-active .panel,
.todo-dialog-leave-active .panel {
  transition:
    transform var(--dur-base) var(--ease),
    opacity var(--dur-base) var(--ease);
  will-change: transform, opacity;
}

/* 从略小 + 偏下进场，退场沿同一路径回收 */
.todo-dialog-enter-from .panel,
.todo-dialog-leave-to .panel {
  transform: translateY(8px) scale(0.98);
  opacity: 0;
}
</style>

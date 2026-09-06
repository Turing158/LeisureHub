<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { useSettingsStore } from '@/stores/settings'

/**
 * 二次确认对话框。
 *
 * 结构与 Esc / 焦点陷阱**逐条照 TodoDialog**（它又是照 AddTileDialog 的），
 * 那是本项目唯一的对话框范式：三层遮罩、`detach()` 先于 emit、mount 即打开
 * （没有 open prop）。三条都是那边踩出来的，不能省，理由见 TodoDialog 的文件头。
 *
 * 与项目里既有的「先删 + 可撤销」（UndoToast）不同——那条路适用于删一个方块、
 * 删一条待办：影响面小、原状能原样放回。重置抹掉的是**整份**布局、设置与待办，
 * 撤销要先把三份存档各存一个快照，而其中本地壁纸的字节已经从 IndexedDB 删掉了，
 * 撤不回来。做不成的撤销不如问一句。
 *
 * 做成通用组件而不是写死重置的文案：本项目暂时只有一处二次确认，
 * 但「不可撤销的动作要先问」不是重置独有的判据，下一处出现时不该再抄一遍
 * 焦点陷阱与三层遮罩。
 */
const props = withDefaults(
  defineProps<{
    title: string
    /** 正文，说清后果。调用方给完整句子，这里不拼接 */
    message: string
    /** 确认按钮文案 */
    confirmLabel?: string
    cancelLabel?: string
    /**
     * 确认按钮是否画成危险动作（红字红底）。
     *
     * 默认 true：会走到这个对话框的动作本就不可撤销，那是 --danger 的定义。
     */
    danger?: boolean
  }>(),
  { confirmLabel: '确认', cancelLabel: '取消', danger: true },
)

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const settings = useSettingsStore()

const panelEl = ref<HTMLElement | null>(null)
/** 取消按钮：打开时对焦它而不是确认，误按回车不该触发不可撤销的动作 */
const cancelEl = ref<HTMLElement | null>(null)

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * 关闭时立刻摘掉监听，而不是等卸载。
 *
 * 退场过渡期间组件还挂着，监听若还在，这段时间的 Tab 会被焦点陷阱抓回正在消失的
 * 面板里。幂等，卸载时再兜一次也没问题。
 */
function detach() {
  window.removeEventListener('keydown', onKeydown, true)
}

function cancel() {
  detach()
  emit('cancel')
}

function confirm() {
  detach()
  emit('confirm')
}

/**
 * 焦点陷阱 + Esc，监听用**捕获**相位。
 *
 * 这一点与 TodoDialog 相反，因为宿主不同：这个对话框开在设置抽屉**之上**，
 * 而抽屉在自己打开时就已经在 window 上挂了一个冒泡相位的 keydown（它把 Esc
 * 当作「关闭抽屉」）。同相位下先注册的先跑，Esc 会连抽屉一起关掉——
 * 于是用捕获抢在它之前，并 stopPropagation 掉。
 * 这正是 ColorPicker 用捕获的同一条理由（它也开在抽屉之上）。
 */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    cancel()
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
 * 点遮罩关闭。
 *
 * 与其余浮层共用同一个设置开关，但这里等价于「取消」而不是「什么都没发生」——
 * 对一个只有确认/取消两条出路的对话框，两者本就是同一件事。
 */
function onScrimPointerDown() {
  if (settings.closeOnScrim) cancel()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown, true)
  cancelEl.value?.focus()
})

onBeforeUnmount(detach)
</script>

<template>
  <!--
    遮罩三层，理由同 TodoDialog / SettingsDrawer：磨砂层属性恒定不参与过渡，
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
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
    >
      <h2 id="confirm-title" class="panel__title">{{ title }}</h2>
      <p id="confirm-message" class="panel__message">{{ message }}</p>

      <!--
        取消在左、确认在右，且取消是默认焦点。
        这个顺序让「误触」落在无后果的那一侧：Tab 一次到确认，Esc / 回车都是取消。
      -->
      <div class="panel__actions">
        <button ref="cancelEl" class="btn" type="button" @click="cancel">
          {{ cancelLabel }}
        </button>
        <button
          class="btn"
          :class="danger ? 'btn--danger' : 'btn--primary'"
          type="button"
          @click="confirm"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  /*
   * --z-menu 而不是 --z-dialog：它开在设置抽屉（--z-drawer: 1100）之上，
   * dialog 档（1000）会被抽屉盖住。与 ColorPicker 同一档，理由相同。
   */
  z-index: var(--z-menu);
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
 * 面板比 TodoDialog 更窄（380）：里面只有一句话和两个按钮，
 * 宽了会让那句话摊成一行、读起来像标题而不是后果说明。
 * 380 正好与设置抽屉同宽，视觉上像是从它里面长出来的。
 */
.panel {
  position: relative;
  display: flex;
  width: min(380px, 100%);
  flex-direction: column;
  border: 1px solid var(--line);
  border-radius: var(--panel-radius);
  padding: var(--sp-5);
  background: var(--bg-panel);
  backdrop-filter: var(--glass-panel);
  box-shadow: var(--shadow-lg);
  gap: var(--sp-3);
}

@supports not (backdrop-filter: blur(1px)) {
  .panel {
    background: var(--surface-2);
  }
}

.panel__title {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 600;
}

.panel__message {
  margin: 0;
  color: var(--color-text-dim);
  font-size: var(--fs-base);
  line-height: 1.6;
}

/* 按钮右对齐：视线读完正文落在右下角，那里就是下一步 */
.panel__actions {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--sp-1);
  gap: var(--sp-2);
}

.btn {
  padding: var(--sp-2) var(--sp-4);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--fill-raised);
  color: var(--color-text);
  font-size: var(--fs-sm);
  line-height: 1.3;
  transition:
    background-color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}

.btn:hover {
  border-color: var(--line-strong);
  background: var(--fill-hover);
}

.btn:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/*
 * 危险动作：红字 + 淡红底 + 红描边，与右键菜单的 is-danger 同一套令牌。
 * 不用实心红底——那会让它成为整个界面上最重的元素，而这里要的是
 * 「看清了再点」，不是「快来点我」。
 */
.btn--danger {
  border-color: rgb(248 113 113 / 0.32);
  background: var(--danger-bg);
  color: var(--danger);
}

.btn--danger:hover {
  border-color: rgb(248 113 113 / 0.5);
  background: rgb(248 113 113 / 0.24);
}

/* 非危险的确认动作用主题色实心底，与提交按钮同款 */
.btn--primary {
  border-color: transparent;
  background: var(--accent-solid);
}

.btn--primary:hover {
  border-color: transparent;
  background: var(--accent);
}

/* ── 进出场：与 TodoDialog 同构，只换过渡名 ────────── */

/*
 * 过渡刻意不落在 .overlay 上：祖先的 opacity < 1 会建立新的 backdrop root，
 * 让 .panel 的模糊只采样到遮罩内部，白付每帧全屏读回的代价。
 */
.confirm-enter-active .overlay__tint,
.confirm-leave-active .overlay__tint {
  transition: opacity var(--dur-base) var(--ease);
  will-change: opacity;
}

/* 退场期间组件还挂着，遮罩得让出点击，否则关闭后有一段时间点不动下面的控件 */
.confirm-leave-active {
  pointer-events: none;
}

.confirm-enter-from .overlay__tint,
.confirm-leave-to .overlay__tint {
  opacity: 0;
}

.confirm-enter-active .panel,
.confirm-leave-active .panel {
  transition:
    transform var(--dur-base) var(--ease),
    opacity var(--dur-base) var(--ease);
  will-change: transform, opacity;
}

/* 从略小 + 偏下进场，退场沿同一路径回收 */
.confirm-enter-from .panel,
.confirm-leave-to .panel {
  transform: translateY(8px) scale(0.98);
  opacity: 0;
}
</style>

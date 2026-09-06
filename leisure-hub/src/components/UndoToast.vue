<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'

const props = withDefaults(
  defineProps<{
    message: string
    /** 撤销按钮文案；缺省则不显示撤销 */
    actionLabel?: string
    /** 自动消失时长；给撤销留出足够的反应时间 */
    duration?: number
  }>(),
  { duration: 5000 },
)

const emit = defineEmits<{
  action: []
  close: []
}>()

const hasAction = computed(() => props.actionLabel !== undefined)

let timer: number | null = null

function stop() {
  if (timer === null) return
  clearTimeout(timer)
  timer = null
}

/** 悬停 / 聚焦期间不倒计时，避免用户正要点撤销却被收走 */
function start() {
  stop()
  timer = window.setTimeout(() => emit('close'), props.duration)
}

onMounted(start)
onBeforeUnmount(stop)
</script>

<template>
  <!-- role="status" + aria-live：读屏能播报删除结果，不抢焦点。Teleport 与过渡由 OverlayLayer 负责 -->
  <div
    class="toast"
    role="status"
    aria-live="polite"
    @pointerenter="stop"
    @pointerleave="start"
    @focusin="stop"
    @focusout="start"
  >
    <span class="toast__text">{{ message }}</span>
    <button v-if="hasAction" class="toast__action" type="button" @click="emit('action')">
      {{ actionLabel }}
    </button>
    <button class="toast__close" type="button" aria-label="关闭提示" @click="emit('close')">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          stroke="currentColor"
          stroke-linecap="round"
          stroke-width="1.8"
          d="M6 6l12 12M18 6L6 18"
        />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.toast {
  position: fixed;
  bottom: var(--sp-5);
  left: 50%;
  z-index: var(--z-menu);
  display: flex;
  max-width: calc(100vw - 32px);
  align-items: center;
  padding: var(--sp-2) var(--sp-2) var(--sp-2) 14px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-toast);
  backdrop-filter: var(--glass-toast);
  box-shadow: var(--shadow-md);
  gap: var(--sp-2);
  transform: translateX(-50%);
}

@supports not (backdrop-filter: blur(1px)) {
  .toast {
    background: var(--surface-3);
  }
}

/* ── 进出场：从底部滑入，退场沿同一路径回落 ─────────── */

.toast-enter-active,
.toast-leave-active {
  transition:
    transform var(--dur-base) var(--ease),
    opacity var(--dur-base) var(--ease);
  /* 动画期间独立成层；class 移除后自动撤销，不留常驻纹理 */
  will-change: transform, opacity;
}

/* 退场中不再接受点击：此时撤销已经过期或已执行，按下去只会让人以为没生效 */
.toast-leave-active {
  pointer-events: none;
}

/* translateX(-50%) 是居中的一部分，进出场的位移必须把它一并写上，否则会横向跳一下 */
.toast-enter-from,
.toast-leave-to {
  transform: translate(-50%, 12px);
  opacity: 0;
}

.toast__text {
  font-size: var(--fs-base);
}

.toast__action {
  padding: var(--sp-1) var(--sp-3);
  border-radius: var(--r-sm);
  background: var(--fill-hover);
  color: var(--color-text);
  font-size: var(--fs-base);
  font-weight: 500;
  transition: background-color var(--dur-fast) var(--ease);
}

.toast__action:hover {
  background: var(--line-strong);
}

.toast__action:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.toast__close {
  position: relative;
  display: grid;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: var(--r-sm);
  color: var(--color-text-dim);
  place-items: center;
  transition:
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.toast__close svg {
  width: 14px;
  height: 14px;
}

/* 视觉 28px、命中区域补到 44px，满足触控最小尺寸 */
.toast__close::after {
  position: absolute;
  content: '';
  inset: -8px;
}

.toast__close:hover {
  background: var(--fill-raised);
  color: var(--color-text);
}

.toast__close:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
</style>

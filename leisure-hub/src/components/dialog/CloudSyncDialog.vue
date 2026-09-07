<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { useSettingsStore } from '@/stores/settings'

const emit = defineEmits<{ close: [] }>()

const settings = useSettingsStore()
const closeEl = ref<HTMLButtonElement | null>(null)

function detach() {
  window.removeEventListener('keydown', onKeydown, true)
}

function close() {
  detach()
  emit('close')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    close()
    return
  }
  if (event.key !== 'Tab') return

  const panel = closeEl.value?.closest<HTMLElement>('.panel')
  if (!panel) return
  const focusables = panel.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const current = document.activeElement
  if (!event.shiftKey && current === last) {
    event.preventDefault()
    first.focus()
  } else if (event.shiftKey && current === first) {
    event.preventDefault()
    last.focus()
  }
}

function onScrimPointerDown() {
  if (settings.closeOnScrim) close()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown, true)
  closeEl.value?.focus()
})

onBeforeUnmount(detach)
</script>

<template>
  <div class="overlay" @pointerdown.self="onScrimPointerDown">
    <div class="overlay__glass" aria-hidden="true" />
    <div class="overlay__tint" aria-hidden="true" />

    <div
      class="panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cloud-sync-title"
      aria-describedby="cloud-sync-description"
    >
      <header class="panel__head">
        <h2 id="cloud-sync-title" class="panel__title">云同步</h2>
        <button ref="closeEl" class="close" type="button" aria-label="关闭云同步" @click="close">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              stroke="currentColor"
              stroke-linecap="round"
              stroke-width="1.8"
              d="M6 6l12 12M18 6L6 18"
            />
          </svg>
        </button>
      </header>

      <div class="panel__empty">
        <div class="empty__icon" aria-hidden="true">
          <svg viewBox="0 0 48 48" fill="none">
            <path
              d="M14.5 36.5h20.25a8.75 8.75 0 0 0 1.8-17.31A12.25 12.25 0 0 0 12.94 17a9.75 9.75 0 0 0 1.56 19.5Z"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2.4"
            />
            <path d="m18 20 12 12M30 20 18 32" stroke="currentColor" stroke-linecap="round" stroke-width="2.4" />
          </svg>
        </div>
        <h3 class="empty__title">功能暂未开放</h3>
        <p id="cloud-sync-description" class="empty__message">
          云同步功能正在开发中，后续将支持在不同设备间同步你的配置。
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  z-index: var(--z-menu);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-5);
  inset: 0;
}

.overlay__glass,
.overlay__tint {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

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

.panel {
  position: relative;
  width: min(460px, 100%);
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
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-4);
  gap: var(--sp-3);
}

.panel__title {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 600;
}

.panel__empty {
  display: flex;
  align-items: center;
  padding: var(--sp-5) var(--sp-5) calc(var(--sp-5) + var(--sp-2));
  flex-direction: column;
  text-align: center;
}

.empty__icon {
  display: grid;
  width: 56px;
  height: 56px;
  margin-bottom: var(--sp-3);
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--fill);
  color: var(--color-text-dim);
}

.empty__icon svg {
  width: 30px;
  height: 30px;
}

.empty__title {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
}

.empty__message {
  max-width: 32em;
  margin: var(--sp-2) 0 0;
  color: var(--color-text-dim);
  font-size: var(--fs-base);
  line-height: 1.6;
}

.close {
  position: relative;
  display: grid;
  width: 34px;
  height: 34px;
  flex: none;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-dim);
  transition:
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.close svg {
  width: 16px;
  height: 16px;
}

.close::after {
  position: absolute;
  content: '';
  inset: -5px;
}

.close:hover {
  background: var(--fill-raised);
  color: var(--color-text);
}

.close:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.cloud-sync-enter-active .overlay__tint,
.cloud-sync-leave-active .overlay__tint {
  transition: opacity var(--dur-base) var(--ease);
  will-change: opacity;
}

.cloud-sync-leave-active {
  pointer-events: none;
}

.cloud-sync-enter-from .overlay__tint,
.cloud-sync-leave-to .overlay__tint {
  opacity: 0;
}

.cloud-sync-enter-active .panel,
.cloud-sync-leave-active .panel {
  transition:
    transform var(--dur-base) var(--ease),
    opacity var(--dur-base) var(--ease);
  will-change: transform, opacity;
}

.cloud-sync-enter-from .panel,
.cloud-sync-leave-to .panel {
  transform: translateY(8px) scale(0.98);
  opacity: 0;
}
</style>

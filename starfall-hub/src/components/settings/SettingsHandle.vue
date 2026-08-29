<script setup lang="ts">
import { computed } from 'vue'

import { useEdgeHandle } from '@/composables/useEdgeHandle'

const props = defineProps<{
  /** 有浮层压在上面时摘掉磨砂：它在浮层之下，模糊看不见却照样要付合成代价 */
  flat?: boolean
}>()

const emit = defineEmits<{ open: [] }>()

const handle = useEdgeHandle()

/** 停靠坐标：贴住左右某一侧，纵向按比例定位并居中 */
const anchorStyle = computed(() => {
  const side = handle.edge.value === 'left' ? { left: '0px' } : { right: '0px' }
  return { ...side, top: `${handle.ratio.value * 100}%`, transform: 'translateY(-50%)' }
})

function onClick() {
  // 拖拽收尾会带出一次 click，需丢弃，否则松手即打开抽屉
  if (handle.consumeClick()) return
  emit('open')
}
</script>

<template>
  <button
    class="handle"
    :class="[
      `handle--${handle.edge.value}`,
      { 'is-dragging': handle.isDragging.value, 'is-flat': props.flat },
    ]"

    :style="anchorStyle"
    type="button"
    aria-label="设置"
    title="拖动可移动到左右边缘"
    @pointerdown="handle.onPointerDown"
    @pointermove="handle.onPointerMove"
    @pointerup="handle.onPointerUp"
    @pointercancel="handle.onPointerCancel"
    @click="onClick"
  >
    <span class="handle__inner">
      <svg class="handle__icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7" />
        <path
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.7"
          d="M19.2 14.6a1.5 1.5 0 0 0 .3 1.65l.05.06a1.8 1.8 0 1 1-2.55 2.55l-.05-.06a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.9 1.37V20a1.8 1.8 0 1 1-3.6 0v-.1a1.5 1.5 0 0 0-.98-1.37 1.5 1.5 0 0 0-1.65.3l-.06.06A1.8 1.8 0 1 1 4.5 16.3l.06-.05a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.37-.9H3.3a1.8 1.8 0 0 1 0-3.6h.1a1.5 1.5 0 0 0 1.37-.98 1.5 1.5 0 0 0-.3-1.65L4.5 7.4A1.8 1.8 0 1 1 7.05 4.85l.06.06a1.5 1.5 0 0 0 1.65.3h.07a1.5 1.5 0 0 0 .9-1.37V3.7a1.8 1.8 0 0 1 3.6 0v.1a1.5 1.5 0 0 0 .9 1.37 1.5 1.5 0 0 0 1.65-.3l.06-.06a1.8 1.8 0 1 1 2.55 2.55l-.06.05a1.5 1.5 0 0 0-.3 1.65v.07a1.5 1.5 0 0 0 1.37.9h.2a1.8 1.8 0 0 1 0 3.6h-.1a1.5 1.5 0 0 0-1.37.9"
        />
      </svg>
      <span class="handle__label">设置</span>
    </span>
  </button>
</template>

<style scoped>
.handle {
  /*
   * --depth：垂直边缘方向的伸出量；--length：沿边缘方向的长度。
   * 收起态两者相等，半圆半径被 border-radius 钳到边长一半，
   * 圆心正好落在图标中心，图标四向留白因此都是 (28 - 18) / 2 = 5px。
   */
  --depth: 28px;
  --length: 28px;
  --icon: 18px;
  --depth-open: 66px;

  position: fixed;
  z-index: var(--z-handle);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--line);
  background: var(--bg-handle);
  backdrop-filter: var(--glass-handle);
  box-shadow: var(--shadow-md);
  color: var(--color-text-dim);
  touch-action: none;
  transition:
    width var(--dur-base) var(--ease),
    color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

@supports not (backdrop-filter: blur(1px)) {
  .handle {
    background: var(--surface-3);
  }
}

/* 被浮层盖住时：模糊反正看不见，摘掉它省一级串行合成 */
.handle.is-flat {
  backdrop-filter: none;
}

.handle:hover,
.handle:focus-visible,
.handle.is-dragging {
  background: var(--surface-2);
  color: var(--color-text);
}

.handle:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/* 拖拽中保持展开态；左右两侧展开尺寸一致，切边不会引起宽高突变 */
.handle.is-dragging {
  cursor: grabbing;
}

/* ── 左右边缘：半圆朝内，展开时向内伸长 ─────────────── */

.handle--left,
.handle--right {
  width: var(--depth);
  height: var(--length);
}

.handle--left:hover,
.handle--left:focus-visible,
.handle--left.is-dragging,
.handle--right:hover,
.handle--right:focus-visible,
.handle--right.is-dragging {
  width: var(--depth-open);
}

.handle--left {
  border-left: none;
  border-radius: 0 var(--r-full) var(--r-full) 0;
}

.handle--right {
  border-right: none;
  border-radius: var(--r-full) 0 0 var(--r-full);
}

/* ── 内容 ─────────────────────────────────────────── */

.handle__inner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
}

.handle__icon {
  width: var(--icon);
  height: var(--icon);
  flex: none;
}

.handle__label {
  max-width: 0;
  overflow: hidden;
  font-size: var(--fs-base);
  line-height: 1;
  white-space: nowrap;
  opacity: 0;
  transition:
    max-width var(--dur-base) var(--ease),
    opacity var(--dur-fast) var(--ease);
}

.handle:hover .handle__label,
.handle:focus-visible .handle__label,
.handle.is-dragging .handle__label {
  max-width: 40px;
  opacity: 1;
}
</style>

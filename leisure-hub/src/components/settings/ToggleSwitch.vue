<script setup lang="ts">
/**
 * 开关。
 *
 * 用原生 button + aria-checked 而不是 checkbox：面板里所有控件都是自绘的深色玻璃风，
 * 原生 checkbox 在这个底上没法只靠 CSS 统一外观，而 switch 角色对读屏器语义更准。
 */
defineProps<{
  id: string
  label: string
  modelValue: boolean
  /** 标签下方的补充说明，读屏器通过 aria-describedby 读到 */
  hint?: string
  /**
   * 禁用。
   *
   * 用于「这一项依赖另一项，而那一项现在是关的」——此时开关既不该可点，
   * 也不该被隐藏（隐藏会让用户以为功能被删了）。
   */
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <div class="toggle" :class="{ 'is-disabled': disabled }">
    <div class="toggle__text">
      <label class="toggle__label" :for="id">{{ label }}</label>
      <span v-if="hint" :id="`${id}-hint`" class="toggle__hint">{{ hint }}</span>
    </div>

    <button
      :id="id"
      class="toggle__track"
      :class="{ 'is-on': modelValue }"
      type="button"
      role="switch"
      :disabled="disabled"
      :aria-checked="modelValue"
      :aria-describedby="hint ? `${id}-hint` : undefined"
      @click="emit('update:modelValue', !modelValue)"
    >
      <span class="toggle__thumb" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
}

.toggle__text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

/* label 指向 button：点文字也能切换，命中区域不止于 40px 的轨道 */
.toggle__label {
  color: var(--color-text);
  font-size: var(--fs-base);
  cursor: pointer;
}

.toggle__hint {
  color: var(--color-text-faint);
  font-size: var(--fs-xs);
  line-height: 1.45;
}

.toggle__track {
  position: relative;
  width: 40px;
  height: 23px;
  flex: none;
  border: 1px solid var(--line);
  border-radius: var(--r-full);
  background: var(--fill);
  transition:
    background-color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}

/*
 * 开启态用 --accent 而非灰阶：这是二元状态，若开关只差明度，
 * 在小屏和弱视条件下几乎读不出当前是开还是关。
 */
.toggle__track.is-on {
  border-color: transparent;
  background: var(--accent);
}

/* 视觉 23px、命中区域补到 44px，满足触控最小尺寸 */
.toggle__track::after {
  position: absolute;
  content: '';
  inset: -11px -2px;
}

.toggle__track:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/* 只动 transform：left/width 会逐帧触发布局 */
.toggle__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: var(--color-text);
  box-shadow: var(--shadow-sm);
  transition: transform var(--dur-fast) var(--ease);
}

/* 40 - 17 - 2(左内边距) - 2(右内边距) - 2(左右边框) = 17 */
.toggle__track.is-on .toggle__thumb {
  transform: translateX(17px);
}

/*
 * 禁用态。
 *
 * 文字沿用 .btn:disabled 那套 --color-text-disabled，轨道整体压暗而不是换色：
 * 换色会引入第四种开关外观，而「不可点」这件事靠明度 + cursor 已经够了。
 */
.toggle.is-disabled .toggle__label,
.toggle.is-disabled .toggle__hint {
  color: var(--color-text-disabled);
  cursor: default;
}

.toggle__track:disabled {
  cursor: default;
  opacity: 0.45;
}
</style>

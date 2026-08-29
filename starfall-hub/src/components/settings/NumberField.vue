<script setup lang="ts">
import { ref, watch } from 'vue'

/**
 * 带步进按钮的数值输入。
 *
 * 不用原生 type="number" 的 spinner：各浏览器样式不一，且在深色玻璃底上
 * 箭头几乎看不见。这里自己画按钮，输入框仍是 number 以保留数字键盘与方向键。
 */
const props = defineProps<{
  id: string
  label: string
  modelValue: number
  min: number
  max: number
  step?: number
  /** 后缀单位，如 px / 列 */
  unit?: string
  /** 值为 0（自动）时输入框显示的占位文案 */
  autoPlaceholder?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

/*
 * 本地草稿。
 *
 * 直接双向绑到 store 会让「删空重输」变得不可能——清空的瞬间值变成 0/NaN，
 * store 夹一次再回写，光标位置和已输入的数字都会被打断。
 * 这里编辑期间只动草稿，失焦或回车才提交。
 *
 * 用 :value + @input 而不是 v-model：v-model 在 type="number" 上会把值
 * 强转成 number，草稿的字符串语义（空串 = 自动）就没了，trim 也会直接报错。
 */
const draft = ref(props.modelValue > 0 ? String(props.modelValue) : '')

watch(
  () => props.modelValue,
  (value) => {
    draft.value = value > 0 ? String(value) : ''
  },
)

function onInput(event: Event) {
  draft.value = (event.target as HTMLInputElement).value
}

function commit() {
  const trimmed = draft.value.trim()
  // 空串等价于「跟随画面」，用 0 表达
  if (!trimmed) {
    emit('update:modelValue', 0)
    return
  }

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) {
    draft.value = props.modelValue > 0 ? String(props.modelValue) : ''
    return
  }

  const clamped = Math.min(props.max, Math.max(props.min, Math.round(parsed)))
  draft.value = String(clamped)
  emit('update:modelValue', clamped)
}

/** 步进：当前为自动时从 min 起步，否则在现值上加减 */
function bump(delta: number) {
  const base = props.modelValue > 0 ? props.modelValue : props.min
  const next = Math.min(props.max, Math.max(props.min, base + delta * (props.step ?? 1)))
  draft.value = String(next)
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="num">
    <label class="num__label" :for="id">{{ label }}</label>

    <div class="num__box">
      <button
        class="num__step"
        type="button"
        :aria-label="`减少${label}`"
        :disabled="modelValue > 0 && modelValue <= min"
        @click="bump(-1)"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M6 12h12" />
        </svg>
      </button>

      <input
        :id="id"
        class="num__input"
        type="number"
        inputmode="numeric"
        :min="min"
        :max="max"
        :step="step ?? 1"
        :value="draft"
        :placeholder="autoPlaceholder ?? '自动'"
        @input="onInput"
        @change="commit"
        @blur="commit"
        @keydown.enter.prevent="commit"
      />

      <span v-if="unit" class="num__unit">{{ unit }}</span>

      <button
        class="num__step"
        type="button"
        :aria-label="`增加${label}`"
        :disabled="modelValue >= max"
        @click="bump(1)"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            stroke="currentColor"
            stroke-linecap="round"
            stroke-width="2"
            d="M12 6v12M6 12h12"
          />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.num {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: var(--sp-1);
}

.num__label {
  color: var(--color-text-dim);
  font-size: var(--fs-sm);
}

.num__box {
  display: flex;
  align-items: center;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--fill);
  transition: border-color var(--dur-fast) var(--ease);
}

.num__box:focus-within {
  border-color: var(--focus);
}

.num__input {
  width: 100%;
  min-width: 0;
  padding: var(--sp-2) 2px;
  border: none;
  background: none;
  font-size: var(--fs-base);
  font-variant-numeric: tabular-nums;
  text-align: center;
  outline: none;
}

/* 原生 spinner 与自绘按钮重复，两套一起显示会挤掉输入宽度 */
.num__input::-webkit-outer-spin-button,
.num__input::-webkit-inner-spin-button {
  margin: 0;
  appearance: none;
}

.num__input {
  appearance: textfield;
}

.num__input::placeholder {
  color: var(--color-text-faint);
}

.num__unit {
  flex: none;
  padding-right: 2px;
  color: var(--color-text-faint);
  font-size: var(--fs-xs);
}

.num__step {
  display: grid;
  width: 28px;
  height: 34px;
  flex: none;
  color: var(--color-text-dim);
  place-items: center;
  transition:
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.num__step svg {
  width: 14px;
  height: 14px;
}

.num__step:hover:not(:disabled) {
  background: var(--fill-raised);
  color: var(--color-text);
}

.num__step:disabled {
  color: var(--color-text-disabled);
  cursor: default;
}

.num__step:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}
</style>

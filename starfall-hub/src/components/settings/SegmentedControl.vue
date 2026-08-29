<script setup lang="ts" generic="T extends string">
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: T
  options: { value: T; label: string }[]
  /** 无障碍名称，等价于 tablist 的 aria-label */
  label: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: T] }>()

const itemRefs = ref<HTMLElement[]>([])

const activeIndex = computed(() => {
  const found = props.options.findIndex((option) => option.value === props.modelValue)
  return found < 0 ? 0 : found
})

/**
 * 滑块位置。
 *
 * 宽度按选项数等分（扣掉容器两侧内边距），translateX 的百分比相对自身宽度，
 * 所以「第 n 格」正好是 n * 100%，容器缩放时无需实测重算。
 */
const thumbStyle = computed(() => {
  const count = props.options.length || 1
  return {
    width: `calc((100% - var(--seg-inset) * 2) / ${count})`,
    transform: `translateX(${activeIndex.value * 100}%)`,
  }
})

function select(value: T) {
  if (value !== props.modelValue) emit('update:modelValue', value)
}

/** 方向键切换，与 role="tablist" 的键盘约定一致 */
function onKeydown(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()

  const last = props.options.length - 1
  if (last < 0) return

  let next: number
  if (event.key === 'ArrowRight') next = activeIndex.value === last ? 0 : activeIndex.value + 1
  else if (event.key === 'ArrowLeft') next = activeIndex.value === 0 ? last : activeIndex.value - 1
  else if (event.key === 'Home') next = 0
  else next = last

  select(props.options[next].value)
  itemRefs.value[next]?.focus()
}

// 选中项 tabindex 为 0、其余 -1；外部改值后把焦点跟过去，否则焦点会停在退出 Tab 序列的按钮上
watch(
  activeIndex,
  (index) => {
    if (!itemRefs.value.includes(document.activeElement as HTMLElement)) return
    itemRefs.value[index]?.focus()
  },
  { flush: 'post' },
)
</script>

<template>
  <div class="seg" role="tablist" :aria-label="label" @keydown="onKeydown">
    <span class="seg__thumb" :style="thumbStyle" aria-hidden="true" />

    <button
      v-for="(option, i) in options"
      :key="option.value"
      :ref="(el) => { if (el) itemRefs[i] = el as HTMLElement }"
      class="seg__item"
      :class="{ 'is-active': option.value === modelValue }"
      type="button"
      role="tab"
      :aria-selected="option.value === modelValue"
      :tabindex="i === activeIndex ? 0 : -1"
      @click="select(option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.seg {
  --seg-inset: 3px;

  position: relative;
  display: flex;
  padding: var(--seg-inset);
  border: 1px solid var(--line-subtle);
  border-radius: var(--r-md);
  background: var(--fill);
}

/* 滑块垫在按钮下层（靠 z-index 分层，按钮自身不加底色），切换时才有连续位移感 */
.seg__thumb {
  position: absolute;
  z-index: 0;
  top: var(--seg-inset);
  bottom: var(--seg-inset);
  left: var(--seg-inset);
  border-radius: var(--r-sm);
  background: var(--fill-raised);
  box-shadow: var(--shadow-sm);
  transition: transform var(--dur-base) var(--ease);
}

.seg__item {
  position: relative;
  z-index: 1;
  flex: 1;
  padding: 7px var(--sp-1);
  border-radius: var(--r-sm);
  color: var(--color-text-dim);
  font-size: var(--fs-base);
  line-height: 1.2;
  white-space: nowrap;
  transition: color var(--dur-fast) var(--ease);
}

.seg__item:hover {
  color: var(--color-text);
}

.seg__item.is-active {
  color: var(--color-text);
  font-weight: 500;
}

.seg__item:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
</style>

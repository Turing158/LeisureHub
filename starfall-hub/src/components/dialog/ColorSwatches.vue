<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { TILE_BG_PRESETS, TILE_TEXT_PRESETS } from '@/data/tilePresets'
import { isHexColor } from '@/utils/color'

const props = defineProps<{
  /** 空字符串代表「默认」档，即不写颜色、沿用主题令牌 */
  modelValue: string
  /** 无障碍名称 */
  label: string
  /**
   * surface 是贴在深色背景上的块面色，text 是压在块面上的文字色。
   * 两者的明度约束相反，共用一套色板必然有一边不可读。
   */
  palette?: 'surface' | 'text'
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const presets = computed(() =>
  props.palette === 'text' ? TILE_TEXT_PRESETS : TILE_BG_PRESETS,
)

/** 当前值不在预设里即为自定义；空字符串是「默认」档，不算 */
const isCustom = computed(
  () =>
    props.modelValue !== '' &&
    !presets.value.some((preset) => preset.value === props.modelValue),
)

/**
 * 把 #abc 展开成 #aabbcc。
 *
 * `<input type="color">` 的 value 只认 6 位十六进制，喂 3 位它会静默回落到
 * #000000——取色器里显示的颜色于是和方格上的不是同一个。
 * isHexColor 放行 3 位写法，所以这一步不能省。
 */
function expand(value: string): string {
  const hex = value.slice(1)
  if (hex.length !== 3) return value.toLowerCase()
  return `#${[...hex].map((ch) => ch + ch).join('')}`.toLowerCase()
}

/**
 * 取色器的当前值。
 *
 * 独立于 modelValue 存一份，因为「默认」档没有颜色，而取色器必须有个具体值。
 * 缺省时给一个中性灰而不是纯黑：点开取色器就落在色轮中段，
 * 比从纯黑起步更容易调到想要的颜色。
 */
const pickerValue = ref(isHexColor(props.modelValue) ? expand(props.modelValue) : '#808080')

// 外部改值（选了预设、或换到「默认」）时同步取色器，下次点开从当前颜色续上
watch(
  () => props.modelValue,
  (value) => {
    if (isHexColor(value)) pickerValue.value = expand(value)
  },
)

/**
 * 取色器逐帧上报。
 *
 * 直接透传而不做节流：这一层只 emit，真正的开销取决于消费方——
 * 组件编辑器里是本地 ref 驱动预览（廉价），
 * 背景设置那种会写 localStorage 的消费方自己在 change 上落库。
 */
function onPick(event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (!isHexColor(value)) return
  pickerValue.value = value.toLowerCase()
  emit('update:modelValue', pickerValue.value)
}
</script>

<template>
  <!--
    取色器放在 radiogroup 之外：它不是第 n 个「选项」，而是另一种输入方式。
    塞进 role 容器会让读屏把它念成一个单选项，而它并不代表某个固定颜色。
  -->
  <div class="picker">
    <div class="swatches" role="radiogroup" :aria-label="label">
      <!-- 「默认」不是一个颜色，而是取消设置，回到主题令牌 -->
      <button
        class="swatch swatch--none"
        :class="{ 'is-active': modelValue === '' }"
        type="button"
        role="radio"
        :aria-checked="modelValue === ''"
        title="默认"
        @click="emit('update:modelValue', '')"
      >
        默认
      </button>

      <button
        v-for="preset in presets"
        :key="preset.value"
        class="swatch"
        :class="{ 'is-active': modelValue === preset.value }"
        type="button"
        role="radio"
        :aria-checked="modelValue === preset.value"
        :title="preset.label"
        :style="{ backgroundColor: preset.value }"
        @click="emit('update:modelValue', preset.value)"
      >
        <span class="sr-only">{{ preset.label }}</span>
      </button>
    </div>

    <!--
      原生 <input type="color">：系统取色器带屏幕吸管、HSL 面板与最近使用，
      自研一个既做不到这些，又要在每个平台上重新对齐手感。
      色块本体是被 label 包住的 input，点哪都能唤起。
    -->
    <label class="custom" :class="{ 'is-active': isCustom }">
      <span class="custom__chip" :style="{ backgroundColor: pickerValue }" aria-hidden="true" />
      <span class="custom__text">
        自定义
        <span class="custom__hex">{{ isCustom ? modelValue : '' }}</span>
      </span>
      <input
        class="custom__input"
        type="color"
        :value="pickerValue"
        :aria-label="`${label}：自定义颜色`"
        @input="onPick"
      />
    </label>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 「默认」档比色块宽，用 auto-fill 而非等分列，避免它把整行挤变形 */
.swatches {
  display: grid;
  gap: var(--sp-2);
  grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
}

.swatch {
  position: relative;
  height: 32px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  transition:
    transform var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}

.swatch--none {
  color: var(--color-text-dim);
  background: var(--tile-bg);
  font-size: var(--fs-sm);
}

.swatch:hover {
  border-color: var(--color-text-faint);
  transform: translateY(-1px);
}

/* 选中态用外圈描边而不是内部勾号：色块本身很小，勾号在深色上不易辨识 */
.swatch.is-active {
  border-color: transparent;
  box-shadow:
    0 0 0 2px var(--accent),
    var(--shadow-sm);
}

.swatch:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/* ── 自定义取色 ───────────────────────────────────── */

/*
 * 整行是一个 label，点任意位置都唤起系统取色器。
 * 不做成与色块同宽的第 n 格：它是另一种输入方式，
 * 混进色板会让人以为「自定义」也是一个固定颜色。
 */
.custom {
  position: relative;
  display: flex;
  align-items: center;
  padding: 5px var(--sp-2) 5px var(--sp-1);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--fill);
  gap: var(--sp-2);
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.custom:hover {
  border-color: var(--color-text-faint);
  background: var(--fill-raised);
}

/* 与色块一致的选中态：当前值不在预设里时点亮 */
.custom.is-active {
  border-color: transparent;
  box-shadow: 0 0 0 2px var(--accent);
}

.custom__chip {
  width: 34px;
  height: 22px;
  flex: none;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
}

.custom__text {
  display: flex;
  flex: 1;
  align-items: baseline;
  justify-content: space-between;
  color: var(--color-text-dim);
  font-size: var(--fs-sm);
  gap: var(--sp-2);
}

/* 等宽 + 大写：六位十六进制在数值间切换时不会左右跳动 */
.custom__hex {
  color: var(--color-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--fs-xs);
  text-transform: uppercase;
}

/*
 * 原生取色器铺满整行但完全透明：既保住「点哪都能开」，
 * 也保住键盘可达与系统取色器的位置锚点（弹窗从这个元素的位置展开）。
 * 不用 display: none —— 那会让它退出 Tab 序列，键盘用户再也开不了取色器。
 */
.custom__input {
  position: absolute;
  width: 100%;
  height: 100%;
  padding: 0;
  border: none;
  opacity: 0;
  inset: 0;
  cursor: pointer;
}

/* 焦点环画在包裹层上：input 自身透明，描边落在它上面看不见 */
.custom:focus-within {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.sr-only {
  position: absolute;
  overflow: hidden;
  width: 1px;
  height: 1px;
  border: 0;
  margin: -1px;
  padding: 0;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>

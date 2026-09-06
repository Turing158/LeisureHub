<script setup lang="ts">
import { computed, ref } from 'vue'

import ColorPicker from './ColorPicker.vue'
import OverlayLayer from '../OverlayLayer.vue'
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

/* ── 自研取色面板的开关与锚点 ─────────────────────────── */

const pickerOpen = ref(false)
/** 每次打开时把锚点钉当前「自定义」行实测矩形上，面板贴它展开 */
const anchor = ref<{ left: number; top: number; bottom: number; width: number } | null>(null)

/** 取色面板的起始颜色：有值用它，缺省给一个中性灰（点开落在色轮中段好调） */
const seed = computed(() => (isHexColor(props.modelValue) ? props.modelValue : '#808080'))

const customBtn = ref<HTMLElement | null>(null)

function togglePicker() {
  if (pickerOpen.value) {
    pickerOpen.value = false
    // 收面板时不归还焦点：本行仍是触发点，视觉上闭合了就是一行的显影切换
    return
  }
  const rect = customBtn.value?.getBoundingClientRect()
  if (!rect) return
  anchor.value = { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width }
  pickerOpen.value = true
}

function onPickerClose() {
  pickerOpen.value = false
}
</script>

<template>
  <!--
    取色面板不在 radiogroup 内：它不是第 n 个「选项」，而是另一种输入方式。
    塞进 radiogroup 会让读屏把它念成一个单选项，而它并不代表某个固定颜色。
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
      自定义行是一个按钮：点它开取色面板。不再用原生 <input type="color">
      ——它无法表达透明度，自研面板（ColorPicker）负责色相/饱和度/明度/透明度，
      产出 #RRGGBBAA。与预设色块同位的是「自定义」这个动作，不是某一个固定颜色。
    -->
    <button
      ref="customBtn"
      class="custom"
      :class="{ 'is-active': isCustom }"
      type="button"
      :aria-expanded="pickerOpen"
      aria-haspopup="dialog"
      @click="togglePicker"
    >
      <span class="custom__chip" aria-hidden="true">
        <span class="custom__chip-fill" :style="{ backgroundColor: isHexColor(modelValue) ? modelValue : '' }" />
      </span>
      <span class="custom__text">
        自定义
        <span class="custom__hex">{{ isCustom ? modelValue : '' }}</span>
      </span>
    </button>

    <!--
      取色面板 Teleport 到 body 并自析关闭（点外 / Esc / Tab）。
      这里只负责把起点颜色、锚点矩形传进去，并把拖出/输入的结果转发给消费方。
    -->
    <OverlayLayer v-if="pickerOpen && anchor" name="cp">
      <ColorPicker
        :model-value="seed"
        :anchor="anchor"
        :label="label"
        @update:model-value="emit('update:modelValue', $event)"
        @close="onPickerClose"
      />
    </OverlayLayer>
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
 * 自定义行是一个动作按钮：色板之外的另一条输入口。
 * 半透明色要看得出来，chip 底铺一层中性棋盘格，颜色叠在上面。
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
  text-align: left;
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

.custom:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.custom__chip {
  display: block;
  width: 34px;
  height: 22px;
  flex: none;
  overflow: hidden;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background-image:
    linear-gradient(45deg, rgb(0 0 0 / 0.2) 25%, transparent 25%),
    linear-gradient(-45deg, rgb(0 0 0 / 0.2) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgb(0 0 0 / 0.2) 75%),
    linear-gradient(-45deg, transparent 75%, rgb(0 0 0 / 0.2) 75%);
  background-position:
    0 0,
    0 4.5px,
    4.5px -4.5px,
    -4.5px 0;
  background-size: 9px 9px;
}

.custom__chip-fill {
  display: block;
  width: 100%;
  height: 100%;
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

/* 等宽 + 大写：多位十六进制在数值间切换时不会左右跳动 */
.custom__hex {
  color: var(--color-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--fs-xs);
  text-transform: uppercase;
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
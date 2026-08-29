<script setup lang="ts">
import { computed, ref } from 'vue'

import ColorSwatches from './ColorSwatches.vue'
import TilePreview from './TilePreview.vue'
import SegmentedControl from '../settings/SegmentedControl.vue'
import TileIcon from '../TileIcon.vue'
import { SPAN_MAX, tileSpan, type LinkTile, type TileDraft } from '@/types/tile'

const props = defineProps<{
  /** 编辑模式下的初始值；缺省为新建 */
  initial?: LinkTile
}>()

const emit = defineEmits<{
  submit: [draft: TileDraft]
}>()

/** 名称会在方格下被单行截断，这里给出软上限提示 */
const NAME_MAX = 20

/** SegmentedControl 的泛型约束是 string，所以档位用字符串，提交时再转数字 */
const SPAN_OPTIONS = Array.from({ length: SPAN_MAX }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}))

const initialSpan = props.initial ? tileSpan(props.initial) : { w: 1, h: 1 }

const name = ref(props.initial?.name ?? '')
const url = ref(props.initial?.url ?? '')
const icon = ref(props.initial?.icon ?? '')
const spanW = ref(String(initialSpan.w))
const spanH = ref(String(initialSpan.h))
/** 空字符串代表「默认」档，即沿用方格自身的半透明玻璃底 */
const bgColor = ref(props.initial?.bgColor ?? '')
const errors = ref<{ name?: string; url?: string }>({})

const isEdit = computed(() => props.initial !== undefined)
const nameLeft = computed(() => NAME_MAX - [...name.value].length)

/** 名称未填时预览里给个占位，否则标签行是空的、看不出会占一行 */
const previewName = computed(() => name.value.trim() || '未命名')

/** 缺协议时补 https://，便于直接粘贴 example.com */
function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function validate(candidate: string): boolean {
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function onSubmit() {
  const next: typeof errors.value = {}

  if (!name.value.trim()) next.name = '请填写名称'

  const normalized = normalizeUrl(url.value)
  if (!normalized) next.url = '请填写网址'
  else if (!validate(normalized)) next.url = '网址格式不正确'

  errors.value = next
  if (Object.keys(next).length > 0) return

  // updateTile 是整体替换，任何漏进 draft 的字段都会在编辑时被抹掉
  emit('submit', {
    kind: 'link',
    name: name.value.trim(),
    url: normalized,
    icon: icon.value.trim() || undefined,
    bgColor: bgColor.value || undefined,
    spanW: Number(spanW.value),
    spanH: Number(spanH.value),
  })
}
</script>

<template>
  <form class="form" novalidate @submit.prevent="onSubmit">
    <!--
      预览放在最上：图标、名称、尺寸、底色四项都影响外观，改完得能立刻看到效果，
      否则只能靠保存 → 看方格 → 再进来改这样来回试。

      TilePreview 负责等比缩放：舞台尺寸固定，方格按占格比例缩到贴边为止，
      1×1 也能占满舞台，而不是在 4×4 大小的框里缩成一个小角。
    -->
    <div class="preview">
      <TilePreview :span-w="Number(spanW)" :span-h="Number(spanH)" :label="previewName">
        <TileIcon
          :name="previewName"
          :icon="icon.trim() || undefined"
          :bg-color="bgColor || undefined"
        />
      </TilePreview>
      <span class="preview__hint">方格在桌面上的样子</span>
    </div>

    <!-- 图标与名称并排，等宽两列，省纵向空间 -->
    <div class="form__row">
      <label class="field">
        <span class="field__label">图标</span>
        <input
          v-model="icon"
          class="field__input"
          type="text"
          placeholder="🔗"
          title="可留空，填图片链接或 emoji"
        />
      </label>

      <label class="field">
        <span class="field__label">
          名称
          <span class="field__hint" :class="{ 'is-over': nameLeft < 0 }">
            建议 {{ NAME_MAX }} 字内，过长会被截断
          </span>
        </span>
        <input v-model="name" class="field__input" type="text" placeholder="例如：示例站点" />
        <span v-if="errors.name" class="field__error">{{ errors.name }}</span>
      </label>
    </div>

    <label class="field">
      <span class="field__label">网址</span>
      <input v-model="url" class="field__input" type="text" placeholder="example.com" />
      <span v-if="errors.url" class="field__error">{{ errors.url }}</span>
    </label>

    <div class="field">
      <span class="field__label">
        尺寸
        <span class="field__hint">占用的格数，放不下时会挤走相邻方块</span>
      </span>
      <div class="span-row">
        <span class="span-row__key">宽</span>
        <SegmentedControl v-model="spanW" :options="SPAN_OPTIONS" label="占格宽度" />
      </div>
      <div class="span-row">
        <span class="span-row__key">高</span>
        <SegmentedControl v-model="spanH" :options="SPAN_OPTIONS" label="占格高度" />
      </div>
    </div>

    <div class="field">
      <span class="field__label">底色</span>
      <ColorSwatches v-model="bgColor" label="方格底色" />
    </div>

    <button class="submit" type="submit">{{ isEdit ? '保存修改' : '添加到方格' }}</button>
  </form>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* ── 预览 ─────────────────────────────────────────── */

.preview {
  display: flex;
  align-items: center;
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--fill);
  gap: var(--sp-3);
}

.preview__hint {
  color: var(--color-text-dim);
  font-size: var(--fs-sm);
}

/* ── 表单 ─────────────────────────────────────────── */

/* 两列等宽：图标与名称的输入框长度一致，视觉上成对 */
.form__row {
  display: grid;
  gap: var(--sp-3);
  grid-template-columns: 1fr 1fr;
}

.field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--sp-1);
}

.field__label {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  font-size: var(--fs-base);
}

/* 两列等宽后名称的提示语容易换行；换行会顶得两侧输入框错位，所以宁可截断提示 */
.field__hint {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-dim);
  font-size: var(--fs-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field__hint.is-over {
  color: var(--danger);
}

.field__input {
  min-width: 0;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--fill);
  font-size: var(--fs-base);
  transition: border-color var(--dur-fast) var(--ease);
}

.field__input:focus {
  border-color: var(--focus);
  outline: none;
}

.field__error {
  color: var(--danger);
  font-size: var(--fs-sm);
}

/* ── 尺寸 ─────────────────────────────────────────── */

.span-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.span-row__key {
  flex: 0 0 auto;
  color: var(--color-text-dim);
  font-size: var(--fs-base);
}

.span-row :deep(.seg) {
  flex: 1;
}

/* 与 TabWidgetEdit 的提交按钮同构：文字压在色块上，必须用 --accent-solid */
.submit {
  margin-top: var(--sp-1);
  padding: 11px var(--sp-4);
  border-radius: var(--r-md);
  background: var(--accent-solid);
  font-size: var(--fs-base);
  font-weight: 500;
  transition: filter var(--dur-fast) var(--ease);
}

.submit:hover {
  filter: brightness(1.1);
}
</style>

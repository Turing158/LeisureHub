<script setup lang="ts">
import { computed } from 'vue'

import { getWidget } from '@/data/widgets'

const props = defineProps<{
  /** WidgetTile.widgetId */
  widgetId: string
  /** 注册表里查不到时的兜底显示名 */
  name: string
  /** WidgetTile.props，已由 store 校验过；直接展开给具体组件 */
  widgetProps?: Record<string, unknown>
  /**
   * 占格宽 / 高。
   *
   * 走独立的 prop 而不塞进 widgetProps：后者是颜色白名单（见 types/widgetProps.ts），
   * 而占格是 TileBase 的一等字段，两者的校验规则与生命周期都不同。
   *
   * 组件据此决定版式（如日历的七档），像素仍由 CSS 变量算，这里只传整数。
   */
  spanW?: number
  spanH?: number
  /** 预览模式（Dialog 的实时预览与卡片列表）：组件据此关掉外部副作用 */
  preview?: boolean
}>()

const emit = defineEmits<{
  /**
   * 组件自己改了配置。
   *
   * 目前只有搜索方块的换引擎会用到。这一层只做转发，不认识具体的键——
   * 校验在 store 那一侧由 sanitizeWidgetProps 统一做。
   */
  'update-props': [patch: Record<string, unknown>]
}>()

/**
 * 注册表里查不到就退化为首字母占位。
 *
 * 已放置的方块存的是 widgetId 字符串，删掉某个组件或用户改过 localStorage
 * 都会留下悬空 id；此时渲染一块空白方格无从判断出了什么问题，
 * 而抛错会连带整个网格白屏。
 */
const def = computed(() => getWidget(props.widgetId))
const fallbackChar = computed(() => [...props.name.trim()][0] ?? '·')

/**
 * 传给具体组件的全部绑定。
 *
 * 占格没传时不写进对象，而不是写成 undefined：`<component :is>` 上的 undefined
 * 会落成 DOM 属性（spanw=""），对不声明这两个 prop 的组件是多余的脏属性。
 */
const bindings = computed(() => ({
  ...props.widgetProps,
  ...(props.spanW === undefined ? {} : { spanW: props.spanW }),
  ...(props.spanH === undefined ? {} : { spanH: props.spanH }),
  ...(props.preview ? { preview: true } : {}),
}))
</script>

<template>
  <!--
    update-engine 只有搜索组件会发；用 @… 监听一个别的组件不声明的事件是安全的，
    Vue 只是把它当普通的 attrs 落在根元素上而已（这些组件的根都是元素而非 Fragment）。
  -->
  <component
    :is="def.component"
    v-if="def"
    v-bind="bindings"
    @update-engine="emit('update-props', { engineId: $event })"
  />
  <span v-else class="fallback" :title="`未知组件：${widgetId}`">{{ fallbackChar }}</span>
</template>

<style scoped>
/* 与 TileIcon 的文字兜底同一套尺寸换算，视觉上和普通方格一致 */
.fallback {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  color: var(--color-text-dim);
  font-size: calc(var(--content-size, var(--tile-size)) * 0.42);
  line-height: 1;
  user-select: none;
}
</style>

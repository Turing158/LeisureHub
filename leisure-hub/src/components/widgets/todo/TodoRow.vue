<script setup lang="ts">
import type { TodoItem } from '@/types/todo'

/**
 * 一条待办：复选框 + 正文 + 删除钮。
 *
 * 行高由外层写死 30px（--td-row），不按 --square-h 算——同一个占格形状有两个高度
 * （起名 196 / 没起名 222，差 26px），按高算的系数会在两档上差 13%。那 26px 的
 * 差额交给「露出几行」去吸收（列表 overflow-y: auto 天然吸收它），
 * 而不是让每一行都跟着变高。这是待办作为同质列表相对日历的优势。
 */
const props = defineProps<{
  item: TodoItem
  /** grouped 档里已完成项也会渲染（在折叠区内），此时正文降为次要并加删除线 */
  showGroup?: boolean
}>()

const emit = defineEmits<{
  toggle: [id: string]
  remove: [id: string]
}>()
</script>

<template>
  <div class="row" :class="{ 'row--done': props.item.done }">
    <!--
      用原生 input[type=checkbox] 而不是自绘的 button[role=checkbox]：
      Space 勾选、读屏播报「复选框 已选中」、以及 TileCell.onPointerDown 里那条
      `closest('input, textarea')` 的整体放行，三件事全部免费。自绘要各写一遍。

      appearance: none 只摘掉外观，语义与键盘行为都留着。
    -->
    <input
      class="row__box"
      type="checkbox"
      data-todo-focus
      :checked="props.item.done"
      :aria-label="props.item.text"
      @change="emit('toggle', props.item.id)"
    />

    <!--
      正文用 label 包着 input：点文字也能勾。title 给完整内容——
      正文最长 120 字，两格宽里一行只放得下十几个，ellipsis 之后要有地方看全。
    -->
    <span class="row__body" :title="props.item.text">
      <span v-if="props.showGroup && props.item.group" class="row__tag">{{
        props.item.group
      }}</span>
      <span class="row__text">{{ props.item.text }}</span>
    </span>

    <!--
      删除钮常显，不做 hover 才出现：照 RecentSearches 那条注释的理由，
      触屏上没有 hover 可言，而它是这一条唯一的删除入口，藏起来等于删不掉。
    -->
    <button
      class="row__drop"
      type="button"
      :aria-label="`删除：${props.item.text}`"
      @click="emit('remove', props.item.id)"
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M7 7l10 10M17 7L7 17" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  min-width: 0;
  height: var(--td-row, 30px);
  flex: none;
  align-items: center;
  padding: 0 2px;
  border-radius: var(--r-sm);
  gap: 8px;
  transition: background-color var(--dur-fast) var(--ease);
}

.row:hover {
  /* 未配色时用主题的 hover 面；配了次要背景就借它，避免与自定义底色打架 */
  background: var(--td-sub-bg, var(--fill-hover));
}

/*
 * 复选框：14px 的方框 + --accent 的勾。
 *
 * 勾的颜色**不开放配色**，留在 --accent 上。它是「状态标记」不是「展示面」，
 * 配错色就看不出勾没勾——与 SEARCH_FIELDS 注释里那句同一条纪律。
 */
.row__box {
  width: 14px;
  height: 14px;
  flex: none;
  appearance: none;
  border: 1.5px solid var(--line-strong);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

/*
 * 勾画成内联 SVG 的 background-image，不用 ::after 放一个字符：
 * input 是替换元素，它的伪元素在部分引擎里根本不生成。background 一定成立。
 *
 * 勾是深色（#111）压在 accent 底上，而不是白勾压深底：--accent-solid 在这套
 * 恒定深色主题里是亮色，深勾的对比度更稳，也不受将来主题色被染的影响。
 */
.row__box:checked {
  border-color: var(--accent-solid);
  background:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='%23111' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round' d='M3.5 8.4l3 3 6-6.4'/%3E%3C/svg%3E")
      center / 12px 12px no-repeat,
    var(--accent-solid);
}

.row__box:focus-visible {
  /* 方块 overflow: hidden，贴边的行外描会被裁掉，一律内描 */
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.row__body {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: baseline;
  gap: 5px;
}

/* 组名徽标：只在扁平清单里显示（list 档不画分组标题，组名此时不丢，跟在行里） */
.row__tag {
  max-width: 6em;
  flex: none;
  overflow: hidden;
  padding: 1px 5px;
  border-radius: var(--r-full);
  background: var(--td-sub-bg, var(--fill));
  color: var(--td-sub-text, var(--color-text-faint));
  font-size: var(--fs-xs);
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row__text {
  min-width: 0;
  overflow: hidden;
  color: var(--td-text, var(--color-text));
  font-size: var(--fs-sm);
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * 已完成：正文降为次要文字 + 删除线。
 *
 * **不加第五档颜色。** 「已完成」在视觉上就是「降为次要」，这正是 subTextColor 的
 * 含义；再加一档「已完成文字」会让表单多一项，而它在 count / latest / rail 三档里
 * 根本看不到——CALENDAR_COLOR_FIELDS 的注释否掉过这种空转项。
 * 删除线用 text-decoration 表达，不占颜色配额。
 */
.row--done .row__text {
  color: var(--td-sub-text, var(--color-text-faint));
  text-decoration: line-through;
}

.row__drop {
  display: grid;
  width: 20px;
  height: 20px;
  flex: none;
  border-radius: var(--r-sm);
  /* 图标色留在主题令牌上，同复选框的勾：配错色不该让控件消失 */
  color: var(--color-text-faint);
  opacity: 0.6;
  place-items: center;
  transition:
    opacity var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.row__drop svg {
  width: 9px;
  height: 9px;
}

.row__drop:hover {
  color: var(--danger);
  opacity: 1;
}

.row__drop:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
  opacity: 1;
}

/* 触屏：命中区从 20 提到 30，行高一起放大，否则两个 30px 的靶子会叠在一起 */
@media (pointer: coarse) {
  .row {
    height: max(var(--td-row, 30px), 34px);
  }

  .row__box {
    width: 18px;
    height: 18px;
  }

  .row__drop {
    width: 30px;
    height: 30px;
  }
}
</style>

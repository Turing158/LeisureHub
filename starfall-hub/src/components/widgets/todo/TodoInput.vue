<script setup lang="ts">
import { ref } from 'vue'

import { MAX_LENGTH, parseTodoInput } from '@/types/todo'

/**
 * 新建输入行。只在 list / grouped 两档出现（见 variant.hasInput）。
 *
 * 分组不需要任何额外控件、也不需要新的 WidgetFieldCheck kind：在这一行里打
 * `工作: 交电费` 即可，解析规则全在 parseTodoInput 里（三道门槛，见那里的注释）。
 */
const emit = defineEmits<{
  /** 提交一条。父级据返回结果决定要不要提示，所以这里只管发 */
  submit: [text: string, group: string | undefined]
  /** Esc 且输入已空：把焦点交还方块（父级 focus 到方格根节点） */
  escape: []
  /** ↑ 在输入行按下：焦点回到列表最后一行（两者是同一条纵向序列） */
  up: []
}>()

const draft = ref('')
const el = ref<HTMLInputElement | null>(null)

/**
 * Enter 提交并清空，焦点留在输入行——连续录入不用来回点。
 *
 * 解析不出内容（空串 / 纯空白）时什么都不做，也不清空：用户可能正打到一半
 * 手滑按了 Enter，把他打的字吞掉是最坏的结果。
 */
function commit() {
  const parsed = parseTodoInput(draft.value)
  if (!parsed) return
  emit('submit', parsed.text, parsed.group)
  draft.value = ''
}

/** Esc：先清内容，已经是空的再把焦点交还方块。两级而不是一级——正在打字时不该丢焦点 */
function onEscape() {
  if (draft.value) {
    draft.value = ''
    return
  }
  emit('escape')
}

defineExpose({
  focus: () => el.value?.focus(),
})
</script>

<template>
  <!--
    data-native-menu：右键出浏览器原生菜单而不是自绘的那份。
    粘贴一条待办比自绘的「编辑 / 删除」有用得多（TileGrid 的 useContextMenu
    resolver 对 closest('[data-native-menu]') 返回 null）。方块其余部分仍出自绘菜单。

    maxlength 给 MAX_LENGTH：normalizeText 入库时也会截，但在输入时就挡住，
    用户才不会打了三百字才发现只存下一百二。
  -->
  <div class="tin" data-native-menu>
    <input
      ref="el"
      v-model="draft"
      class="tin__field"
      type="text"
      enterkeyhint="done"
      :maxlength="MAX_LENGTH"
      placeholder="加一条，或「组名: 内容」"
      aria-label="新建待办"
      @keydown.enter.prevent="commit"
      @keydown.esc.prevent="onEscape"
      @keydown.up.prevent="emit('up')"
    />
    <!--
      提交键只在有内容时出现。触屏上软键盘的「完成」等价于 Enter，
      但桌面上「打完了要按什么」需要一个看得见的答案。
    -->
    <button v-if="draft" class="tin__go" type="button" aria-label="添加" @click="commit">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 5v14M5 12h14"
        />
      </svg>
    </button>
  </div>
</template>

<style scoped>
/*
 * 32px 高写死，不按 --square-h 算：§3.4 的纵向账里它是固定占用的一部分，
 * 两个高度（起名 / 没起名）的 26px 差额一律由列表的行数去吸收。
 */
.tin {
  display: flex;
  height: 32px;
  flex: none;
  align-items: center;
  padding: 0 4px 0 10px;
  border: 1px solid var(--line-subtle);
  border-radius: var(--r-full);
  /* 输入行的胶囊走次要背景，与计数条、折叠头同一档 */
  background: var(--td-sub-bg, var(--fill));
  gap: 4px;
  transition:
    border-color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.tin:focus-within {
  border-color: var(--line-strong);
}

.tin__field {
  min-width: 0;
  flex: 1;
  border: 0;
  background: none;
  color: var(--td-text, var(--color-text));
  font-size: var(--fs-sm);
  line-height: 1;
}

.tin__field:focus {
  /* 焦点环画在外层胶囊的 focus-within 上，内层再来一个会出现双环 */
  outline: none;
}

.tin__field::placeholder {
  color: var(--td-sub-text, var(--color-text-disabled));
}

.tin__go {
  display: grid;
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: var(--r-full);
  /* 提交键的图标色留在令牌上：它是控件不是展示面 */
  color: var(--color-text-dim);
  place-items: center;
  transition:
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.tin__go svg {
  width: 13px;
  height: 13px;
}

.tin__go:hover {
  background: var(--fill-hover);
  color: var(--color-text);
}

.tin__go:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

@media (pointer: coarse) {
  .tin__go {
    width: 28px;
    height: 28px;
  }
}
</style>

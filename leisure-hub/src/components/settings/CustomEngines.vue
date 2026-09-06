<script setup lang="ts">
/**
 * 自定义搜索引擎的增删表单。
 *
 * 单独成组件而不是继续堆进 SettingsDrawer：它有自己的两个草稿字段与一条错误信息，
 * 混进抽屉会让那边的状态从「几个独立的 ref」变成「一组互相牵连的 ref」。
 *
 * 自定义引擎**不开放建议端点**。让用户填任意 JSONP 地址等于给自己开一个
 * 「任意第三方 JS 执行」的入口（建议只能走 JSONP，见 utils/jsonp.ts 的注释）。
 * 只能搜、不给建议——这条边界是刻意的，不是没做完。
 */
import { computed, ref } from 'vue'

import { CUSTOM_ENGINE_MAX, useSettingsStore } from '@/stores/settings'
import { ENGINE_NAME_MAX, QUERY_TOKEN, isSafeEngineUrl } from '@/types/search'

const settings = useSettingsStore()

const nameDraft = ref('')
const urlDraft = ref('')
const error = ref('')

const full = computed(() => settings.customEngines.length >= CUSTOM_ENGINE_MAX)

function add() {
  const name = nameDraft.value.trim()
  const url = urlDraft.value.trim()

  /*
   * 逐条给出具体原因而不是一句「填写有误」。
   *
   * 「地址必须含 {q}」是这个表单里最容易犯的一个错，而它与「协议不对」
   * 的修法完全不同——合并成一句话，用户只能靠猜。
   */
  if (!name) {
    error.value = '请填写名称'
    return
  }
  if (!url.includes(QUERY_TOKEN)) {
    error.value = `地址里要有 ${QUERY_TOKEN}，它会被替换成搜索词`
    return
  }
  if (!isSafeEngineUrl(url)) {
    error.value = '只支持 http / https 开头的地址'
    return
  }
  if (!settings.addCustomEngine(name, url)) {
    error.value = full.value ? `最多 ${CUSTOM_ENGINE_MAX} 条` : '这个地址不可用'
    return
  }

  nameDraft.value = ''
  urlDraft.value = ''
  error.value = ''
}
</script>

<template>
  <div class="engines">
    <ul v-if="settings.customEngines.length > 0" class="engines__list">
      <li v-for="engine in settings.customEngines" :key="engine.id" class="engines__row">
        <span class="engines__name">{{ engine.name }}</span>
        <span class="engines__url" :title="engine.url">{{ engine.url }}</span>
        <button
          class="engines__del"
          type="button"
          :aria-label="`删除 ${engine.name}`"
          @click="settings.removeCustomEngine(engine.id)"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              stroke="currentColor"
              stroke-linecap="round"
              stroke-width="1.8"
              d="M6 6l12 12M18 6L6 18"
            />
          </svg>
        </button>
      </li>
    </ul>

    <div class="engines__form">
      <input
        v-model="nameDraft"
        class="engines__input engines__input--name"
        type="text"
        :maxlength="ENGINE_NAME_MAX"
        placeholder="名称"
        aria-label="自定义引擎名称"
        @keydown.enter.prevent="add"
      />
      <input
        v-model="urlDraft"
        class="engines__input"
        type="url"
        inputmode="url"
        :placeholder="`https://example.com/s?q=${QUERY_TOKEN}`"
        aria-label="自定义引擎地址"
        @keydown.enter.prevent="add"
      />
      <button class="engines__add" type="button" :disabled="full" @click="add">添加</button>
    </div>

    <span v-if="error" class="engines__error">{{ error }}</span>
    <span v-else class="engines__hint">
      地址里的 {{ QUERY_TOKEN }} 会替换成搜索词；自定义引擎不提供搜索建议
    </span>
  </div>
</template>

<style scoped>
.engines {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.engines__list {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  margin: 0;
  padding: 0;
  background: var(--fill);
  list-style: none;
}

.engines__row {
  display: flex;
  min-width: 0;
  align-items: center;
  padding: 6px var(--sp-1) 6px var(--sp-3);
  gap: var(--sp-2);
}

.engines__row + .engines__row {
  border-top: 1px solid var(--line-subtle);
}

.engines__name {
  flex: none;
  max-width: 40%;
  overflow: hidden;
  font-size: var(--fs-base);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 地址是次要信息，只用来确认「加的是哪一条」，截断即可 */
.engines__url {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--color-text-faint);
  font-size: var(--fs-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.engines__del {
  position: relative;
  display: grid;
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: var(--r-sm);
  color: var(--color-text-dim);
  place-items: center;
  transition:
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.engines__del svg {
  width: 13px;
  height: 13px;
}

/* 视觉 26px、命中区域补到 44px，与抽屉里其余小按钮同一手法 */
.engines__del::after {
  position: absolute;
  content: '';
  inset: -9px;
}

.engines__del:hover {
  background: var(--danger-bg);
  color: var(--danger);
}

.engines__del:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

/*
 * 名称与地址分两行：380px 宽的抽屉里，一行放三个控件会让地址框只剩百来像素，
 * 而地址是这里最长的一项。
 */
.engines__form {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--sp-2);
}

.engines__input {
  min-width: 0;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--fill);
  font-size: var(--fs-base);
  transition: border-color var(--dur-fast) var(--ease);
}

.engines__input:focus {
  border-color: var(--focus);
  outline: none;
}

/* 名称占满第一行，地址与按钮共用第二行 */
.engines__input--name {
  grid-column: 1 / -1;
}

.engines__add {
  flex: none;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--fill-raised);
  color: var(--color-text);
  font-size: var(--fs-sm);
  transition:
    background-color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}

.engines__add:hover:not(:disabled) {
  border-color: var(--line-strong);
  background: var(--fill-hover);
}

.engines__add:disabled {
  color: var(--color-text-disabled);
  cursor: default;
}

.engines__add:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.engines__hint {
  color: var(--color-text-faint);
  font-size: var(--fs-xs);
  line-height: 1.5;
}

.engines__error {
  color: var(--danger);
  font-size: var(--fs-xs);
  line-height: 1.5;
}
</style>

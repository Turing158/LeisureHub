<script setup lang="ts">
/**
 * 「最近搜索」——只在 h=2 那一档出现，填在输入行与引擎条下方。
 *
 * 为什么是搜索记录，而不是热搜榜 / 收藏夹 / 天气之类：
 * 这块地方是**搜索方块**多出来的空间，放进来的东西必须与「此刻要搜什么」直接相关，
 * 否则它就是一个碰巧长在搜索框下面的另一个组件。而记录还有两条别的都没有的性质：
 * 不发一次网络请求（热搜榜要，且等于把方块变成一个内容源），
 * 也不需要任何配置（收藏夹要，而这个方块的配置入口只有右键一条）。
 *
 * 数据来自模块级共享的 useSearchHistory：桌面上放几个搜索方块都看到同一份记录。
 *
 * 三种状态各有各的文案，都不留空白：
 *   关闭  —— 说明是在设置里关的，否则这片空白看起来像坏了
 *   空    —— 说明它将来会出现什么
 *   有内容 —— chips，点即搜，各自带一个删除
 */
const props = defineProps<{
  items: string[]
  /** settings.searchHistoryEnabled；关闭时只渲染一句说明，不渲染任何记录 */
  enabled: boolean
}>()

const emit = defineEmits<{
  /** 点一条：写回输入框并直接搜 */
  pick: [text: string]
  /** 删一条 */
  drop: [text: string]
  /** 清空全部 */
  clear: []
}>()
</script>

<template>
  <section class="recent" aria-label="最近搜索">
    <header class="recent__head">
      <span class="recent__title">最近搜索</span>
      <!--
        「清空」只在真有内容时出现。
        禁用态而不是隐藏是抽屉里那些开关的做法，但这里不同：它不是一个用户会去
        找的固定控件，而是内容的附属动作，没有内容时连标题下面都是空的。
      -->
      <button
        v-if="enabled && props.items.length > 0"
        class="recent__clear"
        type="button"
        @click="emit('clear')"
      >
        清空
      </button>
    </header>

    <p v-if="!enabled" class="recent__empty">搜索记录已在设置里关闭</p>
    <p v-else-if="props.items.length === 0" class="recent__empty">搜过的词会出现在这里</p>

    <div v-else class="recent__list">
      <span v-for="item in props.items" :key="item" class="recent__item">
        <!--
          两个按钮并排而不是「按钮里套一个按钮」：后者不是合法 HTML，
          浏览器会把内层的提出去，于是删除键落到 chip 外面。
          外层 span 只负责把它们画成一颗 chip。
        -->
        <button class="recent__pick" type="button" :title="item" @click="emit('pick', item)">
          <span class="recent__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="8.2" stroke="currentColor" stroke-width="1.7" />
              <path
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.7"
                d="M12 7.6V12l3 2"
              />
            </svg>
          </span>
          <span class="recent__text">{{ item }}</span>
        </button>

        <button
          class="recent__drop"
          type="button"
          :aria-label="`删除记录：${item}`"
          @click="emit('drop', item)"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              stroke="currentColor"
              stroke-linecap="round"
              stroke-width="2"
              d="M7 7l10 10M17 7L7 17"
            />
          </svg>
        </button>
      </span>
    </div>
  </section>
</template>

<style scoped>
/*
 * `min-height: 0` + `flex: 1`：它吃掉输入行与引擎条之外的全部余量，
 * 内部溢出时纵向滚动。给 `flex: none` 的话，记录一多就会把输入框顶出方格。
 */
.recent {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 5px;
}

.recent__head {
  display: flex;
  flex: none;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-2);
}

/*
 * 分区标题取 --fs-xs + faint：它是这块区域里最弱的一层信息。
 * 真正要被看到的是下面那些词，标题只回答「这些词是哪来的」。
 */
.recent__title {
  color: var(--sw-sub-text, var(--color-text-faint));
  font-size: var(--fs-xs);
  letter-spacing: 0.03em;
  line-height: 1;
}

.recent__clear {
  padding: 2px 4px;
  margin: -2px -4px;
  border-radius: var(--r-sm);
  color: var(--sw-sub-text, var(--color-text-faint));
  font-size: var(--fs-xs);
  line-height: 1;
  transition: color var(--dur-fast) var(--ease);
}

.recent__clear:hover {
  color: var(--sw-text, var(--color-text));
}

.recent__clear:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.recent__empty {
  margin: 0;
  color: var(--sw-sub-text, var(--color-text-disabled));
  font-size: var(--fs-xs);
  line-height: 1.5;
}

.recent__list {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-wrap: wrap;
  align-content: flex-start;
  overflow-y: auto;
  gap: var(--sp-1);
  scrollbar-color: rgb(255 255 255 / 0.18) transparent;
  scrollbar-width: thin;
}

/*
 * 一颗 chip 是两个按钮拼出来的，所以圆角、底色、描边画在外层这个 span 上，
 * 内层两个按钮自己不带面——否则 hover 时会看到两块分开亮起的色块。
 */
.recent__item {
  display: flex;
  max-width: 100%;
  min-height: 22px;
  align-items: stretch;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: var(--r-full);
  /* 记录 chip 与引擎 chip 同属方块内的次要面板，共用同一档次要背景 */
  background: var(--sw-sub-bg, var(--fill));
  color: var(--sw-text, var(--color-text-dim));
  transition:
    background-color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.recent__item:hover {
  border-color: var(--line-strong);
  background: var(--sw-sub-bg, var(--fill-hover));
  color: var(--sw-text, var(--color-text));
}

.recent__pick {
  display: flex;
  min-width: 0;
  align-items: center;
  padding: 0 3px 0 7px;
  color: inherit;
  font-size: var(--fs-xs);
  gap: 4px;
}

.recent__pick:focus-visible,
.recent__drop:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.recent__icon {
  display: grid;
  width: 11px;
  height: 11px;
  flex: none;
  opacity: 0.7;
  place-items: center;
}

.recent__icon svg {
  width: 11px;
  height: 11px;
}

/*
 * 一条记录最长 60 字（useSearchHistory 的 MAX_LENGTH），在 2 格宽里就是一整行。
 * 上限压到 15em 并 ellipsis：一条长句独占一行会把其余记录全推到滚动区外面，
 * 而前十几个字已经足够认出是哪一次搜索——完整内容在 title 里。
 */
.recent__text {
  max-width: 15em;
  min-width: 0;
  overflow: hidden;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * 删除键常驻，不做 hover 才出现。
 *
 * 这些 chip 在触屏上没有 hover 可言，而它是这条记录唯一的删除入口；
 * 藏起来等于在触屏上删不掉。代价是每颗 chip 宽 14px，可接受。
 */
.recent__drop {
  display: grid;
  width: 18px;
  flex: none;
  color: inherit;
  opacity: 0.55;
  place-items: center;
  transition: opacity var(--dur-fast) var(--ease);
}

.recent__drop svg {
  width: 9px;
  height: 9px;
}

.recent__drop:hover {
  opacity: 1;
}

/* 触屏下把删除键与 chip 一起放大到够点的尺寸 */
@media (pointer: coarse) {
  .recent__item {
    min-height: 30px;
  }

  .recent__drop {
    width: 26px;
  }
}
</style>

<script setup lang="ts">
const props = defineProps<{
  /** 列表项文本 */
  items: string[]
  /** 高亮项下标；-1 表示「无选中」态 */
  activeIndex: number
  /** 定位与宽度：全部来自搜索条外框的实测矩形 */
  rect: { left: number; top: number; bottom: number; width: number }
  /** listbox 自身的 id，供输入框的 aria-controls 指向 */
  listId: string
  /** 列表项 id 前缀，供输入框的 aria-activedescendant 指向 */
  idPrefix: string
}>()

const emit = defineEmits<{
  /** 用 pointerdown 而非 click 提交，理由见模板里的注释 */
  pick: [index: number]
  hover: [index: number]
}>()

/** 与视口边缘的最小留白 */
const MARGIN = 8
/** 与搜索条之间的缝 */
const OFFSET = 6

/**
 * 定位。
 *
 * 不实测自身高度再翻转——列表最多 10 项、高度上限由 max-height 定死，
 * 而搜索条在页面顶部，向下永远有空间。只在极矮的窗口里把 max-height 夹一次，
 * 靠 CSS 的 min() 完成，不需要 JS 参与。
 *
 * 宽度**硬绑外框实测宽度**，不写死 550：宽度是 1–6 格可配的，写死会在其余档位下错位。
 */
function style() {
  const room = Math.max(120, window.innerHeight - props.rect.bottom - OFFSET - MARGIN)
  return {
    left: `${props.rect.left}px`,
    top: `${props.rect.bottom + OFFSET}px`,
    width: `${props.rect.width}px`,
    '--suggest-room': `${room}px`,
  }
}
</script>

<template>
  <!--
    Teleport 与进出场过渡由外层 OverlayLayer 负责。

    必须 Teleport 到 body：留在 .grid-wrap 里会被它的 overflow: hidden 直接裁掉。

    role="listbox" 落在 <ul> 而不是外层 div：中间隔一层带 list 角色的 ul 会切断
    listbox → option 的父子关系，读屏器就报不出「第 2 项，共 10 项」。
    外层 div 只负责面板视觉与磨砂子层，因此它必须 role="presentation"，
    否则那层 div 本身会作为一个无名分组出现在无障碍树里。

    列表不接焦点——焦点始终留在输入框里，高亮靠输入框上的 aria-activedescendant
    指向这里的项 id。焦点跳到列表项上会让输入法状态和光标位置一起丢掉。
  -->
  <div class="suggest" :style="style()" data-suggest role="presentation">
    <div class="suggest__glass" aria-hidden="true" />

    <ul :id="listId" class="suggest__list" role="listbox" aria-label="搜索建议">
      <li
        v-for="(item, i) in items"
        :id="`${idPrefix}-${i}`"
        :key="item"
        class="suggest__item"
        :class="{ 'is-active': i === activeIndex }"
        role="option"
        :aria-selected="i === activeIndex"
        @pointerdown.prevent="emit('pick', i)"
        @mouseenter="emit('hover', i)"
      >
        <span class="suggest__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <circle cx="10.8" cy="10.8" r="5.4" stroke="currentColor" stroke-width="1.7" />
            <path
              stroke="currentColor"
              stroke-linecap="round"
              stroke-width="1.7"
              d="m15 15 4.4 4.4"
            />
          </svg>
        </span>
        <span class="suggest__text">{{ item }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
/*
 * 建议列表。
 *
 * 面板语言与右键菜单同一套（--bg-search / --glass-search / --shadow-md / --r-md），
 * 层级取 --z-suggest 950：高于 --z-drag 900，低于 --z-dialog 1000。
 *
 * 磨砂**不挂在这一层**，而是拆到 .suggest__glass 子层上——理由见下面的过渡区。
 */
.suggest {
  position: fixed;
  z-index: var(--z-suggest);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-search);
  box-shadow: var(--shadow-md);
}

/*
 * 磨砂层：属性恒定，绝不进入任何过渡。
 *
 * 与 SettingsDrawer 的 .scrim__glass 同一个手法。它必须是独立子层而不是写在
 * .suggest 上：只要 .suggest 自身参与 opacity 过渡，就会建立新的 backdrop root，
 * 让 backdrop-filter 只采样到自己内部（近全透明）——既白付每帧全屏读回、
 * 又看不到模糊。这里的过渡只动 transform（见下），但把模糊隔离出来仍是对的：
 * 将来若要加淡入，改一行就够，不必回头重构层次。
 */
.suggest__glass {
  position: absolute;
  backdrop-filter: var(--glass-search);
  pointer-events: none;
  inset: 0;
}

/* 不支持 backdrop-filter 时退化为不透明面板档位，不跳回别的配色 */
@supports not (backdrop-filter: blur(1px)) {
  .suggest {
    background: var(--surface-3);
  }
}

.suggest__list {
  position: relative;
  display: flex;
  /* 上限取「到视口底部还剩多少」与 340px 的较小者，窄窗口下不越界 */
  max-height: min(340px, var(--suggest-room, 340px));
  flex-direction: column;
  overflow-y: auto;
  margin: 0;
  padding: var(--sp-1);
  gap: 2px;
  list-style: none;
  scrollbar-color: rgb(255 255 255 / 0.18) transparent;
  scrollbar-width: thin;
}

.suggest__item {
  display: flex;
  min-height: 34px;
  align-items: center;
  padding: 0 var(--sp-2);
  border-radius: var(--r-sm);
  font-size: var(--fs-base);
  gap: var(--sp-2);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease);
}

/* 高亮用中性填充而非 accent：accent 只标二元状态，不标「当前所指」 */
.suggest__item.is-active {
  background: var(--fill-raised);
}

.suggest__icon {
  display: grid;
  width: 14px;
  height: 14px;
  flex: none;
  color: var(--color-text-faint);
  place-items: center;
}

.suggest__icon svg {
  width: 14px;
  height: 14px;
}

.suggest__text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 触屏下把行高提到 44px，与其余列表一致 */
@media (pointer: coarse) {
  .suggest__item {
    min-height: 44px;
  }
}

/* ── 进出场：只动 transform ──────────────────────────── */

/*
 * 刻意**不动 opacity**。
 *
 * 列表是自己淡入的（不像抽屉那样有独立遮罩可拆层），而自身 opacity < 1 会建立
 * 新的 backdrop root——模糊只采样到自己内部（近全透明），既白付每帧全屏读回、
 * 又看不到模糊。想要淡入的话，得照 SettingsDrawer 那样再拆一个只动 opacity 的
 * 纯色 __tint 子层；先做只动 transform 的版本，够用就不必拆。
 */
.suggest-enter-active,
.suggest-leave-active {
  transition: transform var(--dur-fast) var(--ease);
  will-change: transform;
}

/* 退场中不再接受点击，否则收起动画期间还能选中已经关掉的项 */
.suggest-leave-active {
  pointer-events: none;
}

.suggest-enter-from,
.suggest-leave-to {
  transform: translateY(-4px);
}
</style>

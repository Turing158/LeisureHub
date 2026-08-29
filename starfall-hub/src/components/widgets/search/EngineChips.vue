<script setup lang="ts">
/**
 * 引擎选择条：一排 chips，图标 + 名称。
 *
 * 三处在用，共用同一份列表与同一套 radiogroup 语义：
 *   搜索方块 h=1（`wrap: false`、`compact`，输入行下方一条不换行的窄行）
 *   搜索方块 h=2（默认，输入行下方居中，可换行）
 *   设置抽屉的「搜索」分组（`align: 'start'`，与那一列其余控件对齐）
 *
 * 不发请求、无隐私成本，所以「摊开在方格里」这件事本身没有代价，只是占地方——
 * 这正是它要按档位调整密度的原因，而不是在窄档位下整块消失。
 */
import EngineIcon from './EngineIcon.vue'
import type { EngineDef } from '@/data/engines'

withDefaults(
  defineProps<{
    engines: EngineDef[]
    currentId: string
    /**
     * 横向对齐。
     *
     * 方格里居中（与输入框同一条中轴），设置抽屉里靠左（那一列的其余控件
     * 都是左起的，居中会让它看起来不属于这张表单）。
     *
     * **不换行那一档不接受本项**：那里的居中必须靠 auto margin（见样式区），
     * 所以下面的行内 style 在那一档整个不写——行内样式压得过任何 class，
     * 写上去就只能再用 !important 抢回来。
     */
    align?: 'center' | 'start'
    /**
     * 是否允许换行。
     *
     * 默认允许：装不下时多占一行，全部引擎都在视野里。
     * h=1 那一档只有一行的高度（整格 75px，输入行吃掉一半），必须关掉——
     * 换行会把第二行挤出方格，而方格 `overflow: hidden`，那几条就彻底消失了。
     * 关掉后改为横向滚动，代价是滚动条被藏起来（见样式区），所以那一档另外
     * 保留了引擎按钮当完整列表，见 variant.ts 的 showsEngineToggle。
     */
    wrap?: boolean
    /**
     * 紧凑档：行高与字号各降一档。
     *
     * 同样是给 h=1 的——那一档垂直方向只剩二十来像素，标准的 26px 行高
     * 会把输入框顶出方格。只降密度不降信息：名称照常显示。
     */
    compact?: boolean
    /**
     * 只画图标，藏掉名称（名称转为 title 与读屏标签，不是丢掉）。
     *
     * 给 2 格宽的 h=1 用，这是一笔实测出来的账：那一档 chips 只有 152px 可用，
     * 而「百度 / Bing / Google / 知乎」四颗带文字的紧凑 chip 要 241px，
     * 后两颗会被推到方格外面——方块 `overflow: hidden`，它们就此消失。
     * 去掉文字后四颗合计约 100px，全部落在方格内。
     *
     * 代价是要靠图标认出是哪家，所以**只在装不下的宽度上启用**：3 格起
     * （254px 可用）四个名称装得下，那里就该显示名称。判据在 SearchWidget。
     */
    iconOnly?: boolean
  }>(),
  { align: 'center', wrap: true, compact: false, iconOnly: false },
)

const emit = defineEmits<{ select: [id: string] }>()
</script>

<template>
  <div
    class="chips"
    :class="{ 'is-nowrap': !wrap, 'is-compact': compact, 'is-icon-only': iconOnly }"
    :style="wrap ? { justifyContent: align } : undefined"
    role="radiogroup"
    aria-label="选择搜索引擎"
  >
    <button
      v-for="engine in engines"
      :key="engine.id"
      class="chips__item"
      :class="{ 'is-current': engine.id === currentId }"
      type="button"
      role="radio"
      :aria-checked="engine.id === currentId"
      :title="iconOnly ? engine.name : undefined"
      :aria-label="iconOnly ? engine.name : undefined"
      @click="emit('select', engine.id)"
    >
      <span class="chips__icon">
        <EngineIcon :name="engine.icon" />
      </span>
      <!--
        只画图标那一档把名称从 DOM 里去掉，而不是 CSS 隐藏。
        隐藏的文字仍会参与 flex 的最小内容宽度计算，chip 照样撑到原来那么宽，
        那正是这一档要解决的问题。读屏可读性由上面的 aria-label 顶上。
      -->
      <span v-if="!iconOnly" class="chips__label">{{ engine.name }}</span>
    </button>
  </div>
</template>

<style scoped>
/*
 * 横排，默认允许换行：自定义引擎可以有十几条，不换行会在窄档位下撑出横向滚动。
 * 主轴对齐由 align 属性给（方格里居中、抽屉靠左）。
 *
 * 溢出改为纵向滚动而不是裁掉：引擎条数没有上限（内置 4 + 自定义 12），
 * 2 格高的方块装不下全部，裁掉会让后几条彻底点不到。
 */
.chips {
  display: flex;
  min-height: 0;
  flex-wrap: wrap;
  align-content: flex-start;
  overflow-y: auto;
  gap: var(--sp-1);
  scrollbar-color: rgb(255 255 255 / 0.18) transparent;
  scrollbar-width: thin;
}

/*
 * 不换行档（h=1）。
 *
 * 滚动条**藏起来**：这一行总高只有 22px，一条 thin 滚动条就要吃掉六七个，
 * 剩下的高度写不下一个字。代价是「还有更多引擎」这件事没有视觉提示，
 * 所以那一档保留了输入框左侧的引擎按钮——完整列表在那里，这条 chips 只是快捷方式。
 *
 * 居中靠 auto margin 而不是 justify-content：溢出时 `center` 会把首项推到
 * scroll origin 之前，那几颗永远滚不到（与 useGridMetrics 里 areaStyle 的
 * marginInline 同一个理由）。auto margin 只吃「剩余空间」，溢出时自动退化为 0，
 * 因此一条声明同时覆盖「装得下就居中」与「装不下就从头开始滚」。
 */
.chips.is-nowrap {
  flex-wrap: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.chips.is-nowrap > :first-child {
  margin-inline-start: auto;
}

.chips.is-nowrap > :last-child {
  margin-inline-end: auto;
}

.chips.is-nowrap::-webkit-scrollbar {
  display: none;
}

.chips__item {
  display: flex;
  min-height: 26px;
  align-items: center;
  padding: 0 var(--sp-2);
  border: 1px solid transparent;
  border-radius: var(--r-full);
  background: var(--fill-raised);
  color: var(--color-text-dim);
  font-size: var(--fs-sm);
  gap: 5px;
  white-space: nowrap;
  transition:
    background-color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

/*
 * 紧凑档的尺寸。
 *
 * 22px / 11px 是这套语言里最小的一档：再小名称就要跟着缩到 10px 以下，
 * 而 --fs-xs（11px）已经是提示语的字号，正文类文字不再往下走。
 * flex: none 防止在 nowrap 容器里被压扁成一条竖线。
 *
 * 内边距与两处 gap 都比标准档再小一号，这不是「顺手压紧」——它买的是 3 格宽
 * （247px 可用）那一档的余量。按标准档的 7px/4px 量出来只剩 6px 富余，
 * 而这台机器上 Inter 未必装得上、回落到微软雅黑就会宽出几像素，
 * 「知乎」会被推到方格外（那一档不换行、滚动条又是藏起来的）。
 * 收紧后余量约 20px，字体回落带来的差异吃得下。
 */
.chips.is-compact {
  gap: 3px;
}

.chips.is-compact .chips__item {
  min-height: 22px;
  padding: 0 6px;
  flex: none;
  font-size: var(--fs-xs);
  gap: 3px;
}

.chips__item:hover {
  background: var(--fill-hover);
  color: var(--color-text);
}

/*
 * 当前引擎用描边标记，**不用 --accent**——它只留给开关轨道、色板选中环、
 * 拖拽落点这三处状态标记。这里是「一组同类里的哪一个」，与色板不同：
 * chip 带文字，描边 + 文字提亮已经足以区分，不需要色相参与。
 */
.chips__item.is-current {
  border-color: var(--line-strong);
  background: var(--fill-hover);
  color: var(--color-text);
}

.chips__item:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.chips__icon {
  display: grid;
  width: 14px;
  height: 14px;
  flex: none;
  opacity: 0.82;
  place-items: center;
}

.chips.is-compact .chips__icon {
  width: 12px;
  height: 12px;
}

/*
 * 只画图标那一档收成一颗正方形圆钮：图标 12px + 左右各 5px。
 * padding 归零、宽度写死，否则 chip 会保留为文字留的那份左右内边距，
 * 看起来是一颗被掏空了右半边的胶囊。
 */
.chips.is-icon-only .chips__item {
  width: 22px;
  padding: 0;
  justify-content: center;
  gap: 0;
}

.chips.is-compact.is-icon-only .chips__item {
  width: 20px;
}

.chips__label {
  min-width: 0;
  overflow: hidden;
  line-height: 1;
  text-overflow: ellipsis;
}
</style>

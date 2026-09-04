<script setup lang="ts">
import { computed } from 'vue'

import DoneHistory from './DoneHistory.vue'
import { railDotBudget } from './variant'
import type { TodoItem } from '@/types/todo'

/**
 * rail——1×2 / 1×3 / 1×4 那三种形状（75px 宽、222/343/464px 高）。
 *
 * 用户给的降级阶梯里没提这三种，但它们必须有个答案，否则会掉进 list 分支，
 * 而 75px 减去左右 padding 只剩 59px，一行正文放得下三个汉字。
 *
 * **不放文字。** 纵向叠三层，各回答一个问题：
 *
 *   1. 顶部数字　「还剩几件」
 *   2. 中部点阵　「这几件里做掉了多少」——每个未完成项一个实心点，已完成画成空心
 *   3. 底部柱图　「最近在推进吗」——近七天各天的完成数（h≥3 才有，见 DoneHistory）
 *
 * 第三层是这一档不再留白的答案：1×4 的点阵之下原本有约 400px 是空的，而这一档
 * 又放不下正文。柱图是**只在窄高形状里才成立**的内容，横向的 list / grouped
 * 不需要它（那里的空间该给清单本身），所以它只挂在这里。
 *
 * 点与柱都不可点击（6px 的命中区在触屏上不可用），也不带 title。
 * **这是唯一一个没有任何写操作的档**——要操作就把方块拉宽。
 *
 * 点阵的上限按占格高分档（railDotBudget），画不下的部分由一个「+n」如实报数，
 * 而不是让 overflow 静默裁掉——裁掉的点看起来就是不存在的待办。
 */
const props = defineProps<{
  activeCount: number
  /** 未完成项，按 createdAt 倒序（排序规则在 useTodos，这里只消费） */
  active: TodoItem[]
  /** 已完成项，按 doneAt 倒序。点阵接在 active 之后，柱图只用它 */
  completed: TodoItem[]
  /** 画不画底部柱图。由 railHasHistory 判定（h≥3），不在这里重算占格 */
  showHistory?: boolean
  /**
   * 占格高，只用来算点阵上限（见 railDotBudget）。
   *
   * 它是这个组件里唯一一处读占格的地方，而版式判定仍全在 variant.ts——
   * 这里读的是「画得下几个」这个纯像素预算，不是「哪一档」。
   */
  spanH?: number
}>()

/**
 * 这一档画得下几个点。预算按占格高分档，理由与实测数字见 railDotBudget。
 *
 * 不封顶会让多出来的点被 `.rail__dots` 的 overflow 裁掉，而**裁掉的点看起来就是
 * 不存在的待办**；封顶后多出来的量改由下面那个「+n」如实说出来。
 */
const budget = computed(() => railDotBudget(props.spanH))

/** 未完成在前、已完成在后（顺序由调用方给定，这里只拼接） */
const all = computed(() => [...props.active, ...props.completed])

const dots = computed(() => all.value.slice(0, budget.value))

/**
 * 没画出来的还剩多少。
 *
 * 0 时整个标记不渲染。有溢出时画一句「+37」——这是 RecentSearches 那条
 * 「三个状态每个都有文案」的同一条纪律用在数量上：**宁可承认画不下，
 * 也不要让点阵默默少给三十几个**，否则用户会按看到的点数以为自己事情更少。
 */
const hidden = computed(() => Math.max(0, all.value.length - budget.value))

</script>

<template>
  <div class="rail">
    <!--
      数字与 count 档同一个语义，但这里不再写「未完成」三个字：
      75px 宽下三个 11px 的字要 33px，与数字挤在一起读不出层级。
      可读内容由 TodoWidget 根节点那个 .sr-only 统一提供。
    -->
    <div class="rail__count" aria-hidden="true">{{ props.activeCount }}</div>

    <div class="rail__dots" aria-hidden="true">
      <span
        v-for="item in dots"
        :key="item.id"
        class="rail__dot"
        :class="{ 'rail__dot--done': item.done }"
      />
      <!--
        画不下的余量如实报数，不静默裁掉。它是点阵的最后一个「格」，
        跟在点后面参与同一次 flex-wrap，所以不需要额外的行。
      -->
      <span v-if="hidden > 0" class="rail__more">+{{ hidden }}</span>
    </div>

    <!-- v-if 而非 CSS 隐藏：它内部订阅 useToday，不在场时不该占一份引用计数 -->
    <DoneHistory v-if="props.showHistory" :completed="props.completed" />
  </div>
</template>

<style scoped>
/*
 * `flex: 1` 不可省。
 *
 * 这一层是 `.td`（column flex）的**唯一子元素**，默认 `flex: 0 1 auto` 让它按内容
 * 收缩：实测 1×4 的 .td 高 436px 而 .rail 只有 197px，底下 240px 是空的——
 * 下面那句 `.rail__dots { flex: 1 }` 因此从来没有余量可吃，点阵恒为一行。
 * 「1×4 点阵之下一大片空白」的根源就在这里，不是柱图缺位。
 *
 * 于是纵向余量的分配是两级的：这一层把 .td 的高度全部接过来，
 * 再由 .rail__dots 吃掉数字与柱图之外的剩余。
 */
.rail {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  padding: 10px 8px;
  gap: 8px;
}

/*
 * 数字区。
 *
 * 字号用 clamp() 的固定端，不写成 calc(var(--td-h) * 系数)：同一个占格形状有
 * 两个高度（起名 / 没起名，差 26px），系数在两档上给出的结果差 13%。
 * 这一档三种高度（222 / 343 / 464 各两档）共六个值，一个 clamp 按宽度收敛即可
 * ——宽度恒为 75px，所以它实际是一个定值，写成 clamp 只是为了拖拽浮层缩放时跟着走。
 */
.rail__count {
  flex: none;
  color: var(--td-text, var(--color-text));
  font-size: clamp(20px, calc(var(--td-w) * 0.34), 28px);
  font-variant-numeric: tabular-nums;
  font-weight: 300;
  line-height: 1;
  text-align: center;
}

/*
 * 点阵。
 *
 * flex-wrap 而不是 grid：一行几个由可用宽度自然决定，拖拽浮层缩放时不必换布局。
 * align-content: flex-start 让不满一行的最后一行贴左上，而不是被拉散。
 *
 * **它是这一列里唯一 flex: 1 的块**——柱图定高（见 DoneHistory 的行高注释），
 * 纵向余量一律由点阵吸收。反过来（点阵定高、柱图伸缩）会让柱子在 1×4 里被拉成
 * 一片色带，而「这天做了几条」是靠柱**长**读的，柱高变了不表达任何信息。
 *
 * align-content 从 flex-start 改成 center。条目少时点阵只有两三行，贴顶会让余量
 * 全积在点阵与柱图之间，读成一个「中间破了个洞」的方块（实测 1×4 那段空白 200px）。
 * 居中后余量被分到上下两侧，成了三层之间的呼吸，而不是一处缺口。
 */
.rail__dots {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-wrap: wrap;
  align-content: center;
  justify-content: center;
  overflow: hidden;
  gap: 6px;
}

.rail__dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: var(--r-full);
  /* 未完成的点是实心的主要文字色：它代表「还在」 */
  background: var(--td-text, var(--color-text-dim));
}

/*
 * 已完成画成空心。
 *
 * 不用 --accent 标它：accent 只准标「状态」且这里已经有两种形态（实心 / 空心）
 * 在表达同一件事，再加一个颜色维度是重复。空心走次要文字色——
 * 「已完成」在视觉上就是「降为次要」，与 TodoRow 的删除线同一条纪律。
 */
.rail__dot--done {
  border: 1px solid var(--td-sub-text, var(--color-text-disabled));
  background: transparent;
}

/*
 * 「+37」——画不下的余量。
 *
 * 10px、次要文字色，与 DoneHistory 的标注同一档：它是对点阵的注释而不是一个点。
 * 不给它 flex: none 之外的任何尺寸，让它按文字宽自然占位；
 * 整行独占（flex-basis: 100%）会在只溢出几个时空掉一整行，所以刻意跟在点后面。
 */
.rail__more {
  flex: none;
  align-self: center;
  color: var(--td-sub-text, var(--color-text-disabled));
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
</style>

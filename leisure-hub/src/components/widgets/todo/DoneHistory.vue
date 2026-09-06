<script setup lang="ts">
import { computed } from 'vue'

import { recentDone, WINDOW_DAYS } from './history'
import { useToday } from '@/composables/useToday'
import type { TodoItem } from '@/types/todo'

/**
 * 近七天完成柱——rail 档（w=1 且 h≥3）底部那一块。
 *
 * 它回答的问题与上面两层不同：数字答「还剩几件」，点阵答「这几件做掉了多少」，
 * 这里答「最近在推进吗」。放在 rail 而不放在 list / grouped，是因为只有 w=1
 * 这三种形状有纵向余量而没有正文可放——横向档的空间该给清单本身。
 *
 * **拆成独立组件而不是写在 TodoRail 里，为的是 useToday 的订阅时机。**
 * 那个 composable 靠 onBeforeUnmount 做引用计数；写在 TodoRail 里则 1×2 那一档
 * （不画柱图）也会白订阅一次。这里由 v-if 控制挂载，订阅与「柱图真的在场」同步。
 */
const props = defineProps<{
  /** 已完成项。柱图只看 doneAt，未完成的一律不计入 */
  completed: TodoItem[]
}>()

const today = useToday()

/** 近七天完成数，今天在最后一项 */
const days = computed(() => recentDone(props.completed, today.value))

/**
 * 柱长的分母。
 *
 * 取 `max(4, 当周峰值)` 而不是纯峰值：只完成过一条时，纯峰值会把那一条画成一根
 * **满格**的柱，读起来像「这天干完了所有事」。给一个 4 的地板后，满格的含义
 * 稳定为「这天做掉了至少四条」，柱长在低计数区才是诚实的。
 */
const scale = computed(() => Math.max(4, ...days.value.map((day) => day.count)))

/** 全为 0 时换一行说明文案——三个状态每个都有句子，绝不留白 */
const hasAny = computed(() => days.value.some((day) => day.count > 0))
</script>

<template>
  <!--
    整块 aria-hidden：读屏听到的是 TodoWidget 根节点那句 .sr-only 摘要，
    逐日念七遍「周三 0 条」只会把真正重要的「还剩几件」埋掉。
  -->
  <div class="hist" aria-hidden="true">
    <div class="hist__head">近 {{ WINDOW_DAYS }} 天</div>

    <p v-if="!hasAny" class="hist__empty">还没有完成记录</p>

    <template v-else>
      <div
        v-for="day in days"
        :key="day.key"
        class="hist__day"
        :class="{ 'hist__day--today': day.isToday }"
      >
        <span class="hist__label">{{ day.label }}</span>
        <span class="hist__track">
          <!--
            柱长用百分比而不是 px：这一档宽度恒为 75px，但拖拽浮层会整体缩放，
            按百分比的柱跟着轨道走，按 px 的会在缩放后戳出轨道。
          -->
          <span
            v-if="day.count > 0"
            class="hist__bar"
            :style="{ width: `${Math.min(100, (day.count / scale) * 100)}%` }"
          />
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
/*
 * 定高块，贴方块底部（flex: none 由父级的布局给出，这里只声明内部构成）。
 *
 * 一条上分隔线让「剩余」与「回顾」读成两件事，而不是一列越来越小的点。
 * 用 --line-subtle 这一档最弱的描边——两个区之间是分节而不是分栏，
 * 给到 --line 就抢过柱子本身了。
 */
.hist {
  display: flex;
  flex: none;
  flex-direction: column;
  border-top: 1px solid var(--line-subtle);
  padding-top: 6px;
  gap: 2px;
}

/*
 * 10px 而非 --fs-xs(11px)：75px 宽下这个标题是最次要的一层，
 * 与下面的星期标签同字号，让它们读成同一组标注。
 */
.hist__head {
  color: var(--td-sub-text, var(--color-text-disabled));
  font-size: 10px;
  letter-spacing: 0.04em;
  line-height: 1.4;
}

.hist__empty {
  margin: 2px 0 0;
  color: var(--td-sub-text, var(--color-text-disabled));
  font-size: 10px;
  line-height: 1.5;
}

/*
 * 一天一行：标签定宽 + 轨道吃余量。
 *
 * 行高 10px 写死。这一块的纵向开销必须是可预知的定值，
 * variant.ts 的 railHasHistory 正是按这个数算出「h=2 放不下」的。
 */
.hist__day {
  display: flex;
  height: 12px;
  flex: none;
  align-items: center;
  gap: 4px;
}

/*
 * 标签给 1.4em 定宽而不是 auto：七个字（一二三四五六 + 今）宽度不等，
 * auto 会让七条轨道各自从不同的横坐标起跳，柱长于是不可比。
 */
.hist__label {
  width: 1.4em;
  flex: none;
  color: var(--td-sub-text, var(--color-text-disabled));
  font-size: 10px;
  line-height: 1;
  text-align: center;
}

/* 今天的标签提到主要文字色：一列里最该被认出来的就是它 */
.hist__day--today .hist__label {
  color: var(--td-text, var(--color-text-dim));
}

/*
 * 轨道恒在，哪怕这天是 0。
 *
 * 空行完全不画的话，「周四什么都没干」会变成不存在的一天，七行也塌成五行——
 * 行数跳动比一条空轨道更难读。
 */
.hist__track {
  height: 4px;
  flex: 1;
  overflow: hidden;
  border-radius: var(--r-full);
  background: var(--line-subtle);
}

/*
 * 柱子走次要文字色，不用 --accent。
 *
 * accent 只准标状态（开关、选中、落点），「上周三完成了两条」是数据不是状态。
 * 与点阵同一套灰阶，两个区因此读起来是同一个组件的两层，而不是两张图。
 */
.hist__bar {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--td-sub-text, var(--color-text-dim));
}

/* 今天那根提到主要文字色，与它的标签同步 */
.hist__day--today .hist__bar {
  background: var(--td-text, var(--color-text));
}
</style>

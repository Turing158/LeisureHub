<script setup lang="ts">
import { computed } from 'vue'

import CalMonthGrid from './CalMonthGrid.vue'
import type { CalendarView } from './dateGrid'

/**
 * 不接任何 span prop：3×4 与 4×4 的结构完全相同，
 * 两者的差异全部由 CSS 里的 --cal-w / --cal-h 吸收。
 * 组件签名要把「这一档没有结构分支」这件事显式表达出来。
 */
const props = defineProps<{ view: CalendarView }>()

/**
 * 剩余天数与进度就地算，不进 CalendarView：
 * 两者都由 dayOfYear / yearDays 一步推出，放进 view 会有两份真值源。
 */
const daysLeft = computed(() => props.view.yearDays - props.view.dayOfYear)

/** 0..100，直接喂给进度条的 width 百分比 */
const progress = computed(() => (props.view.dayOfYear / props.view.yearDays) * 100)
</script>

<template>
  <!--
    w≥3, h≥4（265×438、360×438）。纵向依次是刊头、今日区、整月网格。

    aria-hidden 不可省：否则「今年还剩 126 天」会被拼进方格的可访问名，
    唯一的可读内容仍是外壳那一个 .sr-only。
  -->
  <div class="mt" aria-hidden="true">
    <!--
      刊头。月份是唯一的主标题——它每月都变，且决定下方 42 格的含义；
      年份一年才变一次，降级到右端与周数并列。
      星期几移到今日区：「今天」的三项从此聚在同一个带里。
    -->
    <div class="mt__head">
      <span class="mt__month">{{ view.month }} 月</span>
      <span class="mt__meta">{{ view.year }} · 第 {{ view.week }} 周</span>
    </div>

    <!--
      今日区。吸收纵向全部余量（原设计里被 margin-top: auto 推成空白的那 52..87px）。
      日号与星期竖向叠放而非三项并排：3×4 只有 238px 可用宽，
      并排后「今年还剩 126 天」的末字会被 overflow: hidden 静默切掉。
    -->
    <div class="mt__today">
      <div class="mt__row">
        <div class="mt__now">
          <span class="mt__day">{{ view.day }}</span>
          <span class="mt__wd">{{ view.weekdayText }}</span>
        </div>
        <span class="mt__left">今年还剩 {{ daysLeft }} 天</span>
      </div>

      <!--
        年度进度条通栏。选年度进度而非农历或倒计时，理由是零依赖且可确定：
        它只由当天日期推出，与 dateGrid 现有函数同性质。
      -->
      <div class="mt__bar">
        <div class="mt__fill" :style="{ width: `${progress}%` }"></div>
      </div>
    </div>

    <CalMonthGrid class="mt__grid" :grid="view.grid" header />
  </div>
</template>

<style scoped>
/*
 * 基准的分工：横向的东西按 --cal-w 算，纵向的东西按 --cal-h 算。
 *
 * 这一档的两个形状等高不等宽（都是 438px，宽差 95px），
 * 因此不沿用 CalMonth 的「按短边算」——那会让 4×4（短边 360）与
 * 3×4（短边 265）的每一处都差 36%，而它们真正相同的恰是纵向空间。
 */
.mt {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  padding: calc(var(--cal-w) * 0.05);
}

/* 刊头一行、两端各一组字，宽度是它的约束 */
.mt__head {
  display: flex;
  flex: 0 0 auto;
  align-items: baseline;
  justify-content: space-between;
  padding-bottom: calc(var(--cal-w) * 0.045);
  gap: calc(var(--cal-w) * 0.04);
}

/* 0.085w：3×4 得 22.5px、4×4 得 30.6px，是刊头里最大的字 */
.mt__month {
  color: var(--cal-text, var(--color-text));
  font-size: calc(var(--cal-w) * 0.085);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

/*
 * 「2026 · 第 35 周」，13.3px 下约 93px 宽。
 * 左端「8 月」约 34px，两者相加 127px < 可用宽 238px，
 * 因此这一档恒定显示周数，不再需要 CalMonth 那个 showWeek 分支。
 */
.mt__meta {
  color: var(--cal-sub-text, var(--color-text-dim));
  font-size: calc(var(--cal-w) * 0.05);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

/*
 * 今日区定高 0.26h（113.4px），两档同值，内容由 justify-content 居中。
 *
 * 定高而不是 flex: 1 吃余量 —— 这是与计划书 §5 相反的分工，理由是实测：
 * 让网格封顶、余量归今日区时，4×4 只分到 85.6px 而内容恒需 86.3px，
 * 刊头与日号几乎贴上；同时 4×4 的行高被撑到 35.3px，反倒比 4×3 的 32.5px 更高，
 * 「下半张月历看起来不变」这条没成立。
 *
 * 反过来把确定的那一项定死：内容高度是可算的（三项都 line-height: 1、
 * 进度条定高、全是 flex 子项），0.198h + 上下各 0.031h 呼吸 = 0.26h。
 * 余量交给网格后行高自然落在 36.5（3×4）/ 33（4×4），与 3×3 / 4×3 对齐，
 * 而两档的今日区真正等高 —— 这正是「纵向的东西按 --cal-h 算」该有的结果。
 *
 * 「日号 + 星期」与进度条之间的间距（0.026h ≈ 11.4px）是内部那道的两倍：
 * 两道同取 0.012h（5.3px）时进度条紧贴「星期四」的字脚，通栏的条读起来
 * 成了那三个字的下划线。两级间距拉开一倍才分得清「今天是哪天」与「今年过了多少」。
 *
 * 不加底色：「次要背景」已经承担了星期头整块底、今日胶囊、进度条轨道三处，
 * 再铺第四块面会让这一档比其它六档都吵。
 */
.mt__today {
  display: flex;
  height: calc(var(--cal-h) * 0.26);
  flex: 0 0 auto;
  flex-direction: column;
  justify-content: center;
  gap: calc(var(--cal-h) * 0.026);
}

.mt__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: calc(var(--cal-w) * 0.04);
}

/* 日号与星期竖向叠放，左栏因此只占 66px（「星期四」比「27」宽） */
.mt__now {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: calc(var(--cal-h) * 0.012);
}

/* 0.095h = 41.6px，两档同值，是全块最大的字 */
.mt__day {
  color: var(--cal-text, var(--color-text));
  font-size: calc(var(--cal-h) * 0.095);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: 1;
}

.mt__wd {
  color: var(--cal-sub-text, var(--color-text-dim));
  font-size: calc(var(--cal-h) * 0.05);
  line-height: 1;
  white-space: nowrap;
}

/*
 * 最长态是三位数（1 月 1 日的「今年还剩 365 天」），位数已到上限。
 * 3×4 下右侧约 141px，与左栏 66px 相加 207px < 可用宽 238px。
 */
.mt__left {
  color: var(--cal-sub-text, var(--color-text-dim));
  font-size: calc(var(--cal-h) * 0.045);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

/*
 * 进度条。轨道取「次要背景」、填充取「主要文字」，
 * 4 项配色因此在这一档全部有落点，无需新增配置项。
 * 填充色偏亮但条只有 6px 高，读起来是一条细亮线而不是一块色带。
 *
 * 条位于方块纵向中部、不在任何角的弧内（--tile-radius-max 夹在 26px），
 * 两端距方格边 13.3 / 18.0px，安全。
 */
.mt__bar {
  height: calc(var(--cal-h) * 0.014);
  overflow: hidden;
  border-radius: 999px;
  background: var(--cal-sub-bg, var(--widget-band-bg));
}

.mt__fill {
  height: 100%;
  border-radius: inherit;
  background: var(--cal-text, var(--color-text));
}

/*
 * 网格吃掉今日区之外的全部高度，不再自己封顶。
 *
 * 计划书原打算给它 min(0.95w, 0.58h) 的上限、余量归今日区，实测两处不对：
 * 4×4 的行高反被撑到 35.3px（4×3 是 32.5px），而今日区只分到 85.6px 却需要 86.3px。
 * 改成「今日区定高、网格吃余量」后行高落在 36.6（3×4）/ 30.6（4×4），
 * 对上 3×3 的 36.5、4×3 的 32.5 —— 3×4 几乎一致，4×4 矮 1.9px（6%）。
 * 这 1.9px 消不掉：星期头占 1.9×字号而字号按宽算，4×4 的头比 3×4 高 11px，
 * 同样的网格高度下行高必然更短；要抹平就得让今日区高度掺进宽度，
 * 那就破了「纵向按 --cal-h 算」这条分工，为 6% 的差异不值得。
 *
 * 封顶之所以在原 --tall 里是必需的，是因为那时网格要吃掉刊头以外的全部 400px；
 * 今日区拿走 114px 之后剩下的 261px 本就落在合适区间，不需要第二道限制。
 *
 * 分隔线只有这一条。刊头与今日区之间不画线——438px 高的方块里两条横线
 * 会开始像一张表格，而 13px 的刊头与 41.6px 的日号之间三倍的字号落差
 * 本身就是分界。这也与 stack 一致，那一档同样是唯一一条 border-top。
 */
.mt__grid {
  --cal-grid-font: calc(var(--cal-w) * 0.062);
  --cal-grid-gap: 0.2em;
  min-height: 0;
  padding-top: calc(var(--cal-w) * 0.035);
  border-top: 1px solid var(--tile-border);
}
</style>

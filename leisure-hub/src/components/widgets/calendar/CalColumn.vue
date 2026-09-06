<script setup lang="ts">
import { computed } from 'vue'

import CalDotGrid from './CalDotGrid.vue'
import CalWeekRail from './CalWeekRail.vue'
import type { CalendarView } from './dateGrid'

const props = defineProps<{
  view: CalendarView
  /** 2..4，决定追加到哪个时间尺度 */
  spanH: number
}>()

/**
 * 三档共用一列带，每高一档追加一个更粗的时间尺度：
 * 今日（三档都有）→ 本周 → 本月 → 本年（三档都有）。
 *
 * 1×2（75×196）放不下 7 行竖排（每行 15px 不可读），改用一行圆点表达本周；
 * 1×3 起换成竖排 7 行；1×4 再多出 121px，够在下方补一片 6×7 点阵。
 *
 * 结构不分叉成「有条 / 无条」两种形态：三者同属一档同一个组件，
 * 某一档单独换层级会让相邻两档看起来像换了个组件。
 */
const showRail = computed(() => props.spanH >= 3)
const showMonth = computed(() => props.spanH >= 4)

/**
 * 剩余天数与年度进度就地算，不进 CalendarView：
 * 两者都由 dayOfYear / yearDays 一步推出，放进 view 会有两份真值源。
 * 与 CalMonthTall 里的同两行重复，但抽成共享函数要动那个已验证过像素的组件，
 * 为一次减法与一次除法不值得。
 */
const daysLeft = computed(() => props.view.yearDays - props.view.dayOfYear)

/** 0..100，直接喂给进度条的 width 百分比 */
const progress = computed(() => (props.view.dayOfYear / props.view.yearDays) * 100)
</script>

<template>
  <div class="col" aria-hidden="true">
    <!--
      月份条。与底部年份条对称，把内容夹在中间——纸质日历牌最易辨识的那个形，
      且没有引入第四种块面（用的仍是既有的「次要背景」）。

      月份升为刊头而非日号下方一行暗字：它每月都变、决定日号的含义，
      与 monthTall 同一条层级规则（年份一年才变一次，降级到底部）。
      阅读顺序因此回正：月 → 日 → 星期。

      周数写「35 周」而非 monthTall 的「第 35 周」：61.5px 的条内宽度里，
      最长态「12 月 53 周」已占 45.6px，省掉「第」字换来 9px 余量。
    -->
    <div class="col__band col__band--month">
      <span class="col__m">{{ view.month }} 月</span>
      <span class="col__wk">{{ view.week }} 周</span>
    </div>

    <!--
      今日区。日号与星期是一个单元，与 monthTall 的今日区同构。

      星期改用「主要文字」色：原先它与月份同色、字号只差 0.75px，
      是两行同级的暗字把日号夹在中间；现在月份进了条、星期留在正文，
      颜色与位置双重区分，不必再靠字号差。
    -->
    <div class="col__now">
      <span class="col__day">{{ view.day }}</span>
      <span class="col__wd">{{ view.weekdayText }}</span>
    </div>

    <!--
      本周。h=2 只放得下一行圆点（5.25px 高），h≥3 换成七行「星期 + 日号」。
      两者是同一件事的两种密度，不是两块内容，因此互斥而非并存。
    -->
    <CalWeekRail v-if="showRail" class="col__rail" :week="view.currentWeek" vertical />
    <CalDotGrid v-else class="col__week-dots" :rows="[view.currentWeek]" />

    <!-- 本月。只有 1×4 放得下：7 列各 9px 铺满 63px 可用宽，6 行共 54px -->
    <CalDotGrid v-if="showMonth" class="col__month-dots" :rows="view.grid" />

    <!--
      本年。三档都有——它只要 14.6px，1×2 也放得下，
      且恰是与顶部月份条、底部年份条呼应的那一项。

      选年度进度而非农历 / 节气 / 倒计时，理由同 monthTall：零依赖、纯函数、
      可确定。农历要查表数据，倒计时要动持久化结构。
    -->
    <div class="col__year-progress">
      <span class="col__left">剩 {{ daysLeft }} 天</span>
      <div class="col__bar">
        <div class="col__fill" :style="{ width: `${progress}%` }"></div>
      </div>
    </div>

    <span class="col__band col__band--year">{{ view.year }}</span>
  </div>
</template>

<style scoped>
/*
 * 纵向余量按 space-between 均分到带与带之间，而不是全汇到某一个 flex: 1 的块。
 *
 * 这是改动的要点：原先 .col__main 是唯一 flex: 1 的块，1×2 与 1×4 的
 * 105px / 127px 余量都汇到它一处，成了一块死白。摊成四五道 9..19px 的
 * 带间距后，同样的高度变成版面节奏，最大单块空白降到 19px。
 *
 * 全部尺寸按 --cal-w 算而非 --cal-h：三档等宽（都是 75px）不等高，
 * 按高算会让 1×4 的日号比 1×2 大一倍以上，而它们真正相同的恰是横向空间。
 * 这与 monthTall「两档等高、纵向按 --cal-h 算」是同一条推理的镜像。
 */
.col {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  justify-content: space-between;
  gap: calc(var(--cal-w) * 0.12);
}

/* 两条条块的共性：通栏、定高、次要背景 */
.col__band {
  display: flex;
  height: calc(var(--cal-w) * 0.3);
  flex: 0 0 auto;
  align-items: center;
  background: var(--cal-sub-bg, var(--widget-band-bg));
  color: var(--cal-text, var(--widget-band-text));
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

/*
 * 条内左右内边距 6.75px。
 *
 * 圆角在这一档是 min(0.22 × 75, 26) = 16.5px，条通栏贴边，
 * 文字在条内纵向居中（字顶约 y=5.8），该高度上圆弧横向切入 4.4px < 6.75px，
 * 因此两端的字不会碰到弧线。
 */
.col__band--month {
  justify-content: space-between;
  padding: 0 calc(var(--cal-w) * 0.09);
  gap: calc(var(--cal-w) * 0.04);
}

.col__m {
  font-size: calc(var(--cal-w) * 0.145);
  font-weight: 600;
  white-space: nowrap;
}

/* 周数是这一条里信息量较低的一项，收一档并降为次要文字 */
.col__wk {
  color: var(--cal-sub-text, var(--color-text-dim));
  font-size: calc(var(--cal-w) * 0.095);
  white-space: nowrap;
}

/*
 * 年份条。
 *
 * text-indent 抵掉 letter-spacing：字距加在最后一个字之后，
 * 不补这一下，居中的文字会整体偏左半个字距。
 */
.col__band--year {
  justify-content: center;
  font-size: calc(var(--cal-w) * 0.19);
  letter-spacing: 0.04em;
  text-indent: 0.04em;
}

.col__now {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  gap: calc(var(--cal-w) * 0.03);
}

/*
 * 0.54w：两位数占 44.6px，两侧各余 9.2px。
 * 原先的 0.46w 只占 38px —— 竖条里最该占满宽度的那一项没占满。
 */
.col__day {
  color: var(--cal-text, var(--color-text));
  font-size: calc(var(--cal-w) * 0.54);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: 1;
}

.col__wd {
  color: var(--cal-text, var(--color-text));
  font-size: calc(var(--cal-w) * 0.145);
  line-height: 1;
  white-space: nowrap;
}

/*
 * 竖排本周条吃剩余高度，但封顶 2.5w（187.5px）。
 *
 * 不封顶时 1×4 的行高会涨到 37px，CalWeekRail 的注释已写过：
 * 高亮块被拉成贯穿整格的竖块时看起来像一根滚动条。
 * 封顶后行高落在 24.0（1×3）/ 26.8（1×4）px，是字号的 2.1..2.4 倍，
 * 今日胶囊呈横向药丸形；余下的高度回落给 space-between。
 *
 * 与相邻带之间不画分隔线：75px 宽的方格里一条横线会把内容切得更碎，
 * 而顶部月份条与底部年份条两块面本身已经界定了正文区。
 */
.col__rail {
  --rail-font: calc(var(--cal-w) * 0.15);
  min-height: 0;
  flex: 1 1 auto;
  max-height: calc(var(--cal-w) * 2.5);
}

/*
 * 1×2 的本周：一行圆点，只占 5.25px。点比竖排小一档，它在这里是概览而非读数。
 *
 * 直径取 max(...) 兜一个像素下限：编辑面板的预览把令牌整套缩到一半
 * （--tile-size 38px），0.05w 只剩 1.9px，落在半像素上会被渲染成一排短横线
 * 而不是圆点。桌面上的 3.75px 不受这个下限影响。
 */
.col__week-dots {
  --dot-size: max(2px, calc(var(--cal-w) * 0.05));
  --dot-today-size: max(3px, calc(var(--cal-w) * 0.07));
  height: calc(var(--cal-w) * 0.07);
  flex: 0 0 auto;
  padding: 0 calc(var(--cal-w) * 0.08);
}

/*
 * 本月点阵：6 行 × 9px = 54px，7 列 × 9px 正好铺满可用宽 63px。
 * 高度定死而非 flex：交给 flex 的话 1×4 会把它拉成 6 行各 30px 的稀疏点阵，
 * 「一个月的形状」这件事就读不出来了。
 *
 * 直径下限同 --week-dots：预览里 0.05w 只剩 1.9px，半像素会把 42 个点
 * 渲染成一片短横线，那是这一档最容易被当成 bug 的一处。
 */
.col__month-dots {
  --dot-size: max(2px, calc(var(--cal-w) * 0.05));
  --dot-today-size: max(3px, calc(var(--cal-w) * 0.07));
  height: calc(var(--cal-w) * 0.72);
  flex: 0 0 auto;
  padding: 0 calc(var(--cal-w) * 0.08);
}

.col__year-progress {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  padding: 0 calc(var(--cal-w) * 0.08);
  gap: calc(var(--cal-w) * 0.045);
}

/* 最长态是「剩 365 天」（1 月 1 日），约 35.8px < 可用宽 63px */
.col__left {
  color: var(--cal-sub-text, var(--color-text-dim));
  font-size: calc(var(--cal-w) * 0.115);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

/*
 * 进度条。轨道取「次要背景」、填充取「主要文字」，与 monthTall 同一套语义，
 * 4 项配色因此在这一档也全部有落点。
 * 距方格底部 43..46px，远在 16.5px 的圆角弧之外。
 */
.col__bar {
  width: 100%;
  height: calc(var(--cal-w) * 0.05);
  overflow: hidden;
  border-radius: 999px;
  background: var(--cal-sub-bg, var(--widget-band-bg));
}

.col__fill {
  height: 100%;
  border-radius: inherit;
  background: var(--cal-text, var(--color-text));
}
</style>

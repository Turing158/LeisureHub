<script setup lang="ts">
import type { WeekRow } from './dateGrid'
import { WEEKDAY_LABELS } from './dateGrid'

defineProps<{
  week: WeekRow
  /**
   * 竖排：星期与日号并排成一行，7 行纵向排列。
   *
   * column 版式只有 75px 宽，横排 7 列每列 10px 放不下两位数，
   * 只能把「七格」这件事从横轴转到纵轴。
   */
  vertical?: boolean
}>()
</script>

<template>
  <!--
    可访问名由外壳的 .sr-only 单独提供，这里整块隐藏。
    否则读屏会把本周七个日号逐个念进方格名里。
  -->
  <div class="rail" :class="{ 'rail--v': vertical }" aria-hidden="true">
    <div
      v-for="(cell, i) in week.days"
      :key="cell.key"
      class="rail__cell"
      :class="{ 'is-today': cell.isToday, 'is-outside': cell.offset !== 0 }"
    >
      <!-- days 恒为周一起的 7 项，下标即星期，无需再从日期反算 -->
      <span class="rail__wd">{{ WEEKDAY_LABELS[i] }}</span>
      <span class="rail__day">{{ cell.day }}</span>
    </div>
  </div>
</template>

<style scoped>
/*
 * 尺寸不在这里算：字号读父级定义的 --rail-font，格子横向用 1fr 均分父级给的宽。
 * 同一个条在 strip 里横跨 90px、在 panel 里横跨 170px、在 column 里竖跨 140px，
 * 把比例写死在这里就得为每个调用方开一个覆写口。
 */
.rail {
  display: grid;
  /*
   * align-content 而非默认的 stretch：行高交给内容决定后整行在纵向居中。
   * 拉伸的话今日胶囊会被撑成贯穿整个方格高度的一条竖块——
   * 在 75px 高的 strip 里它看起来像一根滚动条。
   */
  align-content: center;
  grid-template-columns: repeat(7, 1fr);
  font-size: var(--rail-font, calc(var(--cal-size) * 0.11));
  line-height: 1;
}

/* 竖排反过来：7 行要吃掉给定的高度，所以这里恢复 1fr 均分 */
.rail--v {
  align-content: stretch;
  grid-template-columns: 1fr;
  grid-template-rows: repeat(7, 1fr);
}

.rail__cell {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  /*
   * 横向留白靠 margin 而非 padding：格子是 1fr 均分的，
   * 不内缩的话今日高亮会与左右邻格贴死，看起来像一条通栏色带而不是一个块。
   */
  margin: 0 0.18em;
  padding: 0.3em 0;
  /*
   * 圆角矩形而非 999px 胶囊：胶囊会把窄格的两端抽成半圆，
   * 与方格本身的圆角语言不一致。
   *
   * 具体值读 --cal-active-radius（定义在 CalendarWidget 的 .cal 上），
   * 与月历网格的今日块共用；它是 em，各版式仍按当地字号等比。
   */
  border-radius: var(--cal-active-radius, 0.3em);
  color: var(--cal-sub-text, var(--color-text-dim));
  gap: 0.3em;
}

/* 竖排时星期与日号并排，纵向省一半高度 */
.rail--v .rail__cell {
  flex-direction: row;
  justify-content: center;
  /*
   * 竖排只有 75px 宽，格子横跨整个方格：留白必须比横排给得多，
   * 否则高亮块会从方格的一边贴到另一边，读起来像整行被选中而非「今天」。
   * 竖向留一点点，相邻两行的高亮块不至于连成一片。
   */
  margin: 0.12em 0.9em;
  /* 行高由 1fr 决定，这里不再加竖向 padding，让高亮块吃满一行 */
  padding: 0;
  /*
   * 不再单独放大圆角（原为 0.7em）。这一档的块确实比横排高，按块高看
   * 0.3em 显得偏方，但「今天」在八个版式里必须是同一个圆角，
   * 一档一个数就成了八份真值源；统一到 --cal-active-radius。
   */
  gap: 0.5em;
}

/* 非本月：降透明度而不换色，--color-text-dim 本身已是 rgba，再叠一层色会失控 */
.rail__cell.is-outside {
  opacity: 0.4;
}

/*
 * 今日胶囊：实心块面 + 主要文字色。
 * 用「次要背景」这一项而非另开配置，它在各版式里的语义统一为「被强调的面」。
 */
.rail__cell.is-today {
  background: var(--cal-sub-bg, var(--widget-band-bg));
  color: var(--cal-text, var(--color-text));
}

.rail__day {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
</style>

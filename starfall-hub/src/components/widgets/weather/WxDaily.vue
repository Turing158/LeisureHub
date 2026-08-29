<script setup lang="ts">
import { computed } from 'vue'

import WxIcon from './WxIcon.vue'
import type { WeatherDay } from './types'

const props = defineProps<{
  /** 完整的逐日序列，含今天；本组件自行跳过第 0 项 */
  days: WeatherDay[]
  /** 取几天（从明天算起） */
  count: number
  /**
   * 横排：每天一列，「星期 / 图标 / 高低温」三行竖叠。
   * grid 与 split(4×2) 用；其余档位竖排。
   */
  row?: boolean
  /** 竖排时是否画降水概率条。只有 full 的整宽行放得下 */
  pop?: boolean
  /**
   * 画天气图标。
   *
   * column 一档要关掉：那里一行只有 61.5px，而冬季的最长态
   * 「五 ☁ -32/-42」需要 70px。图标是这一行里唯一的装饰项——
   * 星期与高低温都是读数，所以砍它。§6 的逐日横向账本来也没算图标。
   */
  icon?: boolean
}>()

/**
 * 从明天起取 count 天。
 *
 * 跳过今天：今日高低温已由各版式的 L2 单独占着一行，
 * 在列表里再列一遍是空转的一行，而这一档的纵向像素恰恰最紧。
 */
const list = computed(() => props.days.slice(1, 1 + props.count))
</script>

<template>
  <div class="daily" :class="{ 'daily--row': row }" aria-hidden="true">
    <div v-for="(day, i) in list" :key="i" class="daily__item">
      <span class="daily__label">{{ day.label }}</span>
      <WxIcon v-if="icon" class="daily__icon" :name="day.icon" />

      <!--
        降水概率条只在 full 出现：整宽的一行才有它的位置。
        概率同时给条与数字，不靠长度单独表达——0% 与 5% 的条几乎一样长。
      -->
      <span v-if="pop" class="daily__pop">
        <span class="daily__bar">
          <span class="daily__fill" :style="{ width: `${day.pop}%` }"></span>
        </span>
        <span class="daily__popnum">{{ day.pop }}%</span>
      </span>

      <span class="daily__temp">
        <span class="daily__high">{{ day.high }}</span>
        <span class="daily__sep">/</span>
        <span class="daily__low">{{ day.low }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
/*
 * 竖排（默认）：一行一天，余量由 space-between 均分到行与行之间。
 * 行高不定死：stack 的 h=3 与 h=4 给出的高度差一倍，
 * 定死行高会在 h=4 时把整块列表堆到顶部、下方留一片死白。
 */
.daily {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  justify-content: space-between;
}

.daily__item {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--wx-daily-gap, 6px);
}

/*
 * 单字标签定宽 1.3em：不定宽时「今」「三」与「—」的字宽差会让整列图标错位，
 * 而这一列是竖排列表里唯一能对齐的视觉锚点。
 */
.daily__label {
  flex: none;
  width: 1.3em;
  color: var(--wx-sub-text, var(--color-text-dim));
  font-size: var(--wx-fs-daily, 11px);
  line-height: 1;
  text-align: center;
}

.daily__icon {
  --wx-icon: var(--wx-daily-icon, 14px);
  /* 逐日图标一律 ≤24px，取最粗那一档 */
  --wx-stroke: 2;
  color: var(--wx-text, var(--color-text));
}

/* 温度靠右：高低温是这一行的读数，右对齐后各行的数字位对齐 */
.daily__temp {
  display: flex;
  flex: none;
  align-items: baseline;
  margin-left: auto;
  color: var(--wx-text, var(--color-text));
  font-size: var(--wx-fs-daily, 11px);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  gap: 0.15em;
}

/* 低温降为次要文字：一行里两个同样醒目的数字读不出哪个是高 */
.daily__low {
  color: var(--wx-sub-text, var(--color-text-dim));
}

.daily__sep {
  color: var(--wx-sub-text, var(--color-text-dim));
  opacity: 0.6;
}

/* ── 降水概率（仅 full） ────────────────────────────── */

.daily__pop {
  display: flex;
  flex: none;
  align-items: center;
  gap: 0.4em;
}

.daily__bar {
  display: block;
  width: var(--wx-pop-w, 28px);
  height: var(--wx-pop-h, 4px);
  overflow: hidden;
  border-radius: var(--r-full);
  background: var(--wx-sub-bg, var(--widget-band-bg));
}

.daily__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--wx-text, var(--color-text));
}

/* 定宽 2.4em：0% 与 100% 之间切换时右侧的高低温不左右挪 */
.daily__popnum {
  width: 2.4em;
  color: var(--wx-sub-text, var(--color-text-dim));
  font-size: var(--wx-fs-daily, 11px);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  text-align: right;
}

/* ── 横排 ───────────────────────────────────────────── */

/*
 * 每天一列，三行竖叠。等分列而非 flex 自适应：
 * 各列内容宽度不同（「30/23」比「9/1」宽），自适应会让列间距参差，
 * 而这一带在 grid 一档是横贯整宽的，参差立刻可见。
 *
 * column-gap 是必需的，不是装饰。等分列的宽度由容器决定，与内容无关：
 * 冬季最长态「-28 / -38」在 4×2 的 41px 列里正好占满，相邻两列的数字
 * 会直接贴在一起读成「-28/-38-29/-39」。留一道列间距后内容自行截断，
 * 而截断看得出来、贴死看不出来。
 */
.daily--row {
  display: grid;
  flex-direction: row;
  column-gap: var(--wx-daily-col-gap, 4px);
  grid-auto-columns: 1fr;
  grid-auto-flow: column;
}

.daily--row .daily__item {
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  gap: var(--wx-daily-gap, 3px);
}

.daily--row .daily__label {
  width: auto;
}

.daily--row .daily__temp {
  min-width: 0;
  margin-left: 0;
  /* 列宽不够时整组截断，而不是把「/-38」挤到下一列旁边 */
  overflow: hidden;
}
</style>

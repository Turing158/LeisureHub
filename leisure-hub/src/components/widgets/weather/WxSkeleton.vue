<script setup lang="ts">
import { computed } from 'vue'

import type { WeatherStatus } from './useWeather'

const props = defineProps<{
  /** 只会传 unset / loading / error 三种；ready 由各版式自己渲染 */
  status: WeatherStatus
  /**
   * 是否显示文案。
   *
   * micro（1×1，75×75）与 strip 的图标块里放不下任何一句话，
   * 只画符号；其余档位都给文字。不给文字时符号相应放大。
   */
  text?: boolean
}>()

/**
 * 未配置态用定位针、失败态用叹号。
 *
 * 定位针而非齿轮：齿轮画成「圆 + 八道短辐」后与 clearDay 的太阳几乎一模一样
 * （那个图标就是圆 + 八道光芒），在未配置的方块上看起来像「今天晴」。
 * 而带齿廓的实心轮在 22px 下齿间只有 1px，描边一叠就糊成实心块，
 * 又破了「单色线性」这条。定位针与 11 个天气字形都不撞，且直接指向要填的东西。
 *
 * 失败态不靠颜色单独表达（`color-only`）：符号 + 文案两者都在，
 * `--danger` 只在文案色上点一下。
 */
const SHAPES = {
  unset:
    'M12 21.5s7-6.2 7-11.2a7 7 0 1 0-14 0c0 5 7 11.2 7 11.2z' +
    'M12 7.6a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4z',
  error: 'M12 4.5v9.5M12 18.3v.2',
} as const

const shape = computed(() => (props.status === 'error' ? SHAPES.error : SHAPES.unset))

/**
 * 文案按行给，而不是交给自动换行。
 *
 * 中文默认可在任意字之间断行，`text-wrap: balance` 会为了两行等长而
 * 断在「编 / 辑」中间——读起来像掉了一个字。行的切分点是语义的，
 * 这件事 CSS 判断不了，所以在这里定死。
 */
const LINES = {
  unset: ['右键 → 编辑', '设置地点'],
  error: ['暂时取不到'],
} as const

const lines = computed<readonly string[]>(() => {
  if (props.status === 'unset') return LINES.unset
  if (props.status === 'error') return LINES.error
  return []
})
</script>

<template>
  <!--
    三态共享一个外观。
    分成三个组件的话，「符号 + 一句话 + 居中」这套结构要写三遍，
    而它们的差别只有符号、文案与是否呼吸。

    骨架必须与实际内容同尺寸（内容跳动）：三个块的高度按各版式给的
    --wx-skel-* 算，与温度 / 天气词 / 高低温同一套比例，出数据时布局不跳。
  -->
  <div class="skel" :class="[`skel--${status}`, { 'skel--mute': !text }]" aria-hidden="true">
    <template v-if="status === 'loading'">
      <span class="skel__block skel__block--icon"></span>
      <span class="skel__block skel__block--temp"></span>
      <span v-if="text" class="skel__block skel__block--text"></span>
    </template>

    <template v-else>
      <svg class="skel__glyph" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path :d="shape" />
      </svg>
      <span v-if="text" class="skel__msg">
        <span v-for="line in lines" :key="line" class="skel__line">{{ line }}</span>
      </span>
    </template>
  </div>
</template>

<style scoped>
.skel {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 var(--wx-skel-pad, 8px);
  gap: var(--wx-skel-gap, 6px);
  text-align: center;
}

/* ── 加载中 ─────────────────────────────────────────── */

/*
 * 三个填充块的尺寸直接用各版式给的比例，而不另起一套：
 * 骨架与真内容不同高，会在出数据的那一帧把整块布局顶一下。
 */
.skel__block {
  border-radius: var(--r-sm);
  background: var(--fill-raised);
}

.skel__block--icon {
  width: var(--wx-icon, 24px);
  height: var(--wx-icon, 24px);
  border-radius: var(--r-full);
}

/*
 * 两个文字块的高度直接等于对应字号，不乘系数。
 *
 * 所有放温度与天气词的地方都是 line-height: 1，所以它们的盒高就是字号本身
 * （实测 2×2：字号 51px、.temp 盒高 51px）。原先乘 0.78 是按「字形比行高矮」
 * 推的，但排版占的是盒子不是字形，那样骨架会比真内容矮 11px。
 */
.skel__block--temp {
  width: var(--wx-skel-temp-w, 48px);
  height: var(--wx-fs-temp, 24px);
}

.skel__block--text {
  width: var(--wx-skel-text-w, 36px);
  height: var(--wx-fs-word, 14px);
}

/*
 * 呼吸动画。
 *
 * 不在这里写 prefers-reduced-motion：style.css 里 html[data-motion='off'] 一档
 * 已把全站的 animation-duration 压到 0.01ms 且迭代一次，
 * 而那一档是设置 store 把系统偏好折算之后的结果。
 * 在这里另写一份媒体查询会让设置里的「始终开启」被系统偏好反悔掉。
 */
.skel__block {
  animation: skel-pulse 1.6s var(--ease) infinite;
}

@keyframes skel-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

/* ── 未配置 / 失败 ──────────────────────────────────── */

.skel__glyph {
  display: block;
  width: var(--wx-icon, 24px);
  height: var(--wx-icon, 24px);
  flex: none;
  color: var(--wx-sub-text, var(--color-text-dim));
}

.skel__glyph path {
  fill: none;
  stroke: currentColor;
  stroke-width: var(--wx-stroke, 1.6);
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* 无文案时符号放大：它是这一档里唯一的内容，按图标尺寸画会显得空 */
.skel--mute .skel__glyph {
  width: calc(var(--wx-icon, 24px) * 1.4);
  height: calc(var(--wx-icon, 24px) * 1.4);
}

.skel__msg {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--wx-sub-text, var(--color-text-dim));
  font-size: var(--wx-skel-msg, 11px);
  gap: 0.25em;
  line-height: 1.25;
}

/* 每行独立不换行：宽度不够时整行截断，而不是断在词中间 */
.skel__line {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * 失败文案点一下 --danger，但不靠颜色单独承载信息：
 * 叹号与「暂时取不到」这句话在没有颜色时同样完整。
 */
.skel--error .skel__msg {
  color: var(--danger);
}
</style>

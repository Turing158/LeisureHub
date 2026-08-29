<script setup lang="ts">
import WxIcon from './WxIcon.vue'
import WxTemp from './WxTemp.vue'
import type { WeatherView } from './types'

defineProps<{ view: WeatherView; stale?: boolean; place: string }>()
</script>

<template>
  <!--
    2×2，170×196。defaultSpan 这一档。

    170px 宽下图标与温度可以并排（图标 0.2w = 34px + 「27°」约 92px = 126px
    < 可用 156px），这是 2×2 与 1×2 的唯一结构差别。
  -->
  <div class="panel" aria-hidden="true">
    <!-- 刊头两端对齐：地点在左、天气词在右，与 CalPanel 的年月 / 星期同构 -->
    <div class="panel__head">
      <span class="panel__place">{{ place }}</span>
      <span class="panel__word">{{ view.text }}</span>
    </div>

    <div class="panel__main">
      <WxIcon class="panel__icon" :name="view.icon" />
      <WxTemp :value="view.temp" :stale="stale" />
    </div>

    <!--
      底条写全「最高 / 最低」而非「31/24」：这一档有 156px 可用，
      斜杠形只在窄档里是不得已。
    -->
    <div class="panel__band">
      <span class="panel__pair">最高 {{ view.high }}</span>
      <span class="panel__pair">最低 {{ view.low }}</span>
    </div>
  </div>
</template>

<style scoped>
/*
 * 横向的量按 --wx-w，与 CalPanel 一致（两档同宽不同高时才需要按高算，
 * 而 panel 只覆盖 2×2 这一种形状）。
 */
.panel {
  --wx-fs-temp: calc(var(--wx-w) * 0.3);
  --wx-stroke: 1.6;

  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  padding-top: calc(var(--wx-w) * 0.05);
}

/*
 * 刊头的左右缩进明显大于其它块。
 *
 * 它贴着方格顶部，两端的字正落在圆角切走的那一块里：圆角在这一档是 26px，
 * 0.06 的缩进只有 10px，地点名的首字与天气词的末字会碰到弧线。
 * 0.11 后两端各有 19px，与弧线拉开——与 CalPanel 的页眉同一条账。
 */
.panel__head {
  display: flex;
  min-width: 0;
  flex: 0 0 auto;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 calc(var(--wx-w) * 0.11);
  color: var(--wx-sub-text, var(--color-text-dim));
  font-size: calc(var(--wx-w) * 0.08);
  line-height: 1;
  gap: calc(var(--wx-w) * 0.04);
}

/* 地点名可任意长，截断；天气词最长 3 字，不参与压缩 */
.panel__place {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel__word {
  flex: none;
  white-space: nowrap;
}

.panel__main {
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: calc(var(--wx-w) * 0.05);
}

.panel__icon {
  --wx-icon: calc(var(--wx-w) * 0.2);
  color: var(--wx-text, var(--color-text));
}

/* 底条与 CalPanel 的年份条同高同色，只换了内容 */
.panel__band {
  display: flex;
  height: calc(var(--wx-w) * 0.17);
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  background: var(--wx-sub-bg, var(--widget-band-bg));
  color: var(--wx-text, var(--widget-band-text));
  font-size: calc(var(--wx-w) * 0.1);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  gap: calc(var(--wx-w) * 0.08);
}

.panel__pair {
  white-space: nowrap;
}
</style>

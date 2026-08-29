<script setup lang="ts">
import WxIcon from './WxIcon.vue'
import WxTemp from './WxTemp.vue'
import type { WeatherView } from './types'

defineProps<{ view: WeatherView; stale?: boolean }>()
</script>

<template>
  <!--
    1×1，75×75。

    图标与温度竖向叠放而非并排：并排时「27°」在 25.5px 字号下约 46px，
    加上 22.5px 的图标已是 68.5px，超出可用宽 63px。

    底部条沿用日历 micro 的年份条位置与高度——两个组件在 1×1 这一档
    共用同一个形，方格阵里换组件不换骨架。
  -->
  <div class="micro" aria-hidden="true">
    <div class="micro__main">
      <WxIcon class="micro__icon" :name="view.icon" />
      <WxTemp :value="view.temp" :stale="stale" />
    </div>

    <!--
      底部条。低温降为次要文字——这既是 WxDaily 里同一条处理
      （一行里两个同样醒目的数字读不出哪个是高），也让「次要文字」这一项
      在 1×1 这一档有落点：micro 没有天气词，否则四项配色里它会空转。
    -->
    <span class="micro__band">
      {{ view.high }}<span class="micro__sep">/</span><span class="micro__low">{{ view.low }}</span>
    </span>
  </div>
</template>

<style scoped>
/*
 * 全部按 --wx-size（短边）算，不按 --wx-w / --wx-h：
 * 1×1 与日历 micro 必须像素一致，而日历那一档也是按短边取的。
 */
.micro {
  --wx-fs-temp: calc(var(--wx-size) * 0.34);
  /* 22.5px 上 1.6 的描边已开始发虚，取最粗那一档 */
  --wx-stroke: 2;

  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
}

.micro__main {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: calc(var(--wx-size) * 0.02);
}

.micro__icon {
  --wx-icon: calc(var(--wx-size) * 0.3);
  color: var(--wx-text, var(--color-text));
}

/* 与日历 micro 的年份条同高同色，只换了内容 */
.micro__band {
  display: flex;
  height: calc(var(--wx-size) * 0.26);
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  background: var(--wx-sub-bg, var(--widget-band-bg));
  color: var(--wx-text, var(--widget-band-text));
  font-size: calc(var(--wx-size) * 0.15);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

/*
 * 低温与斜杠取次要文字色。
 * 缺省时用 --widget-band-text 的半透明版而非 --color-text-dim：
 * 这条带的底色是「次要背景」，暗色文字令牌是按面板底推的，压在这块更亮的面上
 * 只有 3:1 左右。
 */
.micro__sep,
.micro__low {
  color: var(--wx-sub-text, rgb(255 255 255 / 0.7));
}

.micro__sep {
  padding: 0 0.1em;
}
</style>

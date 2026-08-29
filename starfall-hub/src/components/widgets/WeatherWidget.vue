<script setup lang="ts">
import { computed } from 'vue'

import WxColumn from './weather/WxColumn.vue'
import WxFull from './weather/WxFull.vue'
import WxGrid from './weather/WxGrid.vue'
import WxMicro from './weather/WxMicro.vue'
import WxPanel from './weather/WxPanel.vue'
import WxSkeleton from './weather/WxSkeleton.vue'
import WxSplit from './weather/WxSplit.vue'
import WxStack from './weather/WxStack.vue'
import WxStrip from './weather/WxStrip.vue'
import { useWeather } from './weather/useWeather'
import { weatherVariant } from './weather/variant'
import type { WeatherPlace } from './weather/types'
import { clampSpan } from '@/types/tile'
import { isHexColor } from '@/utils/color'

const props = defineProps<{
  /** 地点名，仅用于显示；缺省时 L3 那一行留空 */
  place?: string
  /** 纬度 −90..90，由 sanitizeWidgetProps 校验并成对保证 */
  lat?: number
  /** 经度 −180..180 */
  lon?: number
  /** 方格底色；缺省沿用方格自身的玻璃底 */
  bgColor?: string
  /** 次要块面：图标块、顶条底条、逐日区的分隔面 */
  subBgColor?: string
  /** 主要文字：温度、天气词、高低温 */
  textColor?: string
  /** 次要文字：地点、时刻标签、指标名、降水概率 */
  subTextColor?: string
  /**
   * 占格宽 / 高，由 TileWidget 透传。
   * 缺省按 1×1 处理，因此只覆写了 --content-size 的调用方也能渲染出 micro。
   */
  spanW?: number
  spanH?: number
}>()

/** 版式由占格形状唯一决定，像素换算仍全在 CSS 里 */
const variant = computed(() => weatherVariant(props.spanW, props.spanH))

/** 子组件按占格数做局部取舍（如折线是否带时刻标签），走同一个夹取入口 */
const span = computed(() => ({ w: clampSpan(props.spanW), h: clampSpan(props.spanH) }))

/**
 * 地点。
 *
 * lat / lon 缺一即视为未配置：sanitizeWidgetProps 的 finalize 钩子已保证
 * 持久化数据里两者成对，但编辑面板的预览会在用户填一半时就渲染，
 * 那条路径不经过 store，所以这里是第二道。
 */
const place = computed<WeatherPlace | undefined>(() => {
  if (typeof props.lat !== 'number' || typeof props.lon !== 'number') return undefined
  if (!Number.isFinite(props.lat) || !Number.isFinite(props.lon)) return undefined
  return { lat: props.lat, lon: props.lon, name: props.place }
})

const { view, status, stale } = useWeather(place)

/**
 * 颜色写成内联的 CSS 变量而非直接的 color / background，与日历同构。
 *
 * 变量没被设上时，样式里的 `var(--wx-text, <令牌>)` 自动回落到主题令牌，
 * 「未配置」与「配成当前主题色」因此是两种状态——前者跟着主题走。
 *
 * 仍要过一遍 isHexColor：这些值来自持久化数据，store 已校验过，
 * 这里是第二道，防止将来有别的写入路径绕过它。
 */
const colorStyle = computed(() => {
  const vars: Record<string, string> = {}
  const set = (name: string, value: string | undefined) => {
    if (isHexColor(value)) vars[name] = value
  }
  set('--wx-bg', props.bgColor)
  set('--wx-sub-bg', props.subBgColor)
  set('--wx-text', props.textColor)
  set('--wx-sub-text', props.subTextColor)
  return vars
})

/** 地点名在版式里出现多次，统一在这里给出「没配名字」时的占位 */
const placeName = computed(() => props.place?.trim() || '当前位置')

/**
 * 可访问名。
 *
 * 只有一句完整描述，逐时逐日的数字都不进来：八个版式各自在根节点写
 * aria-hidden，否则 full 一档的 7 天 × 4 个数字会全部念进方格名里。
 *
 * 刻意不加 aria-live：温度是异步更新的，但一个装饰性的桌面组件每 15 分钟
 * 朝读屏播报一次温度是骚扰。内容随数据更新即可，用户主动聚焦时读到的就是最新值。
 */
const fullText = computed(() => {
  if (status.value === 'unset') return '天气：未设置地点'
  if (status.value === 'loading') return `${placeName.value} 天气加载中`
  const data = view.value
  if (!data) return `${placeName.value} 天气暂时取不到`
  const prefix = stale.value ? '（数据陈旧）' : ''
  return `${prefix}${placeName.value} ${data.text} ${data.temp} 度，最高 ${data.high} 最低 ${data.low}`
})
</script>

<template>
  <div class="wx" :title="fullText" :style="colorStyle">
    <span class="sr-only">{{ fullText }}</span>

    <!--
      有数据就渲染版式（哪怕已陈旧）：陈旧值仍比空白有用，
      陈旧标记由各版式在温度旁点一个 0.5 透明度的小点表达。

      用 v-if 链而不是 <component :is="MAP[variant]">：
      后者会让 vue-tsc 放弃检查子组件的 props，而这里每档传的东西都不同。
    -->
    <template v-if="view">
      <WxMicro v-if="variant === 'micro'" :view="view" :stale="stale" />
      <WxStrip
        v-else-if="variant === 'strip'"
        :view="view"
        :stale="stale"
        :span-w="span.w"
      />
      <WxColumn
        v-else-if="variant === 'column'"
        :view="view"
        :stale="stale"
        :span-h="span.h"
        :place="placeName"
      />
      <WxPanel v-else-if="variant === 'panel'" :view="view" :stale="stale" :place="placeName" />
      <WxSplit
        v-else-if="variant === 'split'"
        :view="view"
        :stale="stale"
        :span-w="span.w"
        :place="placeName"
      />
      <WxStack
        v-else-if="variant === 'stack'"
        :view="view"
        :stale="stale"
        :span-h="span.h"
        :place="placeName"
      />
      <WxGrid
        v-else-if="variant === 'grid'"
        :view="view"
        :stale="stale"
        :span-w="span.w"
        :place="placeName"
      />
      <WxFull v-else :view="view" :stale="stale" :span-w="span.w" :place="placeName" />
    </template>

    <!--
      三态共享外观。micro / strip 不给文案：75px 高的格子里放不下一句话，
      只画符号；其余档位都带文字，「未配置」那一档必须自解释。
    -->
    <WxSkeleton
      v-else
      :class="`wx__skel wx__skel--${variant}`"
      :status="status"
      :text="variant !== 'micro' && variant !== 'strip'"
    />
  </div>
</template>

<style scoped>
/*
 * 三个尺寸基准，与日历同一套换算与同一条回落链：
 *   --wx-w / --wx-h  真实宽高，由 TileCell 的 --square-w / --square-h 继承而来。
 *   --wx-size        短边，micro / strip 按它取（1×1 与日历同形，必须同尺寸）。
 *
 * 注意：拖拽浮层把 --tile-size 设成 min(w, h)，所以各版式一律不得直接读它，
 * 只能读这三个别名，否则浮层里非正方形的方块会变形。
 */
.wx {
  --wx-w: var(--square-w, var(--content-size, var(--tile-size)));
  --wx-h: var(--square-h, var(--content-size, var(--tile-size)));
  --wx-size: var(--content-size, var(--tile-size));

  /* .sr-only 是绝对定位的，没有定位祖先时会逃到初始包含块（Dialog 预览里就没有） */
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  /* 未配置时 --wx-bg 未定义，透出方格自身的玻璃底 */
  background: var(--wx-bg, transparent);
  border-radius: inherit;
  user-select: none;
}

/* 版式组件是唯一的 flex 子项，铺满除 .sr-only 以外的全部空间 */
.wx > :not(.sr-only) {
  min-width: 0;
  min-height: 0;
  flex: 1;
}

/*
 * 三态外观的尺寸。
 *
 * 图标与三个块按短边给，而不按各版式自己的比例：状态占位不该在 4×1 里
 * 被拉成一条扁图标，而三态里最要紧的是「尺寸预留住、出数据时不跳」。
 *
 * --wx-fs-temp 取 0.3 × 短边：这正是 panel（defaultSpan、也是唯一必须
 * 自解释的一档）的温度比例，实测两者盒高都是 51px。其余档位的温度比例
 * 各不相同（column 0.4w、grid 0.127w……），骨架不为每档各配一套——
 * 那要么把八档的比例抄第二遍，要么让 WxSkeleton 认识版式，两者都比
 * 「主读数在最常见的一档上严格对齐」代价更大。
 */
.wx__skel {
  --wx-icon: calc(var(--wx-size) * 0.3);
  --wx-stroke: 1.6;
  --wx-fs-temp: calc(var(--wx-size) * 0.3);
  --wx-fs-word: calc(var(--wx-size) * 0.08);
  --wx-skel-temp-w: calc(var(--wx-size) * 0.6);
  --wx-skel-text-w: calc(var(--wx-size) * 0.42);
  --wx-skel-msg: clamp(9px, calc(var(--wx-size) * 0.115), 13px);
  --wx-skel-gap: calc(var(--wx-size) * 0.08);
  --wx-skel-pad: calc(var(--wx-size) * 0.1);
}

/* 1×1 的符号按 2 档描边：22px 上 1.6 已经开始发虚 */
.wx__skel--micro,
.wx__skel--strip {
  --wx-stroke: 2;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  border: 0;
  margin: -1px;
  padding: 0;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>

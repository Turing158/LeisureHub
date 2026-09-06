<script setup lang="ts">
import { computed } from 'vue'

import { useSettingsStore } from '@/stores/settings'

type DurToken = 'fast' | 'base'

const props = defineProps<{
  /** 过渡名；对应的 *-enter-* / *-leave-* 规则写在被包裹浮层自己的 scoped 样式里 */
  name: string
  /**
   * 过渡时长令牌，仅当浮层把 transition 挂在根元素的**后代**上时才需要传。
   *
   * Vue 只在插槽根元素上探测时长，根上没有 transition 就判定「没有过渡」并立即收场——
   * 退场元素被同步卸载，关闭动画根本来不及播。
   * 传入的令牌须与该浮层 scoped 样式里用的 --dur-* 一致；
   * 不传则沿用 Vue 自己的探测（transition 就写在根元素上的浮层适用）。
   */
  duration?: DurToken
}>()

const settings = useSettingsStore()

/** 样式表尚未生效时的兜底，正常路径下不会用到 */
const FALLBACK_MS: Record<DurToken, number> = { fast: 140, base: 240 }

/**
 * 把 --dur-* 令牌读成毫秒。
 *
 * 时长仍以 style.css 的令牌为唯一来源，这里只换算单位；
 * 若在组件里另写一份 240 这样的字面量，改令牌时必然漏改一处。
 */
function tokenMs(token: DurToken): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--dur-${token}`).trim()
  const parsed = Number.parseFloat(raw)
  // 240ms 与 0.24s 两种写法都接受
  const ms = raw.endsWith('ms') ? parsed : parsed * 1000
  return Number.isFinite(ms) && ms > 0 ? ms : FALLBACK_MS[token]
}

/**
 * 动效关闭时换成一个没有任何 CSS 规则的过渡名。
 *
 * 只靠 style.css 把 duration 归零也能收场，但 Vue 仍要跑完整轮 class 切换和计时，
 * 卸载会被推迟；换掉名字后它探测不到过渡时长，直接同步挂载 / 卸载。
 */
const transitionName = computed(() => (settings.motionEnabled ? props.name : 'no-motion'))

/**
 * 显式时长只在调用方传了令牌且动效开启时给出。
 *
 * 动效关闭时必须回到 undefined 而不是 0：0 会走 setTimeout 分支，把卸载推到下一个
 * 宏任务；undefined 才让 Vue 探测到「无过渡」并同步收场。
 */
const durationMs = computed(() =>
  props.duration && settings.motionEnabled ? tokenMs(props.duration) : undefined,
)
</script>

<template>
  <!--
    Teleport 在 Transition 外层：Transition 的进出场 class 要落在插槽内容的根元素上，
    浮层组件若自带 Teleport，它的根就成了传送门而不是可加 class 的元素。
    class 落在子组件根元素上，而该元素同时带着子组件的 scoped 标记，
    所以过渡规则仍然写在各浮层自己的 <style scoped> 里。
  -->
  <Teleport to="body">
    <Transition :name="transitionName" :duration="durationMs">
      <slot />
    </Transition>
  </Teleport>
</template>

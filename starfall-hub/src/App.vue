<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import AppBackground from './components/AppBackground.vue'
import TileGrid from './components/TileGrid.vue'
import SettingsDrawer from './components/settings/SettingsDrawer.vue'
import SettingsHandle from './components/settings/SettingsHandle.vue'
import { useSettingsStore } from '@/stores/settings'

const settings = useSettingsStore()
const settingsOpen = ref(false)

/**
 * 遮罩磨砂半径随背景模糊递减。
 *
 * 背景自己已经糊到 20px 以上时，遮罩再叠一层几乎看不出差别，
 * 而代价是实打实的：backdrop-filter 要读回的正是那张被外扩到视口 + 4×blur 的表面。
 *
 * 阶梯按 --glass-scrim 的基准值（10px）分档，最高档直接归零——
 * 0 会让 blur(0px) 等价于不模糊，省掉整条合成链。
 */
const scrimBlurRadius = computed(() => {
  const bg = settings.effectiveBlur
  if (bg >= 20) return 0
  if (bg >= 8) return 6
  return 10
})


/*
 * 写到 <html> 而不是 .app 上：浮层被 Teleport 到 body，
 * 挂在 .app 的自定义属性传不到它们身上。
 */
watch(
  scrimBlurRadius,
  (radius) => {
    document.documentElement.style.setProperty('--scrim-blur-radius', `${radius}px`)
  },
  { immediate: true },
)
</script>

<template>
  <main class="app">
    <!--
      背景独占若干层，不画在 .app 上。
      模糊必须只作用于背景自身——挂到 .app 会把方格和抽屉一起糊掉，
      而且 filter 会生成新的包含块，让浮层的 position: fixed 相对它定位而非视口。
      多背景轮换与交叉淡入的状态都收在这个组件里，见 AppBackground.vue。
    -->
    <AppBackground />

    <div class="app__content">
      <TileGrid @open-settings="settingsOpen = true" />
    </div>

    <!--
      手柄与抽屉同读设置里的 drawerSide，停靠侧始终一致。

      抽屉打开时摘掉手柄的磨砂而不是整个卸载它：--z-handle 低于 --z-drawer，
      带 backdrop-filter 的它会落进遮罩要读回的背景里，白多一级串行合成。
      但卸载会让抽屉存下的 restoreTarget 指向已脱离文档的按钮，关闭后焦点丢回 body，
      所以只摘效果、保留元素。反正此刻它压在 blur(16px) 的遮罩下，看不出差别。
    -->
    <SettingsHandle :flat="settingsOpen" @open="settingsOpen = true" />
    <SettingsDrawer :open="settingsOpen" @close="settingsOpen = false" />
  </main>
</template>

<style scoped>
.app {
  position: relative;
  height: 100%;
  overflow: hidden;
  /* 背景未就绪与模糊外扩时透出的底色 */
  background: var(--bg-base);
}

/* 定位 + z-index 抬到背景之上：同一层叠上下文里，带 z-index 的绝对定位层会盖住普通流内容 */
.app__content {
  position: relative;
  z-index: 1;
  height: 100%;
}
</style>

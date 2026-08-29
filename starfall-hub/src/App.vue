<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import TileGrid from './components/TileGrid.vue'
import SettingsDrawer from './components/settings/SettingsDrawer.vue'
import SettingsHandle from './components/settings/SettingsHandle.vue'
import { useSettingsStore } from '@/stores/settings'

const settings = useSettingsStore()
const settingsOpen = ref(false)

const isImage = computed(() => settings.hasBgImage)

/**
 * 背景独占一层，不画在 .app 上。
 *
 * 模糊必须只作用于背景自身——挂到 .app 会把方格和抽屉一起糊掉，
 * 而且 filter 会生成新的包含块，让浮层的 position: fixed 相对它定位而非视口。
 */
const bgStyle = computed(() => {
  const blur = settings.effectiveBlur
  return {
    ...settings.backgroundStyle,
    filter: blur > 0 ? `blur(${blur}px)` : undefined,
    // 模糊会让边缘一圈变透明露出底色，向外扩张两倍半径补掉
    inset: blur > 0 ? `-${blur * 2}px` : '0',
  }
})

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
    <!-- 背景层：纯色 / 网络图片 + 模糊，纯装饰不参与命中 -->
    <div class="app__bg" :style="bgStyle" aria-hidden="true" />

    <!--
      噪点只在纯色底上叠：壁纸自带纹理，再加颗粒只会显脏。
      与被替换掉的辉光层同一个条件，图片模式仍走下面的压暗层。
    -->
    <div v-if="!isImage" class="app__grain" aria-hidden="true" />
    <!-- 图片底则改为压暗，保证白字与方格描边在任意壁纸上都可读 -->
    <div v-else class="app__dim" aria-hidden="true" />


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
  /* 图片加载前与模糊外扩时透出的底色 */
  background: var(--bg-base);
}

.app__bg,
.app__grain,
.app__dim {
  position: absolute;
  z-index: 0;
  pointer-events: none;
}

.app__grain,
.app__dim {
  inset: 0;
}

/*
 * 噪点。
 *
 * 大面积纯色在 8 位色深下会出现色带，且观感偏塑料；一层几乎不可见的
 * 颗粒就能消掉这两点，代价只有一个内联 data URI。
 *
 * 刻意不用 mix-blend-mode: overlay——overlay 在 base < 0.5 时是
 * 2 × base × blend，底色亮度只有 0.055，噪点会被压到看不见。
 * 普通混合 + 极低 opacity 才能真正提亮像素，也顺带避开了
 * mix-blend-mode 建立层叠上下文与 backdrop root 的副作用。
 *
 * baseFrequency 取 0.8：更低会聚成云雾状色块，更高在高 DPR 屏上
 * 被下采样成均匀灰，两头都失去颗粒感。
 */
.app__grain {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
  opacity: 0.035;
}

/*
 * 图片底的压暗层。
 *
 * 0.55 是按最坏情况（纯白壁纸）定的下限：白色名称文字在这个底上对比度约 4.5:1，
 * 再浅就压不住白墙照片。方格与抽屉都是深色面板，这一层同时保住了它们的描边可见性。
 */
.app__dim {
  background: rgb(6 6 8 / 0.55);
}


/* 定位 + z-index 抬到背景之上：同一层叠上下文里，带 z-index 的绝对定位层会盖住普通流内容 */
.app__content {
  position: relative;
  z-index: 1;
  height: 100%;
}
</style>

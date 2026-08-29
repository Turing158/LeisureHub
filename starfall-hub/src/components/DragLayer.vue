<script setup lang="ts">
import TileIcon from './TileIcon.vue'
import TileWidget from './TileWidget.vue'
import { tileSpan, type Tile } from '@/types/tile'

const props = defineProps<{
  tile: Tile
  x: number
  y: number
  /** 源方格的实际宽高：跨格方块不是正方形，不能只传一个边长 */
  w: number
  h: number
  scale: number
  /** 落位阶段：给坐标与缩放挂过渡，形成飞向目标格的动画 */
  settling: boolean
}>()

/** 组件按占格数选版式，浮层里的样子才与网格里一致 */
const span = tileSpan(props.tile)
</script>

<template>
  <Teleport to="body">
    <div
      class="drag-layer"
      :class="{ 'is-settling': settling }"
      :style="{
        left: `${x}px`,
        top: `${y}px`,
        width: `${w}px`,
        height: `${h}px`,
        transform: `scale(${scale})`,
        '--tile-size': `${Math.min(w, h)}px`,
        '--content-size': `${Math.min(w, h)}px`,
        /* 组件的版式要按真实宽高换算，只给短边的话跨格方块会变形 */
        '--square-w': `${w}px`,
        '--square-h': `${h}px`,
      }"
      aria-hidden="true"
    >
      <TileWidget
        v-if="tile.kind === 'widget'"
        :widget-id="tile.widgetId"
        :name="tile.name"
        :widget-props="tile.props"
        :span-w="span.w"
        :span-h="span.h"
      />
      <TileIcon
        v-else
        :name="tile.name"
        :icon="'icon' in tile ? tile.icon : undefined"
        :bg-color="'bgColor' in tile ? tile.bgColor : undefined"
      />
    </div>
  </Teleport>
</template>

<style scoped>
.drag-layer {
  position: fixed;
  z-index: var(--z-drag);
  /* 组件内容会画到边缘（日历的年份条贴底），不裁就会顶出圆角 */
  overflow: hidden;
  border: 1px solid var(--tile-border);
  border-radius: min(
    calc(var(--content-size) * var(--tile-radius-ratio)),
    var(--tile-radius-max)
  );
  background: var(--tile-bg-hover);
  box-shadow: var(--shadow-lg);
  pointer-events: none;
}

.drag-layer.is-settling {
  transition:
    left var(--dur-base) var(--ease),
    top var(--dur-base) var(--ease),
    transform var(--dur-base) var(--ease),
    box-shadow var(--dur-base) var(--ease);
  /* 落位时阴影收到零：写全三个长度值才能与 --shadow-lg 逐项插值 */
  box-shadow: 0 0 0 rgb(0 0 0 / 0);
}
</style>

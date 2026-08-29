<script setup lang="ts">
import TileIcon from '../TileIcon.vue'
import { RECOMMEND_ITEMS } from '@/data/recommend'
import type { TileDraft } from '@/types/tile'

const emit = defineEmits<{
  pick: [draft: TileDraft]
}>()
</script>

<template>
  <ul class="recommend">
    <li v-for="item in RECOMMEND_ITEMS" :key="item.name">
      <button class="card" type="button" @click="emit('pick', item)">
        <span class="card__icon">
          <TileIcon
            :name="item.name"
            :icon="'icon' in item ? item.icon : undefined"
            :bg-color="'bgColor' in item ? item.bgColor : undefined"
          />
        </span>
        <span class="card__meta">
          <span class="card__name">{{ item.name }}</span>
          <span class="card__sub">{{ 'url' in item ? item.url : '内置组件' }}</span>
        </span>
      </button>
    </li>
  </ul>
</template>

<style scoped>
.recommend {
  display: grid;
  min-height: 200px;
  align-content: start;
  margin: 0;
  padding: 0;
  gap: var(--sp-2);
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  list-style: none;
}

.card {
  display: flex;
  width: 100%;
  align-items: center;
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--fill);
  gap: var(--sp-3);
  text-align: left;
  transition:
    background-color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}

/* hover 用中性描边：--accent 只留给「已选中」这类状态，悬停不是状态 */
.card:hover {
  border-color: var(--line-strong);
  background: var(--fill-raised);
}

.card__icon {
  /* TileIcon 的字号依赖 --tile-size，这里给一个卡片内的局部值 */
  --tile-size: 44px;
  display: block;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  border-radius: var(--r-md);
  background: var(--tile-bg);
}

.card__meta {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.card__name {
  font-size: var(--fs-base);
}

.card__sub {
  overflow: hidden;
  color: var(--color-text-dim);
  font-size: var(--fs-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

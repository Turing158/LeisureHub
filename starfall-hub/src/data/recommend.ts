import type { TileDraft } from '@/types/tile'

/**
 * 「推荐」tab 的数据源。
 *
 * v0.1 只有一个测试方块，用于打通「点空格 → Dialog → 选推荐 → 落格 → 可拖拽 → 刷新仍在」
 * 这条完整链路，之后再扩充真实推荐内容。
 */
export const RECOMMEND_ITEMS: TileDraft[] = [
  {
    kind: 'link',
    name: '测试方块',
    url: 'https://example.com',
    icon: '🧪',
    bgColor: '#4f46e5',
  },
]

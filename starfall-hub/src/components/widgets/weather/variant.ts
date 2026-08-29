import { clampSpan } from '@/types/tile'

/**
 * 天气的八种版式。
 *
 * 与日历同一套形状切分，但**刻意不与 calendarVariant 共用一个函数**：
 * 两者都在同一组像素预算下追求最大信息密度，因而落到同一条边界，但这是巧合。
 * 天气的逐时折线在 95px 宽里就可读（日历的 7 列两位数需要 265px），
 * 所以天气完全可能想把某条边界往下挪；抽成共享函数要动那个已验证过像素的
 * calendar/variant.ts，还会把两个组件的版式演化绑在一起。
 * 等第三个组件也落到同一切分时再抽。
 *
 * 写成字符串联合而非 enum：tsconfig 开了 erasableSyntaxOnly，enum 会编译失败。
 */
export type WeatherVariant =
  | 'micro' // 1×1　　　　图标 + 温度 + 高低温条
  | 'strip' // h=1, w≥2　横排，w≥3 追加逐时折线
  | 'column' // w=1, h≥2　竖排，顶条地点 + 底条高低温
  | 'panel' // 2×2　　　　刊头 + 图标温度并排 + 底条
  | 'split' // w≥3, h=2　左右分栏，右侧逐时
  | 'stack' // w=2, h≥3　上下分层，下方逐日
  | 'grid' // w≥3, h=3　刊头 + 指标 + 折线 + 逐日横排
  | 'full' // w≥3, h≥4　同 grid，逐日竖排 7 行 + 日出日落

/**
 * 由占格尺寸解析版式。
 *
 * 判定顺序与日历一致：先排除退化形状（单行 / 单列没有第二个维度可用），
 * 再按面积升级。八个分支对 16 种形状完备且互斥（1+3+3+1+2+2+2+2 = 16）。
 *
 * 入参是 unknown 而非 number：调用方可能传 undefined（TileWidget 的可选 prop）
 * 或 NaN（编辑表单里 Number('')），统一交给 clampSpan 这个既有的唯一入口夹取。
 */
export function weatherVariant(spanW: unknown, spanH: unknown): WeatherVariant {
  const w = clampSpan(spanW)
  const h = clampSpan(spanH)

  if (w === 1 && h === 1) return 'micro'
  // 单行：高只有 75px，纵向放不下两段以上的结构
  if (h === 1) return 'strip'
  // 单列：宽只有 75px，逐时只能竖排
  if (w === 1) return 'column'
  // 2×2 是图标与温度第一次放得下并排的形状
  if (w === 2 && h === 2) return 'panel'
  // h=2 只有 196px 高，逐时必须横放在主信息旁边
  if (h === 2) return 'split'
  // w=2 只有 170px 宽，逐时折线放不下，改为下方逐日列表
  if (w === 2) return 'stack'
  // h=4 多出 121px，逐日从横排改成竖排 7 行，并能容下降水概率条与日出日落
  if (h >= 4) return 'full'
  // w≥3 且 h=3
  return 'grid'
}

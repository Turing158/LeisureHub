import { clampSpan } from '@/types/tile'

/**
 * 日历的八种版式。
 *
 * 由占格形状唯一决定，不掺入像素阈值：像素是 TileCell 从同样这两个整数
 * 算出来的（--square-w / --square-h），在这里再按像素分档就成了第二份真值源。
 *
 * 写成字符串联合而非 enum：tsconfig 开了 erasableSyntaxOnly，enum 会编译失败。
 */
export type CalendarVariant =
  | 'micro' // 1×1
  | 'strip' // h=1, w≥2　横排
  | 'column' // w=1, h≥2　竖排
  | 'panel' // 2×2
  | 'split' // w≥3, h=2　左右分栏
  | 'stack' // w=2, h≥3　上下分层
  | 'monthTall' // w≥3, h≥4　今日区 + 整月网格
  | 'month' // w≥3, h=3　整月网格

/**
 * 由占格尺寸解析版式。
 *
 * 判定顺序即「先排除退化形状，再按面积升级」：
 * 单行 / 单列没有第二个维度可用，必须先于任何网格版式判掉，
 * 否则 1×4 会落进按面积算的 column 之外的分支。
 *
 * 八个分支对 16 种形状完备且互斥（1+3+3+1+2+2+2+2 = 16）。
 *
 * 入参是 unknown 而非 number：调用方可能传 undefined（TileWidget 的可选 prop）
 * 或 NaN（编辑表单里 Number('')），统一交给 clampSpan 这个既有的唯一入口夹取，
 * 不在这里重写一遍 1..SPAN_MAX 的规则。
 */
export function calendarVariant(spanW: unknown, spanH: unknown): CalendarVariant {
  const w = clampSpan(spanW)
  const h = clampSpan(spanH)

  if (w === 1 && h === 1) return 'micro'
  // 单行：高只有 75px，纵向放不下任何两段以上的结构，只能横着铺
  if (h === 1) return 'strip'
  // 单列：宽只有 75px，横排 7 列必然不可读，只能竖着铺
  if (w === 1) return 'column'
  // 2×2 是能容纳「页眉 + 大日期 + 本周」的最小形状
  if (w === 2 && h === 2) return 'panel'
  // h=2 只有 196px 高，整月网格必须横着放在日期块旁边
  if (h === 2) return 'split'
  // w=2 只有 170px 宽，整月网格只能压成 24px 列宽放在下方
  if (w === 2) return 'stack'
  // h=4 的两种形状（265×438、360×438）纵向多出近 120px，
  // 够在整月网格之上再放一个「今日」带；h=3 放不下，仍走 month
  if (h >= 4) return 'monthTall'
  // w≥3 且 h=3：宽度够 7 列各 37.8px，网格可以当主角
  return 'month'
}

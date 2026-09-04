import { clampSpan } from '@/types/tile'

/**
 * 倒计时的四种版式。
 *
 * **比待办还少一档。** todo/variant.ts 立的判据（同质内容不需要为「多几行」开分支）
 * 在这里更强：倒计时的内容是**一个数字加两条副信息**，空间变大时它不换构成，
 * 只是字号变大、副信息从省略变成显示。
 *
 * 真正需要分档的只有两个问题：
 *
 *   1. 放得下**数字和单位并排**吗？（要 w ≥ 2；w=1 时必须竖着摞）
 *   2. 放得下**标签行 + 日期行**吗？（要 h ≥ 2）
 *
 * 两个二元问题 = 四档，对 16 种形状完备且互斥（1 + 3 + 3 + 9 = 16）。
 *
 * panel 一档吃掉 9 种形状（2×2 到 4×4）是刻意的：那 9 种形状里的差别全部是
 * 「同一份内容更大或更小」，而**这件事 clamp() / calc() 已经在做**。为它们再开
 * 分支就是 search/variant.ts 否掉过的那个 wide 档——「与 stack 的样式逐条相同，
 * 那个分支不表达任何取舍」。
 *
 * **strip 内部有两种构成，但没有分成两档。** w=2 竖向摞两行、w≥3 横向分三段
 * （主组 | 连接线 | 副栏），由组件里的 `stripStacked` 与一个 `--stacked` 修饰类分。
 * 判据是「一行放不下主组 + 日期」而不是「内容变了」：两边说的是同一件事、
 * 用的是同一组内容槽（dateYear / dateMd / dateWeekday）、同一个 --cd-cap，
 * 只有排布方向不同。而版式档要为「内容的构成」负责——上面那两个二元问题
 * 在 w=2 与 w=4 上答案完全一致，硬分出第五档会让 countdownVariant 多一个
 * 不表达取舍的分支（正是 wide 那条判据要挡的）。
 *
 * 写成字符串联合而非 enum：tsconfig 开了 erasableSyntaxOnly，enum 会编译失败。
 */
export type CountdownVariant =
  | 'micro' // 1×1　　　　数字 + 单位，竖排两行
  | 'strip' // h=1, w≥2　w=2 两行居中；w≥3 主组 | 连接线 | 三行副栏
  | 'column' // w=1, h≥2　竖排：前缀 / 数字+单位 / 竖线 / 页脚
  | 'panel' // w≥2, h≥2　标签 + 大数字 + 目标日期

/**
 * 由占格形状解析版式。
 *
 * 入参走 clampSpan 的默认 1..SPAN_MAX：倒计时**不进 WIDGET_SPAN_LIMITS**，两轴都是
 * 1..4，和日历 / 天气 / 待办一样；也**不进 WIDTH_FOLLOWS_GRID**。tile.ts 因此一个字
 * 都不用改，这正是「16 种形状都可用」的来源。
 *
 * 入参是 unknown 而非 number：调用方可能传 undefined（TileWidget 的可选 prop）
 * 或 NaN（编辑表单里 Number('')），统一交给 clampSpan 这个既有的唯一入口夹取。
 */
export function countdownVariant(spanW: unknown, spanH: unknown): CountdownVariant {
  const w = clampSpan(spanW)
  const h = clampSpan(spanH)
  if (w === 1 && h === 1) return 'micro'
  if (h === 1) return 'strip'
  if (w === 1) return 'column'
  return 'panel'
}

/**
 * 自定义文字是否在这一档显示。
 *
 * **只有 panel 档画**（w≥2 且 h≥2，即 9/16 的形状）。三个排除理由：
 *   - micro（1×1）：59px 可用宽放不下有意义的文字，且纵向已经挤满数字 + 单位
 *   - strip（h=1, w≥2）：纵向只有一行的量。改成双区构成后重新量过两条路，
 *     都不成立：塞进右侧副栏，4×1 只剩 72px ≈ 4 个可见字（「项目上…」，
 *     正是 .cd__column 那段说不要的碎片）；放主组上方，主字被迫从 44 压到 36px，
 *     而 3×1 的长标题照旧横向溢出 6px
 *   - column（w=1, h≥2）：59px 可用宽同样放不下，而纵向已经在画前缀 / 数字 / 页脚
 *
 * panel 档把自定义文字放在**首行**（原本前缀行的位置之上）：
 *   - 2×2 及以上纵向有余量（扣掉前缀 / 数字 / 日期三行，h=2 实得 127px / h≥3 更宽裕）
 *   - 横向至少 170px，装得下两行标题式的短句
 *   - 代价由数字的纵向上界承担（--cd-cap 从 80 降到 72，量出来仍然够用）
 */
export function showsCustomText(variant: CountdownVariant): boolean {
  return variant === 'panel'
}

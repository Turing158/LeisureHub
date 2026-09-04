import { clampSpan } from '@/types/tile'

/**
 * 待办的五种版式。
 *
 * **不复用日历 / 天气那八档。** weather/variant.ts 的文件头写着「等第三个组件也落到
 * 同一切分时再抽」，待办就是第三个组件，所以这里必须显式回答而不是默认继承。
 * 答案是不落到同一切分，理由是内容的性质不同：
 *
 * - 日历 / 天气的内容是**异质**的。年份条、星期轨、月历网格、逐时预报是不同的东西，
 *   各自在某些形状里出现、在另一些里消失。八个分支各自表达一个真实的构成取舍。
 * - 待办的内容是**同质**的——一列行。空间变大时它不需要换构成，只需要多几行，
 *   而「多几行」由 flex + overflow-y: auto 自然处理，不需要一个分支。
 *
 * search/variant.ts 留下的判据（「曾经按宽度再分出一档 wide，但它与 stack 的样式
 * 逐条相同，那个分支不表达任何取舍」）照用。按它，待办真正需要分档的只有三个问题：
 *
 *   1. 放得下一列**文字**吗？（要 w ≥ 2）
 *   2. 放得下**新建输入行**吗？（要 h ≥ 2）
 *   3. 放得下**分组标题 + 已完成折叠**吗？（要 h ≥ 3）
 *
 * 写成字符串联合而非 enum：tsconfig 开了 erasableSyntaxOnly，enum 会编译失败。
 */
export type TodoVariant =
  | 'count' // 1×1　　　只有未完成计数
  | 'latest' // h=1, w≥2　最近一条 + 计数徽标，单行
  | 'rail' // w=1, h≥2　计数 + 竖排点阵，无文字
  | 'list' // w≥2, h=2　计数条 + 列表 + 输入行
  | 'grouped' // w≥2, h≥3　分组标题 + 列表 + 已完成折叠 + 输入行

/**
 * 由占格形状解析版式。
 *
 * 计数：count 1 + latest 3 + rail 3 + list 3 + grouped 6 = **16**，
 * 与 calendar/variant.ts 那句「完备且互斥」同一种自我检查。
 *
 * 入参走 clampSpan 的默认 1..SPAN_MAX：待办**不进 WIDGET_SPAN_LIMITS**，两轴都是
 * 1..4，和日历 / 天气一样；也**不进 WIDTH_FOLLOWS_GRID**——那是搜索独有的「宽度
 * 跟随网格列数」，待办没有和网格列对齐的诉求。tile.ts 因此一个字都不用改，
 * 这正是「16 种形状都可用」的来源。
 *
 * 入参是 unknown 而非 number：调用方可能传 undefined（TileWidget 的可选 prop）
 * 或 NaN（编辑表单里 Number('')），统一交给 clampSpan 这个既有的唯一入口夹取。
 */
export function todoVariant(spanW: unknown, spanH: unknown): TodoVariant {
  const w = clampSpan(spanW)
  const h = clampSpan(spanH)
  if (w === 1 && h === 1) return 'count'
  if (h === 1) return 'latest'
  if (w === 1) return 'rail'
  if (h === 2) return 'list'
  return 'grouped'
}

/**
 * 该版式是否有新建输入行。
 *
 * count / latest / rail 三档都没有，纵向预算不允许：SearchWidget 的 .sw--bar 已经
 * 证明 h=1 那 75px 有多紧（10+4+32+22 = 68 of 75），一个 32px 的输入框加进来就
 * 没有别的了。硬塞只会把主角挤掉。
 *
 * 这也是注册表 defaultSpan 取 2×2 的理由：2×2 是最小的「落格即可用」形状——
 * 有输入行能录入。1×1 落格后是一个写着「已清空 / 0」的方块，用户不知道怎么加东西。
 */
export function hasInput(variant: TodoVariant): boolean {
  return variant === 'list' || variant === 'grouped'
}

/**
 * 该版式是否显示分组标题与已完成折叠区。
 *
 * 只有 grouped。list 那一档的列表实得 114px（起名 2×2），给折叠头 24px 就只剩
 * 90px 给未完成列表——把主角挤成 3 行去伺候配角。想看已完成的，把方块拉到 h≥3。
 */
export function hasGroups(variant: TodoVariant): boolean {
  return variant === 'grouped'
}

/**
 * rail 档是否画得下「近七天完成柱」（见 todo/history.ts）。
 *
 * 这是本文件唯一一个**按占格再分**的判据，看似违反上面「同质内容不分档」那条，
 * 其实正相反：柱图不是「多几行清单」，它是 rail 独有的第三层内容，
 * 而它的固定纵向开销可以量出来——标题 14 + 七行各 12 + 六个 2px 行距 + 上边距 7
 * ≈ 117px（实测 105~117，随字体行高浮动）。
 *
 * h=2 的两个高度是 222 / 196（起名 / 没起名，差 26px）。减去 padding 20、
 * 数字区 28、两处 gap 16 后余 158 / 132，再给柱图 117 只剩 41 / 15px 给点阵——
 * 15px 连**一行点**都不够（点 6px + 上下裁切）。那一档的主角（还剩几件）会被配角
 * 挤没，与 hasGroups 拒绝在 list 档放折叠区是同一次取舍。
 *
 * 所以柱图只在 h≥3 出现：343 / 317 减去同样的固定开销后，点阵仍有 150 上下、
 * 能排十几行点（实测 1×3 得 149、1×4 得 270）。想看回顾的把方块拉到 1×3。
 *
 * 入参是 unknown 而非 number，与 todoVariant 同一个理由（可选 prop / NaN）。
 */
export function railHasHistory(spanW: unknown, spanH: unknown): boolean {
  return todoVariant(spanW, spanH) === 'rail' && clampSpan(spanH) >= 3
}

/**
 * rail 档点阵**这一档画得下几个点**。
 *
 * 原先是 TodoRail 里一个写死的 MAX_DOTS = 96，那个数按 1×4 算的，于是 1×2 满载时
 * 多出来的三四十个点被 `.rail__dots` 的 `overflow: hidden` 直接裁掉——**裁掉的点
 * 看起来就是不存在的待办**，用户以为自己只有 55 件事，实际有 96 件。
 * 与其让最矮那一档静默丢一半，不如各档按自己的预算封顶。
 *
 * 三个数都是量出来的，不是推的（起名那一档更矮，取它作为下限）：
 *
 *   形状   点阵区高   每行   画得下
 *   1×2    141px      5      ~55
 *   1×3    135px      5      ~55   ← 柱图拿走 119px，所以和 1×2 差不多
 *   1×4    256px      5      ~105
 *
 * 每行 5 个、行距 12px（点 6 + gap 6）。取值各留一行余量，避免最后一行贴边被裁：
 * 1×2 / 1×3 给 50，1×4 给 100。
 *
 * **1×3 不比 1×2 多**：柱图吃掉的正好抵消了长出来的那一格。这不是巧合也不是缺陷，
 * 它就是「拿一部分空间换一个回顾」的代价，写在这里让这笔账是显式的。
 *
 * 封顶只影响**画几个点**，不影响任何计数：顶上那个数字读的是 activeCount 全量，
 * 所以「还剩几件」永远是准的，点阵只是它的一个粗略图示。
 */
export function railDotBudget(spanH: unknown): number {
  return clampSpan(spanH) >= 4 ? 100 : 50
}

/**
 * 整块点击是否直接打开完整待办对话框。
 *
 * 只有**宽 = 1** 那四种形状（count 与三档 rail）。判据不是「小」而是
 * **这一档有没有可点的控件**：
 *
 * - count（1×1）只有一个数字，rail 的点阵与柱图都刻意不可点（6px 的命中区在触屏上
 *   不可用）。这四档合起来正是「没有任何写操作」的那一片，整块可点不与任何东西抢。
 * - latest（h=1、w≥2）有一个可勾选的复选框，list / grouped 更有整列复选框、删除钮、
 *   输入行。在那些档上整块可点会让「勾掉一条」连带弹出对话框——一次点击两个后果，
 *   是最难解释的那类交互。它们走右上角那个显式的进入图标。
 *
 * 于是「点方块」在这四档里从**无反应**变成了「打开完整清单」。原先它们是死的：
 * TileGrid.activate 对 widget 只有一句「留待组件功能落地」的注释。
 *
 * 入参是 unknown 而非 number，与 todoVariant 同一个理由（可选 prop / NaN）。
 */
export function opensOnTileClick(spanW: unknown, spanH: unknown): boolean {
  const variant = todoVariant(spanW, spanH)
  return variant === 'count' || variant === 'rail'
}

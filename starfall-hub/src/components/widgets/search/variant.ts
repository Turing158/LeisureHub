import { clampSpan, widgetSpanLimits } from '@/types/tile'

const LIMITS = widgetSpanLimits('search')

/**
 * 搜索的两种版式。
 *
 * 与日历 / 天气同一套「由占格形状唯一决定」的做法，但只有两档：搜索方块的主体是
 * 一个输入框，占格范围本身也窄——宽 2..6、高 1..2（见 SEARCH_SPAN_LIMITS），
 * 共 10 种形状。
 *
 * **只由高度决定，宽度不参与。** 宽度的影响全部由 flex 自然处理：chips 在窄档位
 * 换行（stack）或横向滚动（bar），输入框跟着拉长。曾经按宽度再分出一档 `wide`，
 * 但它与 `stack` 的样式逐条相同，那个分支不表达任何取舍。
 *
 * 两档都摊开引擎 chips——75px 里塞下「输入行 + 一条 20px 的 chips」是够的，
 * 代价是 h=1 那一档不再「整块方格就是搜索框」（输入行要有自己的边界才分得清
 * 它和下面那条 chips）。两档的区别落在留白与溢出方向上：
 *
 * 写成字符串联合而非 enum：tsconfig 开了 erasableSyntaxOnly，enum 会编译失败。
 */
export type SearchVariant =
  | 'bar' // h=1　输入行 + 单行不换行的 chips（挤不下时横向滚动），留白按像素给死
  | 'stack' // h=2　整组置顶，chips 可换行，下方是「最近搜索」

/**
 * 由占格高度解析版式。
 *
 * 只接高度一个参数——宽度不参与判定（理由见上），所以不摆一个用不到的形参。
 *
 * 入参是 unknown 而非 number：调用方可能传 undefined（TileWidget 的可选 prop）
 * 或 NaN（编辑表单里 Number('')），统一交给 clampSpan 这个既有的唯一入口夹取，
 * 并且传的是**搜索自己的上下限**（1..2）而不是默认的 1..SPAN_MAX——
 * 旧存档里可能存着 3 或 4，用默认范围会原样放过去，落到下面 else 分支上
 * 虽然结果碰巧正确，但那是撞对的，不是判对的。
 */
export function searchVariant(spanH: unknown): SearchVariant {
  const h = clampSpan(spanH, LIMITS.hMin, LIMITS.hMax)
  return h === 1 ? 'bar' : 'stack'
}

/**
 * 该版式是否在输入框左侧画那个能打开引擎菜单的按钮。
 *
 * 只有 bar 画。两档都摊开了 chips，按此前的取舍（摊开时按钮就是同一个选择的
 * 第二处入口）本该都不画——但 bar 那一档的 chips **不能换行**：引擎最多 16 条
 * （内置 4 + 自定义 12），单行装不下时只能横向滚动，而滚动条为了不吃掉 20px 的
 * 行高被藏了起来，后几条就成了「在那里但看不见」。所以 bar 保留按钮当完整列表，
 * chips 退化为一排快捷方式。
 *
 * stack 的 chips 会换行并在内部纵向滚动，全部引擎都够得着，按钮才真的多余，
 * 此时只留一个不可点的图标当前缀，指明当前引擎。
 */
export function showsEngineToggle(variant: SearchVariant): boolean {
  return variant === 'bar'
}

/**
 * 该版式是否在下方展示「最近搜索」。
 *
 * 只有 stack。h=1 那 75px 装完输入行与 chips 已无余量，硬塞第三条带只能把
 * 每条压到十来像素，三条都读不清；而这块内容本就依赖 h=2 多出来的那八十来像素
 * （见 useSearchHistory 的 MAX_ITEMS 注释）。
 */
export function showsHistory(variant: SearchVariant): boolean {
  return variant === 'stack'
}

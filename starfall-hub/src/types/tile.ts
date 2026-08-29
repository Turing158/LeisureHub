import { SEARCH_SPAN_LIMITS } from './search'

/** 方格内容的种类，决定渲染方式与后续可编辑字段 */
export type TileKind = 'link' | 'widget'

/** 占格尺寸上限：默认网格只有 8 列 4 行，再大就会吃掉整屏 */
export const SPAN_MAX = 4

/** 一种内容允许的占格范围，两轴独立 */
export interface SpanLimits {
  wMin: number
  wMax: number
  hMin: number
  hMax: number
}

/** 链接与多数组件共用这一档：两轴都是 1..SPAN_MAX */
export const DEFAULT_SPAN_LIMITS: SpanLimits = {
  wMin: 1,
  wMax: SPAN_MAX,
  hMin: 1,
  hMax: SPAN_MAX,
}

/**
 * 按 widgetId 覆写占格范围。
 *
 * 放在这里而不是组件注册表（`data/widgets.ts`）里，与 `types/widgetProps.ts`
 * 的字段表同一个理由：store 的校验要读它，而注册表带着 Vue 组件实现，
 * 让校验层去 import 那些实现会把整棵组件树拖进来。
 *
 * 也刻意不通过提高 SPAN_MAX 来给搜索放宽——那会连带影响链接的尺寸控件、
 * 日历与天气那两张按 16 种形状推导的版式判定表，以及 grid.ts 的推挤。
 * 理由详见 SEARCH_SPAN_LIMITS 处的注释。
 */
const WIDGET_SPAN_LIMITS: Record<string, SpanLimits> = {
  search: SEARCH_SPAN_LIMITS,
}

interface TileBase {
  /** nanoid，拖拽与列表 key 使用 */
  id: string
  kind: TileKind
  /** 显示在方格下方的名称 */
  name: string
  /**
   * 占格宽 / 高。
   *
   * 范围由内容种类决定：链接与多数组件是 1..SPAN_MAX，搜索方块另有一组
   * （见 spanLimits）。缺省即两轴各自的下限，因此旧数据无需迁移——
   * 读出来是 undefined，按下限处理，「slots.length === cols * rows」
   * 这条不变量也不受影响。
   */
  spanW?: number
  spanH?: number
}

/** 自定义链接 */
export interface LinkTile extends TileBase {
  kind: 'link'
  url: string
  /** 图标 URL 或 emoji；缺省时由 name 首字母兜底 */
  icon?: string
  bgColor?: string
}

/** 内置组件 */
export interface WidgetTile extends TileBase {
  kind: 'widget'
  /** 对应内置组件注册表的 key */
  widgetId: string
  /**
   * 组件自身的配置（如日历的各处颜色）。
   *
   * 键名由 types/widgetProps.ts 按 widgetId 登记，store 读盘时逐键校验，
   * 因此这里是宽类型但落到组件手里的一定是白名单内的合法值。
   */
  props?: Record<string, unknown>
}

export type Tile = LinkTile | WidgetTile

/** 新建条目：id 由 store 补齐 */
export type TileDraft = Omit<LinkTile, 'id'> | Omit<WidgetTile, 'id'>

/**
 * 一个方块允许的占格范围。
 *
 * 入参写成两个可选字段而不是 `Tile` 联合类型：调用方手里有时是 Tile、有时是
 * TileDraft（没有 id）、有时只是 `{ spanW, spanH }` 这样的裸对象（拖拽浮层、
 * Dialog 预览）。收窄成联合类型会让那三种调用点各写一次断言。
 */
export function spanLimits(tile: { kind?: TileKind; widgetId?: string } | null | undefined): SpanLimits {
  if (tile?.kind === 'widget' && tile.widgetId) {
    return WIDGET_SPAN_LIMITS[tile.widgetId] ?? DEFAULT_SPAN_LIMITS
  }
  return DEFAULT_SPAN_LIMITS
}

/** 按 widgetId 直接取范围，供只拿到 id 的调用方（编辑表单）使用 */
export function widgetSpanLimits(widgetId: string): SpanLimits {
  return WIDGET_SPAN_LIMITS[widgetId] ?? DEFAULT_SPAN_LIMITS
}

/**
 * 把任意输入夹成合法的占格数。
 *
 * 两个可选参数默认回到 1..SPAN_MAX，因此**所有既有调用点行为不变**——
 * 只有明确知道自己在处理哪一种方块的地方（store 的写入与读盘、编辑表单、
 * 各组件的 variant 解析）才需要传范围。不给它强制加参数是刻意的：
 * 网格几何、拖拽浮层、落位计算拿到的是已经夹好的值，让它们各自再查一次范围
 * 只会多一处分叉。
 */
export function clampSpan(value: unknown, min = 1, max = SPAN_MAX): number {
  if (!Number.isInteger(value)) return min
  return Math.min(max, Math.max(min, value as number))
}

/**
 * 读取方块的占格尺寸。
 *
 * 所有消费方（store 的落位计算、TileCell 的几何、拖拽浮层）都走这一个入口，
 * 避免「缺省为下限」这条规则在各处重复实现。
 *
 * 两轴各按自己的上下限夹：搜索方块的宽下限是 2，缺省或脏数据里的 1 会被提到 2，
 * 否则会渲染出一个 75px 宽、连提示语都写不下的搜索框。
 */
export function tileSpan(
  tile: Pick<TileBase, 'spanW' | 'spanH'> & { kind?: TileKind; widgetId?: string },
): { w: number; h: number } {
  const limits = spanLimits(tile)
  return {
    w: clampSpan(tile.spanW, limits.wMin, limits.wMax),
    h: clampSpan(tile.spanH, limits.hMin, limits.hMax),
  }
}

/** 持久化结构 */
export interface GridState {
  /** schema 版本，为将来迁移留口 */
  version: 1
  cols: number
  rows: number
  /** 定长数组，length === cols * rows，空位为 null */
  slots: (Tile | null)[]
  /** 网格缩小时挤出的方块，等网格变大再放回 */
  overflow?: Tile[]
}

export const GRID_SCHEMA_VERSION = 1

import type { Component } from 'vue'

import CalendarWidget from '@/components/widgets/CalendarWidget.vue'
import SearchWidget from '@/components/widgets/SearchWidget.vue'
import WeatherWidget from '@/components/widgets/WeatherWidget.vue'
import type { TileDraft } from '@/types/tile'

/** 一个内置组件的注册信息 */
export interface WidgetDef {
  /** 持久化在 WidgetTile.widgetId 里的稳定 key，改名会让已放置的方块失效 */
  id: string
  /** Dialog 卡片上的名称，同时作为落格后的默认方格名 */
  name: string
  /** Dialog 卡片的说明文字 */
  desc: string
  /** 渲染方格内容的组件 */
  component: Component
  /** 新建时的默认占格；之后可在编辑里改成任意尺寸，与普通方格一致 */
  defaultSpan: { w: number; h: number }
}

/**
 * 内置组件注册表。
 *
 * 单一数据源：Dialog 的卡片列表、TileCell 的渲染分发、编辑器的字段都读这里，
 * 新增组件只需往数组里加一项，并在 types/widgetProps.ts 里登记它的字段表。
 */
export const WIDGETS: WidgetDef[] = [
  {
    id: 'calendar',
    name: '日历',
    desc: '显示当天日期，跨零点自动更新',
    component: CalendarWidget,
    defaultSpan: { w: 1, h: 1 },
  },
  {
    id: 'weather',
    name: '天气',
    desc: '实时天气与预报，需先设置地点',
    component: WeatherWidget,
    /*
     * 2×2 而非日历的 1×1。
     *
     * 1×1 只放得下图标 + 温度，而新方块落格时还没配地点，
     * 那一档连「点右键设置地点」这句自解释文案都放不下——
     * 用户看到的会是一个不知所以的齿轮。2×2 才有那个空间。
     */
    defaultSpan: { w: 2, h: 2 },
  },
  {
    id: 'search',
    name: '搜索',
    desc: '在方格里直接搜索，可切换引擎',
    component: SearchWidget,
    /*
     * 4×1（360px）而非日历的 1×1。
     *
     * 输入框是这个方块的全部内容，宽度就是它的可用性。搜索方块的占格范围是
     * 宽 2..6、高 1..2（见 SEARCH_SPAN_LIMITS），4 落在中间偏宽——
     * 一条够打字的输入框、左侧的引擎按钮、下方摊开的四个引擎 chips，落格即可用。
     *
     * 不取上限 6：550px 在 8 列网格里占掉大半行，作为默认过于霸道；
     * 想要的人在编辑框里选一下就有。
     *
     * 高度取 1 而非 2：两档的引擎 chips 都摊开在外（h=1 是紧凑的一行），
     * 差别只在 h=2 下方多一块「最近搜索」——那是「我想看见自己搜过什么」
     * 才值得付的两行代价，不该替所有人先付。
     */
    defaultSpan: { w: 4, h: 1 },
  },
]

const BY_ID = new Map(WIDGETS.map((widget) => [widget.id, widget]))

export function getWidget(id: string): WidgetDef | undefined {
  return BY_ID.get(id)
}

/** 把注册项转成可直接提交给 store 的草稿 */
export function widgetDraft(widget: WidgetDef): TileDraft {
  return {
    kind: 'widget',
    name: widget.name,
    widgetId: widget.id,
    spanW: widget.defaultSpan.w,
    spanH: widget.defaultSpan.h,
  }
}

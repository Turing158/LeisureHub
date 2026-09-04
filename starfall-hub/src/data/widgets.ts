import type { Component } from 'vue'

import CalendarWidget from '@/components/widgets/CalendarWidget.vue'
import CountdownWidget from '@/components/widgets/CountdownWidget.vue'
import SearchWidget from '@/components/widgets/SearchWidget.vue'
import TodoWidget from '@/components/widgets/TodoWidget.vue'
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
  /**
   * 内容自己吃指针的组件。
   *
   * TileCell 据此走「软启动」拖拽而不是整体退出拖拽（按下不立即
   * setPointerCapture，越过阈值才接管，否则内部控件的原生 click 会被吃掉），
   * TabWidgetEdit 的编辑预览也据此改成 zoom 模式并省掉 desc 提示
   * ——可交互组件自己的界面已经在说明自己是什么。
   *
   * 写成**可选**是这个字段能存在的关键：WidgetDef 上的必填字段确实是「所有组件都
   * 得回答的问题」，可选字段只是「不吃指针的组件不写」。日历、天气因此一个字不改。
   *
   * 在此之前这件事由四处 `widgetId === 'search'` 字面量判定（TileCell 的
   * isInteractive、TabWidgetEdit 的 preview 透传 / previewMode / previewHint）。
   * 那些注释都写着「第二个这样的组件出现时再抽」——待办就是第二例，所以抽了。
   * 散成四份字面量，加第二个组件时就是四处漏一处的机会。
   */
  interactive?: boolean
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
    interactive: true,
    /*
     * 4×1（360px）而非日历的 1×1。
     *
     * 输入框是这个方块的全部内容，宽度就是它的可用性。搜索方块的占格范围是
     * 宽 2..当前网格列数、高 1..2（见 SEARCH_SPAN_LIMITS），4 落在中间偏宽——
     * 一条够打字的输入框、左侧的引擎按钮、下方摊开的四个引擎 chips，落格即可用。
     *
     * 不取宽度上限：那是占满一整行，作为默认过于霸道；
     * 想要的人在编辑框里选一下就有。
     *
     * 高度取 1 而非 2：两档的引擎 chips 都摊开在外（h=1 是紧凑的一行），
     * 差别只在 h=2 下方多一块「最近搜索」——那是「我想看见自己搜过什么」
     * 才值得付的两行代价，不该替所有人先付。
     */
    defaultSpan: { w: 4, h: 1 },
  },
  {
    id: 'todo',
    name: '待办',
    /* 「数据只存在本机」是它相对天气 / 搜索的卖点，值得在卡片上说出来 */
    desc: '在方格里记事、勾选，数据只存在本机',
    component: TodoWidget,
    interactive: true,
    /*
     * 2×2。这是 list 档的最小形状，也是最小的「落格即可用」形状——
     * 有输入行能录入、有 3 行能看见。
     *
     * 判据与天气那句同源：天气取 2×2 是因为 1×1 连「点右键设置地点」都放不下；
     * 待办取 2×2 是因为 1×1（count）与 h=1（latest）都**没有输入行**，
     * 新方块落格后是一个写着「已清空 / 0」的方块，用户不知道怎么往里加东西。
     *
     * 不取更大：3×3 才有分组和折叠，但那是 6.9 行的清单，作为默认过于霸道
     * （8 列网格里它吃掉 9 格）。想要的人在编辑框里拉一下就有。
     */
    defaultSpan: { w: 2, h: 2 },
  },
  {
    id: 'countdown',
    name: '倒计时',
    /*
     * desc 里点出「可按年重复」：生日是这个方块最大的用途，而「倒计时」这个名字
     * 读起来只像单次事件，卡片上不说用户不会想到能拿它记生日。
     */
    desc: '距目标日期还有多少天，可按年重复',
    component: CountdownWidget,
    /*
     * 2×1（170×75）。
     *
     * 不写 interactive：方块内没有任何控件，`<input type="date">` 只存在于
     * 编辑对话框里，所以走既有的整体拖拽 / 点开编辑。
     *
     * 这一档放得下未配置态的「未设置日期 / 右键设置」两行 11px 的字，
     * 而落格后它读起来是一个横条——「还有 243 天」本来就是一句横向的话。
     *
     * 不取天气那样的 2×2：那要多吃一格，而多出来的 121px 在未配置态下是空的。
     * 天气取 2×2 是因为 1×1 放不下提示，倒计时 2×1 已经放下了。
     */
    defaultSpan: { w: 2, h: 1 },
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

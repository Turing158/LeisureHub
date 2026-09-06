/*
 * 这是本文件唯一一处 import 到 components/ 下的东西，值得说明为什么不违反
 * 下面 FIELDS 那句「让校验层去 import 那些实现会把整棵组件树拖进来」：
 * dayDiff.ts 是纯函数，一个 vue 都不 import，拖进来的只有它自己。
 *
 * 反过来在这里重写一遍日期解析才是真的代价——「2 月 30 日要靠回读才能拒掉」
 * 这个坑会有两份实现，而它们会各自漂移。
 */
import { parseDateParts } from '@/components/widgets/countdown/dayDiff'
import { isHexColor } from '@/utils/color'

/**
 * 一个字段的校验器：通过则返回归一化后的值，不通过返回 undefined。
 *
 * 返回值而不是布尔：`lat` 要保留 4 位小数、`place` 要 trim 并剥控制字符，
 * 「校验」与「归一化」在这里本就是同一步，分成两个钩子只会让调用点各写一遍。
 */
type WidgetFieldCheck = (raw: unknown) => unknown

/**
 * 一个可配置项：既驱动编辑器的表单，也驱动持久化数据的校验。
 *
 * 原先这张表只有颜色（`WidgetColorField`），值一律过 isHexColor。
 * 天气要存经纬度（数字）与地点名（字符串），过不了那道校验，
 * 于是把「一律 hex」换成「每个键自带校验器」。
 */
export interface WidgetField {
  /** 存进 WidgetTile.props 的键名 */
  key: string
  /** 表单里的中文标签 */
  label: string
  /**
   * 表单控件类型。
   *
   * 现有的四个颜色项即 `kind: 'color'`，行为与改动前逐字相同。
   * 天气的地点走 `kind: 'place'`——它是三个键（lat / lon / place）由
   * 一个复合控件同时写入的，不是三个独立的输入框，所以不拆成 number + text。
   * 搜索的引擎走 `kind: 'engine'`——候选项来自 settings 的 allEngines（内置 +
   * 用户自定义），是一份运行时才知道的列表，不能像颜色那样在这里写死色板。
   * 倒计时的目标日期走 `kind: 'date'`——和 place 同一个形状：两个键
   * （targetDate / repeatYearly）由一个 DateField 同时写入。理由与 place 那句同源，
   * 「2 月 29 日 + 按年重复」是一个组合，分两次 emit 会有一帧算在错误的年份上。
   * 倒计时的自定义项走 `kind: 'custom'`——它们是附加的装饰功能，不配也完整，
   * 所以在表单里单独成一个折叠面板，避免拉长常规配置区。
   */
  kind: 'color' | 'place' | 'engine' | 'date' | 'custom'
  /** color 专用，沿用现有的两套色板 */
  palette?: 'surface' | 'text'
  check: WidgetFieldCheck
}

/** 颜色校验：合法即原样保留，与改动前的 isHexColor 语义完全一致 */
const hexCheck: WidgetFieldCheck = (raw) => (isHexColor(raw) ? raw : undefined)

/**
 * 经纬度校验。
 *
 * 保留 4 位小数（约 11m）：再多的位数对天气无意义，却会让同一地点因浮点尾差
 * 产生不同的缓存键。上下界按 WGS84 给，超界的值不是「不精确」而是无意义。
 */
function coordCheck(limit: number): WidgetFieldCheck {
  return (raw) => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
    if (raw < -limit || raw > limit) return undefined
    return Math.round(raw * 10_000) / 10_000
  }
}

/** 地点名上限 24 字：§6 的像素账按「乌鲁木齐」算，更长的一律靠 ellipsis 截断 */
const PLACE_MAX = 24

/**
 * 地点名校验。
 *
 * 这是唯一一处进入 DOM 文本的用户输入。Vue 的模板插值本身会转义，
 * 所以**不做 HTML 转义**——重复转义会让 `<` 显示成 `&lt;`。
 *
 * 要剥的是 U+0000..U+001F 与 U+007F 这段控制字符：它在界面上完全不可见，
 * 却能把 JSON 序列化搞坏（含 NUL 的字符串在某些环境下会截断），
 * 属于最难被察觉的那类脏数据。地点名同时会进 `title` 属性与 `.sr-only`。
 */
const placeCheck: WidgetFieldCheck = (raw) => {
  if (typeof raw !== 'string') return undefined
  const clean = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!clean) return undefined
  return [...clean].slice(0, PLACE_MAX).join('')
}

/**
 * 日历的可配置颜色。
 *
 * 全部可缺省：缺省时沿用主题令牌（`--tile-bg`、`--color-text` 等），
 * 因此「没配过」与「配成了当前主题色」是两种状态——前者跟着主题走，后者钉死。
 *
 * 刻意只有四项语义色，而不是按元素逐个开放。
 * 日历有七种版式，元素随版式增减（年份条在大尺寸下就不存在了），
 * 按元素配色会让表单长度随版式变化，也会出现「配了但当前尺寸看不到」的空转项。
 * 收敛成「主/次 × 背景/文字」两两组合后，每一项在七种版式里都有确定落点。
 */
export const CALENDAR_COLOR_FIELDS: WidgetField[] = [
  { key: 'bgColor', label: '主要背景', kind: 'color', palette: 'surface', check: hexCheck },
  { key: 'subBgColor', label: '次要背景', kind: 'color', palette: 'surface', check: hexCheck },
  { key: 'textColor', label: '主要文字', kind: 'color', palette: 'text', check: hexCheck },
  { key: 'subTextColor', label: '次要文字', kind: 'color', palette: 'text', check: hexCheck },
]

/**
 * 天气的可配置项。
 *
 * 地点排在颜色之前：它是天气方块唯一的必填项（不配就只能渲染「未配置」态），
 * 而颜色全部可选。表单顺序即这张表的顺序。
 *
 * 四项颜色与日历同名同义：两个组件的「主/次 × 背景/文字」落点一致，
 * 用户在两处配色的心智模型因此是同一个。
 */
export const WEATHER_FIELDS: WidgetField[] = [
  { key: 'place', label: '地点', kind: 'place', check: placeCheck },
  { key: 'lat', label: '纬度', kind: 'place', check: coordCheck(90) },
  { key: 'lon', label: '经度', kind: 'place', check: coordCheck(180) },
  { key: 'bgColor', label: '主要背景', kind: 'color', palette: 'surface', check: hexCheck },
  { key: 'subBgColor', label: '次要背景', kind: 'color', palette: 'surface', check: hexCheck },
  { key: 'textColor', label: '主要文字', kind: 'color', palette: 'text', check: hexCheck },
  { key: 'subTextColor', label: '次要文字', kind: 'color', palette: 'text', check: hexCheck },
]

/**
 * 引擎 id 校验。
 *
 * 只验形状（非空字符串、长度上限），**不验它是否真的在引擎表里**——那张表含
 * 用户自定义项，用户删掉一条再改回来是合理操作，而这里若一并抹掉方块的 engineId，
 * 那次删除就顺手改写了所有引用它的方块。悬空 id 由 settings 的 resolveEngine
 * 在渲染时回退到默认引擎，方块照样能搜。
 *
 * 长度上限只为挡住脏数据把 localStorage 撑大，不表达任何业务含义。
 */
const engineIdCheck: WidgetFieldCheck = (raw) => {
  if (typeof raw !== 'string') return undefined
  const clean = raw.trim()
  if (!clean || clean.length > 64) return undefined
  return clean
}

/**
 * 搜索的可配置项。
 *
 * 引擎之外有颜色，与日历 / 天气的「主/次 × 背景/文字」同构：
 *   bgColor          卡片本身、主面板
 *   subBgColor       输入行胶囊、引擎 chip、记录 chip 这些浮在卡片上的次要面板
 *   textColor        输入内容、各 chip 与记录的主要文字
 *   subTextColor     占位符、引擎 chip 名称、记录区的标题与提示
 * 语义落点见 SearchWidget 的 .sw 样式区。
 *
 * 给搜索开放颜色要格外留神可读性：这个方块里有一个真正的 `<input>`，
 * 深底 + 深字会让「打了字但看不见」。所以落点刻意收敛——输入行底色走
 * subBgColor、上面的字走 textColor，占位符与次级文字走 subTextColor，
 * 而清除钮 / 引擎键的图标、聚焦环与输入高亮留在主题令牌上，
 * 那些是「状态标记」不是「展示面」，配错色不该让控件失效。
 *
 * 追加的建议列表三项是**独立浮层**的配色，与方块本身的四档刻意分开：
 * 建议列表 Teleport 到 body（见 SuggestList 的注释），浮在桌面之上，有自己的
 * 明面——它不该跟着方块的「主/次 × 背景/文字」走，否则方格子配了一块深底，
 * 弹出来的列表却配成浅底，两面对不上。所以每个方块在自己的 props 上各存一份。
 */
export const SEARCH_FIELDS: WidgetField[] = [
  { key: 'engineId', label: '搜索引擎', kind: 'engine', check: engineIdCheck },
  { key: 'bgColor', label: '主要背景', kind: 'color', palette: 'surface', check: hexCheck },
  { key: 'subBgColor', label: '次要背景', kind: 'color', palette: 'surface', check: hexCheck },
  { key: 'textColor', label: '主要文字', kind: 'color', palette: 'text', check: hexCheck },
  { key: 'subTextColor', label: '次要文字', kind: 'color', palette: 'text', check: hexCheck },
  { key: 'suggestBgColor', label: '建议背景', kind: 'color', palette: 'surface', check: hexCheck },
  { key: 'suggestTextColor', label: '建议文字', kind: 'color', palette: 'text', check: hexCheck },
  { key: 'suggestActiveColor', label: '建议高亮', kind: 'color', palette: 'surface', check: hexCheck },
]

/**
 * 待办的可配置项：**只有四档颜色**，与日历 / 天气 / 搜索同名同义。
 *
 *   bgColor        方块底、count 的数字区、grouped 的内容区背景
 *   subBgColor     计数条、新建输入行的胶囊、已完成折叠头、latest 的计数徽标
 *   textColor      待办正文、count 的数字、输入的内容
 *   subTextColor   计数条文案、分组标题、占位符、已完成项的正文、rail 的空心点
 *
 * 一个新 kind 都不加，三件本来会各要一个控件的东西都绕开了：分组走新建行的冒号
 * 前缀（parseTodoInput）、折叠状态不持久化（CompletedSection 里的组件级 ref）、
 * 清单数据走独立的 localStorage key（useTodos）。
 *
 * **已完成项的正文走 subTextColor 而不是加第五档。** 「已完成」在视觉上就是
 * 「降为次要」，这正是次要文字的含义；再加一档「已完成文字」会让表单多一项，
 * 而它在 count / latest / rail 三档里根本看不到——CALENDAR_COLOR_FIELDS 的注释
 * 否掉过这种「配了但当前尺寸看不到」的空转项。删除线用 text-decoration 表达，
 * 不占颜色配额。
 *
 * 留在主题令牌上、不开放配色的：复选框的勾（--accent，它是状态标记，配错色就看
 * 不出勾没勾）、聚焦环、删除钮图标、滚动条。理由同 SEARCH_FIELDS 那句
 * 「那些是『状态标记』不是『展示面』，配错色不该让控件失效」。
 */
export const TODO_FIELDS: WidgetField[] = [
  { key: 'bgColor', label: '主要背景', kind: 'color', palette: 'surface', check: hexCheck },
  { key: 'subBgColor', label: '次要背景', kind: 'color', palette: 'surface', check: hexCheck },
  { key: 'textColor', label: '主要文字', kind: 'color', palette: 'text', check: hexCheck },
  { key: 'subTextColor', label: '次要文字', kind: 'color', palette: 'text', check: hexCheck },
]

/**
 * 目标日期校验：`YYYY-MM-DD`，1970..2099。
 *
 * 存**字符串**而不是时间戳：时间戳要回答「哪个时区的零点」，而这个方块从头到尾
 * 只关心一个日历日。字符串在 localStorage 里也是可读的，手改存档时看得懂
 * 自己在改什么。
 *
 * 范围不是业务约束而是「能算对的区间」。格式与「这一天真的存在吗」
 * （2 月 30 日）都交给 parseDateParts——它是渲染路径用的同一个函数，
 * 两处各写一份正则就会各自漂移。
 */
const dateCheck: WidgetFieldCheck = (raw) => {
  const parts = parseDateParts(raw)
  if (!parts) return undefined
  if (parts.year < 1970 || parts.year > 2099) return undefined
  return (raw as string).trim()
}

/**
 * 布尔校验，最小的一个。
 *
 * **不接 `'true'` 字符串**：宽松的校验器只会让脏数据活得更久——
 * 一个存成字符串的开关在 `if (props.repeatYearly)` 下恰好也是真，
 * 于是它能一直躺在存档里，直到某天有人写了 `=== true`。
 */
const boolCheck: WidgetFieldCheck = (raw) => (typeof raw === 'boolean' ? raw : undefined)

/**
 * 字符串校验：非空修剪后的字符串，上限 200 字符。
 */
const stringCheck =
  (max = 200): WidgetFieldCheck =>
  (raw) => {
    if (typeof raw !== 'string') return undefined
    const trimmed = raw.trim()
    if (trimmed.length === 0 || trimmed.length > max) return undefined
    return trimmed
  }

/**
 * 正整数校验：1..9999。
 */
const positiveIntCheck: WidgetFieldCheck = (raw) => {
  if (typeof raw !== 'number') return undefined
  if (!Number.isInteger(raw) || raw < 1 || raw > 9999) return undefined
  return raw
}

/**
 * 字重校验：100/200/.../900 或 'normal'/'bold'。
 */
const fontWeightCheck: WidgetFieldCheck = (raw) => {
  if (raw === 'normal' || raw === 'bold') return raw
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 100 && raw <= 900 && raw % 100 === 0) {
    return raw
  }
  return undefined
}

/**
 * 图片来源类型校验：'none' / 'url' / 'local'。
 */
const imageSourceCheck: WidgetFieldCheck = (raw) => {
  if (raw === 'none' || raw === 'url' || raw === 'local') return raw
  return undefined
}

/**
 * 倒计时的可配置项。
 *
 * 日期在最前，与天气的地点、搜索的引擎同一个位置——它是这个方块唯一的必填项。
 * 两行都写 `kind: 'date'`：一个 DateField 同时写这两个键（见 WidgetField.kind）。
 *
 * **只有三档颜色，没有 subBgColor。** 它没有任何次要块面：日历有年份条与今日胶囊、
 * 天气有底条、搜索有输入胶囊、待办有计数条——倒计时是三行文字浮在一块底上，
 * subBgColor 配了看不见。CALENDAR_COLOR_FIELDS 的注释否掉过这种「配了但当前尺寸
 * 看不到」的空转项，这里是更彻底的一版：**所有**尺寸都看不到。
 *
 *   bgColor        方块底
 *   textColor      大数字
 *   subTextColor   标签行 / 前缀 / 单位 / 日期行
 *
 * **自定义附加功能（customText / customImage）放在折叠面板里。** 它们是可选的装饰项，
 * 不配也完整。`kind: 'custom'` 让表单单独渲染一个折叠区，里面是这些字段的控件。
 *
 *   customText          自定义文字内容
 *   customTextColor     自定义文字颜色
 *   customTextSize      自定义文字大小（px）
 *   customTextWeight    自定义文字字重
 *   customImageSource   图片来源：'none'(无) / 'url'(网络) / 'local'(本地)
 *   customImageUrl      网络图片 URL
 *   customImageData     本地图片 data: URI
 */
export const COUNTDOWN_FIELDS: WidgetField[] = [
  { key: 'targetDate', label: '目标日期', kind: 'date', check: dateCheck },
  { key: 'repeatYearly', label: '每年重复', kind: 'date', check: boolCheck },
  { key: 'bgColor', label: '主要背景', kind: 'color', palette: 'surface', check: hexCheck },
  { key: 'textColor', label: '主要文字', kind: 'color', palette: 'text', check: hexCheck },
  { key: 'subTextColor', label: '次要文字', kind: 'color', palette: 'text', check: hexCheck },
  { key: 'customText', label: '自定义文字', kind: 'custom', check: stringCheck(100) },
  { key: 'customTextColor', label: '文字颜色', kind: 'custom', check: hexCheck },
  { key: 'customTextSize', label: '文字大小', kind: 'custom', check: positiveIntCheck },
  { key: 'customTextWeight', label: '文字字重', kind: 'custom', check: fontWeightCheck },
  { key: 'customImageSource', label: '图片来源', kind: 'custom', check: imageSourceCheck },
  { key: 'customImageUrl', label: '图片链接', kind: 'custom', check: stringCheck(2000) },
  { key: 'customImageData', label: '本地图片', kind: 'custom', check: stringCheck(500000) },
]

/**
 * 日历颜色键的历史改名表：旧键 → 新键。
 *
 * 不做迁移的话，下面的白名单会把这些旧键当未知项静默丢掉，
 * 用户配过的颜色在一次版本更新后无声消失——这是最难被察觉的那类数据损失。
 *
 * `yearColor` 不在表里：年份文字已并入「主要文字」，
 * 而 `dayColor` 是更强的来源（日期数字在每种版式里都是主角），两者冲突时保留后者。
 */
const CALENDAR_LEGACY_KEYS: Record<string, string> = {
  bandColor: 'subBgColor',
  dayColor: 'textColor',
  monthColor: 'subTextColor',
}

/**
 * 各组件的字段表。
 *
 * 刻意放在 types 里而不是组件注册表（`data/widgets.ts`）里：store 的校验要读它，
 * 而注册表带着 Vue 组件实现，让校验层去 import 那些实现会把整棵组件树拖进来。
 * 表单标签与校验白名单同出一源，不会各写一份而后走样。
 */
const FIELDS: Record<string, WidgetField[]> = {
  calendar: CALENDAR_COLOR_FIELDS,
  weather: WEATHER_FIELDS,
  search: SEARCH_FIELDS,
  /*
   * 待办只登记这一行。LEGACY_KEYS 不加（没有历史键要迁移），
   * FINALIZE 不加（四个颜色之间没有跨键约束）。
   */
  todo: TODO_FIELDS,
  /* 倒计时要一条 FINALIZE（repeatYearly 依赖 targetDate），LEGACY_KEYS 不加 */
  countdown: COUNTDOWN_FIELDS,
}

/** 各组件的历史键改名表，与 FIELDS 同构 */
const LEGACY_KEYS: Record<string, Record<string, string>> = {
  calendar: CALENDAR_LEGACY_KEYS,
}

/**
 * 跨键约束。
 *
 * 单键校验器管不到「lat 通过但 lon 没通过」这种情况——那会让组件拿到
 * 半个坐标，`placeKey()` 里 `undefined.toFixed` 直接抛错。
 * 所以按 widgetId 留一个收尾钩子，就地删掉不成立的组合。
 */
const FINALIZE: Record<string, (next: Record<string, unknown>) => void> = {
  weather(next) {
    if ('lat' in next && 'lon' in next) return
    // 缺一即两个都删；只留 place 时组件渲染「未配置」态，用户重新搜一次即可
    delete next.lat
    delete next.lon
  },
  countdown(next) {
    /*
     * 没有目标日期时重复开关无意义；留着它会让「未配置」有两种表示
     * （空 props 与只剩一个 repeatYearly），而组件的未配置态判的是前者。
     */
    if (!('targetDate' in next)) delete next.repeatYearly

    /*
     * 自定义图片的跨键约束：
     * - source='url' 但 url 为空 → 删掉 source，回落到无图
     * - source='local' 但 data 为空 → 删掉 source，回落到无图
     * - source='none' 时图片字段无意义 → 删掉 url 与 data
     * - source 未设时图片字段无意义 → 删掉 url 与 data
     *
     * 自定义文字的跨键约束：
     * - 没有 customText 时颜色、大小、字重都无意义 → 一并删掉
     */
    const src = next.customImageSource
    if (src === 'url' && !next.customImageUrl) {
      delete next.customImageSource
    }
    if (src === 'local' && !next.customImageData) {
      delete next.customImageSource
    }
    if (src === 'none' || !src) {
      delete next.customImageUrl
      delete next.customImageData
    }

    if (!next.customText) {
      delete next.customTextColor
      delete next.customTextSize
      delete next.customTextWeight
    }
  },
}

export function widgetFields(widgetId: string): WidgetField[] {
  return FIELDS[widgetId] ?? []
}

/** 编辑面板的颜色循环读这一个，签名与改动前一致 */
export function widgetColorFields(widgetId: string): WidgetField[] {
  return widgetFields(widgetId).filter((field) => field.kind === 'color')
}

/**
 * 按控件类型取字段；'place' / 'date' 那样多键共用一个控件时返回**第一条**
 * （表单只需要知道「要不要插这一段」，具体写哪些键由那个复合控件自己决定）。
 *
 * 抽出来的理由与 WidgetDef.interactive 那次相同：在此之前 hasPlace 是一句 some、
 * engineField 是一句 find，再加倒计时就是第三份同一个 find，而「散成三四份
 * 字面量时那是三四处漏一处的机会」。
 */
export function widgetFieldByKind(
  widgetId: string,
  kind: WidgetField['kind'],
): WidgetField | undefined {
  return widgetFields(widgetId).find((field) => field.kind === kind)
}

/** 编辑面板据此决定是否插入地点输入区 */
export function widgetHasPlace(widgetId: string): boolean {
  return widgetFieldByKind(widgetId, 'place') !== undefined
}

/** 编辑面板据此决定是否插入引擎选择区 */
export function widgetEngineField(widgetId: string): WidgetField | undefined {
  return widgetFieldByKind(widgetId, 'engine')
}

/**
 * 校验组件的 props。
 *
 * 这些值会写进内联样式或 DOM 文本，必须逐个过对应的校验器——localStorage
 * 可被随意改写，照原样透传就等于开了一个样式注入口。
 *
 * 未知 widgetId 不整块丢弃，只保留通得过颜色校验的键：组件可能只是改了名，
 * 或要到下个版本才加回来，此时抹掉用户配好的颜色是没必要的损失，
 * 而留下的每个值都已是合法颜色，没有安全代价。
 *
 * 历史键在这里就地改名（见 CALENDAR_LEGACY_KEYS）。改名发生在校验之后：
 * 旧键的值同样来自 localStorage，不能因为「是我们自己认识的键」就免检。
 * 新键已存在时不被旧键覆盖——同时存在只可能是迁移过程中的中间态，新的更可信。
 */
export function sanitizeWidgetProps(
  widgetId: string,
  raw: unknown,
): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined

  const fields = FIELDS[widgetId]
  const checks = fields ? new Map(fields.map((field) => [field.key, field.check])) : null
  const legacy = LEGACY_KEYS[widgetId] ?? {}
  const next: Record<string, unknown> = {}

  for (const [rawKey, value] of Object.entries(raw)) {
    const key = legacy[rawKey] ?? rawKey
    /*
     * 未登记的 widgetId 落到 hexCheck：与改动前的行为一致。
     * 已登记但键不在表里的，checks.get 返回 undefined，整键丢弃。
     */
    const check = checks ? checks.get(key) : hexCheck
    if (!check) continue
    const cleaned = check(value)
    if (cleaned === undefined) continue
    // 迁移来的键不覆盖已有的新键
    if (key !== rawKey && key in next) continue
    next[key] = cleaned
  }

  FINALIZE[widgetId]?.(next)

  // 一个键都没留下就不写空对象，让「未配置」始终是同一种表示
  return Object.keys(next).length > 0 ? next : undefined
}

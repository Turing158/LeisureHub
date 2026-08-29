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
   */
  kind: 'color' | 'place' | 'engine'
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
 * 只有引擎一项，没有颜色。
 *
 * 不给颜色是刻意的：日历与天气是「一块自画的展示面」，配色只影响观感；
 * 而搜索方块里有一个真正的 `<input>`，它的底色、文字色、placeholder 色、选中
 * 高亮色、焦点环必须一起成立才可读。开放前两个而让后三个跟着主题，用户配出
 * 深底 + 深字的组合时，看到的是一个「打了字但看不见」的输入框——那不是配色难看，
 * 是控件坏了。这一档留给主题令牌统一负责。
 */
export const SEARCH_FIELDS: WidgetField[] = [
  { key: 'engineId', label: '搜索引擎', kind: 'engine', check: engineIdCheck },
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
}

export function widgetFields(widgetId: string): WidgetField[] {
  return FIELDS[widgetId] ?? []
}

/** 编辑面板的颜色循环读这一个，签名与改动前一致 */
export function widgetColorFields(widgetId: string): WidgetField[] {
  return widgetFields(widgetId).filter((field) => field.kind === 'color')
}

/** 编辑面板据此决定是否插入地点输入区 */
export function widgetHasPlace(widgetId: string): boolean {
  return widgetFields(widgetId).some((field) => field.kind === 'place')
}

/** 编辑面板据此决定是否插入引擎选择区 */
export function widgetEngineField(widgetId: string): WidgetField | undefined {
  return widgetFields(widgetId).find((field) => field.kind === 'engine')
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

import { defineStore } from 'pinia'
import { nanoid } from 'nanoid'
import { computed, ref, watch } from 'vue'

import { DEFAULT_ENGINE_ID, ENGINES, type EngineDef } from '@/data/engines'
import { buildDefaultBgUrls } from '@/data/defaults'
import { alphaToHex, isHexColor, normalizeHex } from '@/utils/color'
import {
  dataUrlToBlob,
  deleteImage,
  getImage,
  listImageIds,
  putImage,
  LOCAL_IMAGE_MAX_BYTES,
} from '@/utils/imageStore'
import { ENGINE_NAME_MAX, isSafeEngineUrl, type CustomEngine } from '@/types/search'
import {
  activePresetDef,
  activeProfileId,
  globalKey,
  keyFor,
  scanProfileKeys,
} from '@/utils/profileKey'

/** 背景来源：纯色预设 / 本地图片 / 网络图片 */
export type BgMode = 'color' | 'local' | 'image'
/** 动画开关：跟随系统偏好 / 强制开启 / 强制关闭 */
export type MotionMode = 'system' | 'always' | 'off'
/** 磨砂开关：跟随系统的「降低透明度」/ 强制开启 / 强制关闭 */
export type GlassMode = 'system' | 'always' | 'off'
/** 设置抽屉与手柄的停靠侧 */
export type DrawerSide = 'left' | 'right'
/** 方块区域尺寸的给定方式：直接写像素 / 写横竖格子数 */
export type AreaMode = 'pixel' | 'cell'

/**
 * 两份存档，一个 store。
 *
 * 内存里仍是一个 settings store、二十来个 ref；只有 load() / persist() 知道
 * 它们落进两个键：
 *
 *   `leisure-hub:settings@<active>`  按档：背景、主题色、遮罩、区域尺寸、抽屉侧、手柄高度
 *   `leisure-hub:global`             全局：隐私三开关 + 自定义引擎表
 *
 * **拆存档，不拆 store。** 把它拆成两个 store 会波及 2420 行抽屉里每一处
 * `settings.suggestEnabled`，而那两组字段在内存里没有任何理由分开——存档布局是
 * 持久化层的知识，不该漏进消费方。
 *
 * 那四个字段为什么必须全局：三条隐私开关按档存等于「在电脑档关掉了搜索建议，
 * 切到手机档又默默打开了」，用户以为关掉的东西又开始往第三方发字；
 * `customEngines` 是所有搜索方块共用的词典，而每个方块把 engineId 存在自己的
 * props 里，按档存会让另一档那些方块的 id 集体悬空、resolveEngine 静默回退，
 * 表现是「手机档的搜索方块自己换了引擎」且找不到原因。
 */
function settingsKey(): string {
  return keyFor('settings')
}

const GLOBAL_KEY = globalKey('global')
const SCHEMA_VERSION = 1

/**
 * 纯色预设。
 *
 * 界面是浅字 + 深色面板，浅色底会让文字和方格描边全部失效，
 * 所以预设统一取低明度。
 *
 * 前三档是纯中性灰，其余五档把饱和度压到 5% 上下——整体仍读作灰，
 * 只在并排比较时能看出偏向。八个纯灰会让色板失去意义：相邻档位
 * 肉眼分辨不出，用户点哪个都一样。
 */
export const BG_PRESETS = [
  { value: '#0a0a0c', label: '曜黑' },
  { value: '#0e0e11', label: '石墨' },
  { value: '#14141a', label: '深灰' },
  { value: '#101318', label: '夜蓝' },
  { value: '#0f1413', label: '松墨' },
  { value: '#131013', label: '乌梅' },
  { value: '#141110', label: '焦褐' },
  { value: '#101314', label: '青灰' },
] as const

/**
 * 旧配色预设 → 新预设的迁移表。
 *
 * 不靠 SCHEMA_VERSION 处理：版本不匹配会整份丢弃存档（见 load()），
 * 连方块区域尺寸、抽屉停靠侧一起清空，代价远大于收益。
 *
 * 只映射这 8 个已知的旧预设值。用户自选的其它颜色一律原样保留——
 * 那是主动设定，不该被静默改写。
 */
const LEGACY_BG_MIGRATION: Record<string, string> = {
  '#0b1020': '#0e0e11', // 午夜 → 石墨（原默认值，对应新默认值）
  '#101a2e': '#101318', // 藏蓝 → 夜蓝
  '#0e2129': '#101314', // 远洋 → 青灰
  '#10241d': '#0f1413', // 深林 → 松墨
  '#1d1730': '#131013', // 暮紫 → 乌梅
  '#291a20': '#131013', // 玫褐 → 乌梅
  '#241a16': '#141110', // 赭石 → 焦褐
  '#1b1d21': '#14141a', // 石墨 → 深灰
}


/**
 * 主题色预设。
 *
 * 与 BG_PRESETS 的取值逻辑相反：那边是「整屏底色」，必须压到低明度；
 * 这里是**状态标记**（开关轨道、选中环、拖拽落点），要在深色面板上站得住，
 * 所以统一取中高明度、中饱和度——太暗读不出「开」，太艳就回到被否掉的
 * indigo-500 观感。六档各占一段色相，同一明度带，并排时只有色相差。
 *
 * 首档即改造前写死的 --accent 值，作为默认值：未动过设置的用户观感不变。
 *
 * 每档必须同时满足三条对比度约束（逐档实测，不靠估）：
 *
 *  1. accent 对染色后的面板底 ≥ 3:1 —— 它是图形边界（开关轨道、选中环），
 *     走非文本组件门槛；
 *  2. 开关的浅色 thumb（--color-text）压在轨道 accent 上 ≥ 3:1 ——
 *     否则「开」态里 thumb 会糊进轨道，二元状态就读不出来了；
 *  3. --color-text 压在 --accent-solid 上 ≥ 4.5:1 —— 那是正文门槛（提交按钮上是文字）。
 *
 * 第 3 条正是 --accent-solid 存在的理由：--accent 自身太亮，文字压上去只有 3.2:1。
 *
 * 实测值（面板 / thumb / 文字压 solid）：
 *   靛蓝 4.40 / 3.15 / 4.77    湖蓝 4.33 / 3.19 / 4.81
 *   青竹 4.32 / 3.21 / 4.88    琥珀 4.34 / 3.19 / 4.83
 *   绛梅 4.35 / 3.20 / 4.87    紫藤 4.35 / 3.19 / 4.83
 *
 * 后五档是按「过线且留余量（thumb ≥ 3.2）后取最亮」搜出来的：贴着 3.00 选没有容错，
 * 而越亮越鲜活，一味压暗六档会趋同。改这张表前先按上面三条量一遍。
 *
 * 自选色不做校验（用户主动设定，不静默改写），面板里已就此给了提示。
 */
export const THEME_PRESETS = [
  { value: '#5b7cfa', label: '靛蓝' },
  { value: '#558aaf', label: '湖蓝' },
  { value: '#4c907f', label: '青竹' },
  { value: '#a67c52', label: '琥珀' },
  { value: '#d15f76', label: '绛梅' },
  { value: '#9173d6', label: '紫藤' },
] as const

export const BLUR_MAX = 40

/**
 * 方块区域尺寸的取值范围。
 *
 * 像素档的下限取一个「至少放得下一格」的量级；上限给得很宽，
 * 真正的天花板是当前画面能量到多少，由 useGridMetrics 再夹一次。
 */
export const AREA_SIZE_MIN = 100
export const AREA_SIZE_MAX = 10000
export const AREA_CELL_MIN = 1
export const AREA_CELL_MAX = 40

/** 尺寸字段的「自动铺满」哨兵值：0 表示未指定，跟随画面 */
export const AREA_AUTO = 0

/** 自定义引擎条数上限：菜单是一列纵向项，再多就该做搜索而不是列表 */
export const CUSTOM_ENGINE_MAX = 12

/** 遮罩压暗层不透明度的滑块范围，单位为百分比 */
export const SCRIM_OPACITY_MIN = 20
export const SCRIM_OPACITY_MAX = 95

/**
 * 设置手柄的纵向位置。
 *
 * 常量与夹取放在这里而不是 useEdgeHandle，是因为这个值现在**存在 settings 存档里**
 * （曾经独占一份 `starfall-hub:settings-handle`）。那份存档是唯一在**模块求值时**
 * 就读按档键的地方，多配置档之后它会在索引就绪之前跑——并进来之后，
 * 「按档的键一律在 store setup 里读」这条纪律就没有例外了。
 *
 * 留白 8%：沿边线方向两端各让出一段，避免手柄贴到屏幕角落。
 */
export const HANDLE_INSET = 0.08
export const HANDLE_RATIO_DEFAULT = 0.5

/*
 * 单张本地图片的大小上限，从 utils/imageStore 转出。
 *
 * 字节本身存 IndexedDB 的 Blob，不再走 localStorage 的 base64，所以这个上限
 * 不再由 5MB 配额推导（详见 imageStore 的模块注释），只用来挡住误选的巨图。
 */
export { LOCAL_IMAGE_MAX_BYTES }

/**
 * 各档背景的条数上限。
 *
 * 纯色档给得宽（色板 8 档 + 自选）；两个图片档收在 12 张——再多就该做一个
 * 带缩略图网格与分页的管理器，而这里只是抽屉里一段横向排布的方块。
 */
export const BG_COLOR_MAX = 24
export const BG_IMAGE_MAX = 12

/**
 * 轮换间隔的取值范围，单位为秒。
 *
 * 下限 3 秒：再短的话交叉淡入（800ms）还没走完就要换下一张，观感是一直在闪。
 * 上限 3600 秒（1 小时）足够「一小时换一张」这类用法；更长的周期在一个
 * 常开标签页上没有实际意义。
 */
export const BG_INTERVAL_MIN = 3
export const BG_INTERVAL_MAX = 3600
export const BG_INTERVAL_DEFAULT = 30

/**
 * 一张本地图片的索引项。
 *
 * 字节不在这里——它按 id 存在 IndexedDB。url 是运行期由 Blob 造出来的
 * objectURL，**不持久化**：objectURL 只在当前文档有效，存进存档下次打开就是死链。
 * 每次启动由 hydrateLocalImages() 重新生成。
 */
export interface BgLocalImage {
  id: string
  name: string
  /** 运行期 objectURL；hydrate 完成前 / 字节丢失时为 null */
  url: string | null
}

/** 一条网络背景地址。带 id 是因为列表要能逐行编辑与删除，不能用下标当 key */
export interface BgUrlItem {
  id: string
  url: string
}

/**
 * 背景轮换的一帧，是渲染层唯一认识的形态。
 *
 * 三种来源（纯色 / 本地 / 网络）在这里归一：渲染层只管「这一帧是颜色还是图」，
 * 不需要知道它来自哪个档、字节存在哪。sig 把「同一个 key 但内容变了」表达出来——
 * 网络档里编辑一行地址，key（id）不变而 href 变了，交叉淡入要靠 sig 才能察觉。
 */
export interface BgFrame {
  key: string
  sig: string
  kind: 'color' | 'image'
  /** kind === 'color' 时有值 */
  color?: string
  /** kind === 'image' 时有值，已是可直接交给 CSS 的绝对地址 */
  href?: string
}

const BG_MODES: readonly BgMode[] = ['color', 'local', 'image']
const MOTION_MODES: readonly MotionMode[] = ['system', 'always', 'off']
const GLASS_MODES: readonly GlassMode[] = ['system', 'always', 'off']
const DRAWER_SIDES: readonly DrawerSide[] = ['left', 'right']
const AREA_MODES: readonly AreaMode[] = ['pixel', 'cell']

const DEFAULTS = {
  /*
   * 默认放壁纸而不是纯色。
   *
   * 这是**取舍**：这个项目的观感建立在「一张图 + 半透明方块」上，
   * 纯色底会让 30% 黑的方块底色完全失效（它压在什么上都是同一个灰）。
   * 图本身不在这里，见 data/defaults.ts 的 WALLPAPER——那是内容。
   */
  bgMode: 'image' as BgMode,
  /*
   * 纯色档存的是一**组**颜色，而不是单个值。
   *
   * 关掉轮换时用其中一个（bgIndex 指向的那个），开启轮换时依次淡入。
   * 默认只有一档：焦褐，作为切到纯色档时的落点，也是图未就绪时的垫底色
   * （见 bgBaseColor——图片档取 bgColors[0]）。
   */
  bgColors: [normalizeHex(BG_PRESETS[6].value) ?? BG_PRESETS[6].value] as string[],
  bgLocalImages: [] as BgLocalImage[],
  /** 网络地址组的内容在 data/defaults.ts（buildDefaultBgUrls），这里只能是空数组——见 reset */
  bgUrls: [] as BgUrlItem[],
  /*
   * 2px 的轻模糊。
   *
   * 不是 0：壁纸里的细节（树叶、纹理）会与方格里的小字抢注意力，
   * 糊掉一点点就够把它压成背景；也远未到「看不出是什么图」的程度。
   * 纯色档下这个值不生效（见 effectiveBlur）。
   */
  bgBlur: 2,
  /*
   * 轮换开关与间隔按档分开存。
   *
   * 三档各有一套，而不是一个全局开关：用户在纯色档设的「10 秒换一次」不该在
   * 切到本地图片档时被继承——那边是一组照片，10 秒太快。切回来时上次的设置还在。
   */
  bgRotate: { color: false, local: false, image: false } as Record<BgMode, boolean>,
  bgInterval: {
    color: BG_INTERVAL_DEFAULT,
    local: BG_INTERVAL_DEFAULT,
    image: BG_INTERVAL_DEFAULT,
  } as Record<BgMode, number>,
  motion: 'system' as MotionMode,
  glass: 'system' as GlassMode,
  /*
   * 主题色默认取**第二档（湖蓝）**。
   *
   * 归一到 8 位（预设写的是 6 位）：与 bgColors 同一理由——取色面板产出 8 位，
   * 两种写法混在一起，「这个预设选中了吗」就要在每个比较点各自归一一次。
   *
   * 不取首档靛蓝：那一档最接近改造前写死的 indigo，而湖蓝在这张默认壁纸上
   * 与图里的冷调同源。三条对比度约束逐档都过（见 THEME_PRESETS 的实测表），
   * 换档不影响可读性。style.css 里 --theme-color / --accent-solid 的字面兜底值
   * 必须跟着改成这一档，否则 JS 未执行的首帧会闪一下靛蓝。
   */
  themeColor:
    normalizeHex(THEME_PRESETS[1].value) ?? THEME_PRESETS[1].value,
  /*
   * 遮罩压暗到 20%（即 SCRIM_OPACITY_MIN）。
   *
   * 42 是 --scrim-tint 的字面默认值，压到下限是刻意的：抽屉与对话框自己已经有
   * 0.92 的不透明底 + 磨砂，遮罩的职责只是「把注意力从桌面拿走」，
   * 更深会让壁纸在浮层打开时整屏发黑，观感上像换了一页。
   */
  scrimOpacity: SCRIM_OPACITY_MIN,
  drawerSide: 'right' as DrawerSide,
  /** 点遮罩关闭：默认开启，与改造前写死的行为一致 */
  closeOnScrim: true,
  /** 手柄纵向位置：正中。停靠侧是上面的 drawerSide，两者一起重置 */
  handleRatio: HANDLE_RATIO_DEFAULT,
  /*
   * 搜索建议默认**开启**。
   *
   * 这一条曾经默认关闭，理由是：建议只能走 JSONP（主流端点全都不发
   * Access-Control-Allow-Origin），而 JSONP 请求会带上该域的 Cookie，
   * 等于告诉搜索引擎用户打了什么字，属于隐私成本、该由用户显式接受。
   *
   * 那个成本仍然存在，改成默认开启是因为部署形态变了：这是一个**个人**导航站，
   * 使用者与部署者是同一个人，「显式接受」那一步的对象就是他自己——而代价是
   * 每次换机器 / 清过站点数据后都要重新去抽屉里翻一遍开关。开关与它那句
   * 说明文案原样留着（见 SettingsDrawer 的「搜索建议」），随时能关。
   *
   * 放在全局而不是每个方块的 props 里：它是一条隐私开关，
   * 「这个方块发、那个方块不发」没有意义，只会让用户以为自己已经关掉了。
   * 也放在**全局存档**而不是按档的那份里，同一条理由推到配置档：
   * 「在电脑档关掉了，切到手机档又默默打开了」比「方块之间不一致」严重一档。
   */
  suggestEnabled: true,
  /** 内联补全默认关闭：它与中文输入法的边界最窄，见 useInlineComplete 的四道门禁 */
  inlineCompleteEnabled: false,
  /*
   * 搜索记录默认**开启**，与上面两项刻意相反。
   *
   * 那两项的成本是「把用户打的字发给第三方」，必须显式接受；记录全程留在
   * localStorage，不发给任何人（见 useSearchHistory 的说明）。它仍有一层成本——
   * 内容直接显示在 2 格高的搜索方块上，旁人扫一眼就能看到——但那是可见的、
   * 随时能关能清的，而默认关掉会让那一档下方的展示区永远空着，看起来像坏了。
   */
  searchHistoryEnabled: true,
}

/**
 * 方块区域尺寸的默认值，**按当前配置档的预设取**。
 *
 * 曾经是 DEFAULTS 里写死的四个数（pixel 1440×720 + 两个 AREA_AUTO）。改成按预设
 * 取是这次多配置档的核心一步：它必须与网格行列**互解**，否则首帧按预设摆好的
 * 布局会被 TileGrid 的 resize watch 挪一遍（缩小时方块被挤进 overflow，等网格
 * 变回来它们已经按 reflow 顺序重排了，回不到原来的锚点）。两档各自的算术与
 * 互解检查都写在 types/profile 的预设表里。
 *
 * 电脑档仍是 pixel 1440×720（与 15×6 互解，屏幕更大时四周留白居中）；
 * 手机档是 cell 3×N——**rows 写死而不留 AREA_AUTO**，与电脑档写死像素同一条理由：
 * AUTO 会按实际视口反解，于是默认布局在不同手机上落位不同，短屏反解出 5 行，
 * 第 6 行往后的方块全被 resize 挤进 overflow，首次打开看到的就不是设计好的那张图。
 */
function areaDefaults() {
  const { area } = activePresetDef()
  return {
    areaMode: area.mode as AreaMode,
    areaWidth: area.width,
    areaHeight: area.height,
    areaCols: area.cols,
    areaRows: area.rows,
  }
}

/**
 * 本地图片在存档里的形态：只有索引，没有字节。
 *
 * 运行期的 BgLocalImage 多一个 url（objectURL），它不能持久化——见该接口的注释。
 */
type StoredLocalImage = Pick<BgLocalImage, 'id' | 'name'>

/**
 * 按档那份存档的形状（`leisure-hub:settings@<id>`）。
 *
 * 搜索那四个字段仍留在这里、标成**旧字段**：它们已经搬去 `:global`，但老存档
 * （无后缀的 `:settings`，被 profileKey 的 claimLegacy 改名成 `@desktop`）里还带着，
 * 读盘时要能从它们迁一次。写入侧不再写。与 bgColor / bgImage 那几个旧字段同一手法。
 */
export interface SettingsState {
  version: number
  bgMode: BgMode
  bgColors: string[]
  bgLocalImages: StoredLocalImage[]
  bgUrls: BgUrlItem[]
  bgRotate: Record<BgMode, boolean>
  bgInterval: Record<BgMode, number>
  /** 关着轮换时选中的那一帧的 key，按背景档各存一个 */
  bgPick: Record<BgMode, string>
  bgBlur: number
  /* ↓ 旧字段：只在读盘时用于迁移，不再写入 */
  bgColor?: string
  bgImage?: string
  bgLocalImageUrl?: string | null
  bgLocalImageName?: string
  motion: MotionMode
  glass: GlassMode
  themeColor: string
  scrimOpacity: number
  drawerSide: DrawerSide
  closeOnScrim: boolean
  /** 手柄纵向位置，0..1。曾独占 `starfall-hub:settings-handle`，见 HANDLE_RATIO_DEFAULT */
  handleRatio: number
  areaMode: AreaMode
  areaWidth: number
  areaHeight: number
  areaCols: number
  areaRows: number
  /* ↓ 已搬去 :global，只在读盘时用于迁移，不再写入 */
  suggestEnabled?: boolean
  inlineCompleteEnabled?: boolean
  searchHistoryEnabled?: boolean
  customEngines?: CustomEngine[]
}

/** 全局那份存档的形状（`leisure-hub:global`），四个字段一律跨档共用 */
export interface GlobalState {
  version: number
  suggestEnabled: boolean
  inlineCompleteEnabled: boolean
  searchHistoryEnabled: boolean
  customEngines: CustomEngine[]
}

/**
 * 把用户填的图片地址解析成可直接交给 CSS 的绝对地址；不可用时返回 null。
 *
 * 归一化交给 URL 构造器，而不是在渲染时 encodeURI()——后者对「已经编码过的
 * 地址」不是幂等的，会把 %XX 里的 % 再编码成 %25。而用户手里的地址十有八九
 * 就是编码过的：浏览器地址栏与右键「复制图片地址」都会把中文和空格转成 %XX，
 * 对象存储的签名地址里也全是 %2F %2B %3D。双重编码后请求打到一个不存在的
 * 路径上，服务端多半还回 200 + HTML（SPA fallback），于是背景静默地什么都不显示。
 *
 * URL 构造器只补该补的转义，已有的 %XX 原样保留，两种形态都能得到同一个结果。
 */
function resolveImageUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  /*
   * 先要求形如绝对地址或协议相对地址，与输入框的提示语一致。
   * 少了这一道，`wall.jpg` 会被 URL 静默补成本站地址而不再报错，
   * 「仅支持网络图片」这条约定就成了空话。
   */
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !trimmed.startsWith('//')) return null

  const base = typeof window === 'undefined' ? 'https://localhost/' : window.location.href
  let url: URL
  try {
    url = new URL(trimmed, base)
  } catch {
    return null
  }

  // 协议白名单仍然只有 http(s)：javascript: / data: / file: 一律拒收
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url.href
}

/** 背景图仅允许 http(s) 与协议相对地址；javascript: 之类一律拒收 */
function isSafeImageUrl(value: string): boolean {
  return resolveImageUrl(value) !== null
}

/**
 * 转义能从 url("…") 里逃出去的字符。
 *
 * URL#href 已经把双引号编成 %22、丢掉换行，所以正常路径下这一步是空转；
 * 留着是因为「地址最终会被拼进 CSS」这件事不该依赖上游实现的细节。
 */
function cssUrl(href: string): string {
  return href.replace(
    /["\\\n\r]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  )
}

/**
 * 把旧配色预设换成对应的新档位。
 *
 * 只在读存档时调用一次。非旧预设值（自定义色或已是新值）原样返回。
 */
function migrateBgColor(value: string): string {
  return LEGACY_BG_MIGRATION[value.toLowerCase()] ?? value
}

function clampBlur(value: unknown): number {
  if (!Number.isFinite(value as number)) return DEFAULTS.bgBlur
  return Math.min(BLUR_MAX, Math.max(0, Math.round(value as number)))
}

/** 遮罩不透明度有下限：太透会让抽屉背后的方格干扰阅读 */
function clampScrimOpacity(value: unknown): number {
  if (!Number.isFinite(value as number)) return DEFAULTS.scrimOpacity
  return Math.min(SCRIM_OPACITY_MAX, Math.max(SCRIM_OPACITY_MIN, Math.round(value as number)))
}

/** 轮换间隔（秒）夹进合法区间；非数字回落到默认值 */
function clampInterval(value: unknown): number {
  if (!Number.isFinite(value as number)) return BG_INTERVAL_DEFAULT
  return Math.min(BG_INTERVAL_MAX, Math.max(BG_INTERVAL_MIN, Math.round(value as number)))
}

/**
 * 校验一组背景色。
 *
 * 逐项走 isHexColor + 迁移旧预设，顺带去重（同一个颜色在轮换里出现两次
 * 只会表现为「有一次换了但看不出变化」）。全部不合法时回退到默认单色，
 * 而不是留一个空数组——空数组会让纯色档没有任何可显示的帧。
 *
 * 一律归一到 8 位形式。BG_PRESETS 写的是 6 位，取色面板产出的是 8 位，
 * 两种写法混在同一个数组里，「这个预设选中了吗」就要在每个比较点各自
 * 归一一次，漏一处的表现是色板上明明在用的那个预设不显示选中态。
 */
function sanitizeColors(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULTS.bgColors]
  const out: string[] = []
  for (const item of value) {
    if (!isHexColor(item)) continue
    const color = normalizeHex(migrateBgColor(item.toLowerCase()))
    if (!color) continue
    if (!out.includes(color)) out.push(color)
    if (out.length >= BG_COLOR_MAX) break
  }
  return out.length > 0 ? out : [...DEFAULTS.bgColors]
}

/** 校验本地图片索引；字节是否真的还在库里由 hydrate 阶段核对 */
function sanitizeLocalImages(value: unknown): BgLocalImage[] {
  if (!Array.isArray(value)) return []
  const out: BgLocalImage[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Partial<BgLocalImage>
    if (typeof row.id !== 'string' || !row.id) continue
    if (out.some((existing) => existing.id === row.id)) continue
    out.push({
      id: row.id,
      name: typeof row.name === 'string' ? row.name : '',
      // url 一律从 null 起步：objectURL 只在本次文档有效，存档里的值不可信
      url: null,
    })
    if (out.length >= BG_IMAGE_MAX) break
  }
  return out
}

/** 校验网络地址列表：保留空串行（用户可能加了一行还没填），非空则必须是 http(s) */
function sanitizeUrls(value: unknown): BgUrlItem[] {
  if (!Array.isArray(value)) return []
  const out: BgUrlItem[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Partial<BgUrlItem>
    if (typeof row.url !== 'string') continue
    const trimmed = row.url.trim()
    if (trimmed && !isSafeImageUrl(trimmed)) continue
    out.push({ id: typeof row.id === 'string' && row.id ? row.id : nanoid(), url: trimmed })
    if (out.length >= BG_IMAGE_MAX) break
  }
  return out
}

/** 三档各一份的布尔 / 数值表，逐档校验，缺档补默认 */
function sanitizeModeFlags(value: unknown, fallback: Record<BgMode, boolean>): Record<BgMode, boolean> {
  const row = (value ?? {}) as Partial<Record<BgMode, unknown>>
  return {
    color: typeof row.color === 'boolean' ? row.color : fallback.color,
    local: typeof row.local === 'boolean' ? row.local : fallback.local,
    image: typeof row.image === 'boolean' ? row.image : fallback.image,
  }
}

function sanitizeModeIntervals(value: unknown): Record<BgMode, number> {
  const row = (value ?? {}) as Partial<Record<BgMode, unknown>>
  return {
    color: clampInterval(row.color),
    local: clampInterval(row.local),
    image: clampInterval(row.image),
  }
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/**
 * 夹紧区域尺寸类字段。
 *
 * AREA_AUTO（0）是合法值且必须原样保留——它表示「跟随画面」，
 * 若按下限夹成 AREA_SIZE_MIN，默认状态就会从「铺满」变成一个 100px 的窄条。
 */
function clampArea(value: unknown, min: number, max: number): number {
  if (!Number.isFinite(value as number)) return AREA_AUTO
  const n = Math.round(value as number)
  if (n <= 0) return AREA_AUTO
  return Math.min(max, Math.max(min, n))
}

/**
 * 校验一条自定义引擎。
 *
 * 地址走 isSafeEngineUrl（含 {q} + 只放行 http/https），名称截到软上限。
 * id 缺失时补一个：存档可能来自手改，或将来的导入功能。
 */
function sanitizeCustomEngine(value: unknown): CustomEngine | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<CustomEngine>
  if (typeof row.url !== 'string' || !isSafeEngineUrl(row.url)) return null
  const name = typeof row.name === 'string' ? row.name.trim().slice(0, ENGINE_NAME_MAX) : ''
  if (!name) return null
  return {
    id: typeof row.id === 'string' && row.id ? row.id : nanoid(),
    name,
    url: row.url.trim(),
  }
}

function sanitizeEngineList(value: unknown): CustomEngine[] {
  if (!Array.isArray(value)) return []
  return value
    .map(sanitizeCustomEngine)
    .filter((engine): engine is CustomEngine => engine !== null)
    .slice(0, CUSTOM_ENGINE_MAX)
}

/** 手柄比例：两端各留 HANDLE_INSET，非数字回到正中 */
function clampHandleRatio(value: unknown): number {
  if (!Number.isFinite(value as number)) return HANDLE_RATIO_DEFAULT
  return Math.min(1 - HANDLE_INSET, Math.max(HANDLE_INSET, value as number))
}

/**
 * 认领手柄高度曾独占的那份存档（`starfall-hub:settings-handle`，裸对象 `{ ratio }`）。
 *
 * 读到就**顺手删掉**：这是一次性迁移，留着旧键会让「下次读盘该信谁」变成一个
 * 每次启动都要回答的问题。它是全局键（无 `@` 后缀），所以第一个打开的档把它
 * 领走——旧版本只有一个手柄位置，本来也只有一个答案。
 *
 * 与 claimLegacy（profileKey）分工：那边只搬原始字节、不解析内容，而这里必须
 * 解析（旧形状是 `{ ratio }`，新位置是 settings 存档里的一个字段），
 * 所以放在知道存档形状的这一侧。
 *
 * JSON 坏掉时不删键（catch 里没有 removeItem）：那一个字节数的垃圾键不值得
 * 再包一层 try，而它已经不影响任何读取。
 */
function claimLegacyHandleRatio(): number | null {
  try {
    const key = globalKey('settings-handle')
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { ratio?: number }
    localStorage.removeItem(key)
    return Number.isFinite(parsed?.ratio) ? clampHandleRatio(parsed.ratio) : null
  } catch {
    return null
  }
}

/* ── 本地壁纸字节的跨档引用 ─────────────────────────── */

/**
 * **所有**配置档引用到的本地图 id。
 *
 * 这个函数存在的理由是一个只等多档出现就触发的不可逆 bug：孤儿清理原先用
 * 「当前档的 bgLocalImages」当 alive 集合，多档之后**打开电脑档就会删掉手机档的
 * 全部壁纸字节**——8MB 的照片，没有回收站，下次进手机档只剩一句「图没了」
 * （hydrate 会把读不到字节的索引项一并丢掉）。
 *
 * 扫一遍 localStorage 里所有 `leisure-hub:settings@` 前缀的键，各自取
 * `bgLocalImages[].id`。存档都很小，一次启动扫一遍的成本可忽略。
 * 「两档引用同一个 id」不是假设——「复制当前配置」会真的产出这种状态，
 * 没有这层检查，从副本里删掉一张壁纸会把原档的那张一起删掉。
 *
 * 入参 `overrides` 让调用方用**内存里的最新值**覆盖某一档的存档快照：删图与
 * reset 都是先改内存再落盘，此刻读盘拿到的是改之前的那一份，会把正要删的 id
 * 算成「仍被引用」而永远删不掉字节。
 *
 * **天气缓存刻意不做这套**：它按坐标缓存、可再生且有 TTL，为一份 15 分钟后自会
 * 刷新的数据引入引用计数是白付。判据是「字节不可再生，缓存可以」。
 */
function referencedImageIds(overrides?: Map<string, string[]>): Set<string> {
  const alive = new Set<string>()
  for (const { id, key } of scanProfileKeys('settings')) {
    const override = overrides?.get(id)
    if (override) {
      for (const imageId of override) alive.add(imageId)
      continue
    }
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as Partial<SettingsState>
      if (!Array.isArray(parsed?.bgLocalImages)) continue
      for (const item of parsed.bgLocalImages) {
        if (item && typeof item === 'object' && typeof item.id === 'string' && item.id) {
          alive.add(item.id)
        }
      }
    } catch {
      /*
       * 读不出来的那一档按「引用了未知内容」处理——继续，不把它的图算进 alive。
       *
       * 反过来（整个清理放弃）更糟：一份坏掉的存档会让孤儿永远清不掉。
       * 而漏算的代价有限：那一档本来也读不出自己的索引项。
       */
      continue
    }
  }
  return alive
}

/** 删掉没有任何档引用的字节。overrides 的含义见 referencedImageIds */
async function pruneOrphanImages(overrides?: Map<string, string[]>): Promise<void> {
  const alive = referencedImageIds(overrides)
  for (const id of await listImageIds()) {
    if (!alive.has(id)) await deleteImage(id)
  }
}

/** 删档之后清一次：那一档的存档键已经没了，它独占的字节就成了孤儿 */
export async function pruneImagesAfterProfileRemoval(): Promise<void> {
  await pruneOrphanImages()
}

export const useSettingsStore = defineStore('settings', () => {
  const bgMode = ref<BgMode>(DEFAULTS.bgMode)
  /** 纯色档的颜色组；至少一项，见 sanitizeColors */
  const bgColors = ref<string[]>([...DEFAULTS.bgColors])
  /** 本地图片组；url 字段由 hydrateLocalImages 填 */
  const bgLocalImages = ref<BgLocalImage[]>([])
  /**
   * 网络地址组；允许含空串行（用户加了行还没填）。
   *
   * 初值不是空数组而是那张默认壁纸——DEFAULTS.bgMode 是 'image'，列表为空时
   * bgFrames 一帧都没有，背景会退回底色，首次打开看到的是纯灰而不是壁纸。
   * 内容在 data/defaults.ts，理由见那里。
   */
  const bgUrls = ref<BgUrlItem[]>(buildDefaultBgUrls())
  const bgRotate = ref<Record<BgMode, boolean>>({ ...DEFAULTS.bgRotate })
  const bgInterval = ref<Record<BgMode, number>>({ ...DEFAULTS.bgInterval })
  const bgBlur = ref<number>(DEFAULTS.bgBlur)

  /**
   * 当前显示的是本档的第几帧。
   *
   * **不持久化**：它是运行期游标，轮换时每隔几秒就变一次，写进存档等于每隔几秒
   * 同步写一次 localStorage。开着轮换时刷新后从头开始，对「一组等价的背景」而言
   * 从哪张起并不重要。
   *
   * 关着轮换时它由 bgPick 决定（见下），刷新后能回到用户选的那一张。
   */
  const bgIndex = ref(0)

  /**
   * 未开轮换时用户选中的那一帧，按档各存一个。
   *
   * 与 bgIndex 分开是因为两者的性质不同：bgIndex 是运行期游标，轮换时每隔几秒
   * 变一次；bgPick 是一次明确的选择（点缩略图 / 点那个勾），必须活过刷新。
   * 合成一个的话，要么轮换把存档写爆，要么选择存不下来。
   *
   * 存的是帧的 key 而不是下标：bgFrames 会过滤掉字节丢失的本地图与空地址行，
   * 「列表里的第 3 个」和「第 3 帧」不是一回事，删掉中间一项后下标还会整体前移。
   */
  const bgPick = ref<Record<BgMode, string>>({ color: '', local: '', image: '' })
  const motion = ref<MotionMode>(DEFAULTS.motion)
  const glass = ref<GlassMode>(DEFAULTS.glass)
  /**
   * 主题色：派生出 --accent / --accent-solid，并给面板底色掺一层极淡的染色。
   *
   * 存单个值而不是像 bgColors 那样存一组——它不参与轮换，
   * 「当前主题色」永远只有一个。
   */
  const themeColor = ref<string>(DEFAULTS.themeColor)
  const scrimOpacity = ref<number>(DEFAULTS.scrimOpacity)
  const drawerSide = ref<DrawerSide>(DEFAULTS.drawerSide)
  /** 点击遮罩空白处是否关闭浮层（设置抽屉与对话框共用） */
  const closeOnScrim = ref<boolean>(DEFAULTS.closeOnScrim)
  /**
   * 设置手柄的纵向位置，0..1。
   *
   * 从 useEdgeHandle 的模块级 ref 搬进来（连它那份独立存档一起）。搬家的收益有两层：
   * 「重置为默认」少写一份存档，且这里不再有任何在**模块求值时**读按档键的地方——
   * 那是多配置档下唯一会早于索引就绪的读盘。停靠侧仍是上面的 drawerSide，
   * 拖动手柄时两者一起改。
   */
  const handleRatio = ref<number>(DEFAULTS.handleRatio)

  /*
   * 方块区域尺寸。
   *
   * 两档共存而不是二选一存一份：用户在 tab 间来回切换时，
   * 另一档的输入不该被清空。areaMode 只决定「哪一档参与计算」。
   *
   * 初值按当前配置档的预设取（见 areaDefaults）：手机档进来就是 cell 3×N，
   * 与它那张 3 列播种表互解。
   */
  const initialArea = areaDefaults()
  const areaMode = ref<AreaMode>(initialArea.areaMode)
  const areaWidth = ref<number>(initialArea.areaWidth)
  const areaHeight = ref<number>(initialArea.areaHeight)
  const areaCols = ref<number>(initialArea.areaCols)
  const areaRows = ref<number>(initialArea.areaRows)

  /*
   * 搜索。
   *
   * 三条全局开关加一张自定义引擎表——**每个搜索方块用哪个引擎存在它自己的
   * props 里**（见 types/widgetProps.ts 的 SEARCH_FIELDS），所以放两个方块可以
   * 一个百度一个 Google。这里留下的都是「不该逐方块分裂」的东西：
   * 建议与补全是隐私 / 输入法取舍，搜索记录是一份属于用户的记录（三个方块该看到
   * 同一份），自定义引擎表是所有方块共用的词典。
   *
   * 这四个字段落进 `:global` 而不是按档那份存档，理由同上再推一层：
   * 「不该逐方块分裂」的东西也不该逐配置档分裂。见文件头 settingsKey 那段。
   */
  const suggestEnabled = ref<boolean>(DEFAULTS.suggestEnabled)
  const inlineCompleteEnabled = ref<boolean>(DEFAULTS.inlineCompleteEnabled)
  const searchHistoryEnabled = ref<boolean>(DEFAULTS.searchHistoryEnabled)
  const customEngines = ref<CustomEngine[]>([])

  /** 系统偏好；motion 为 system 时由它决定是否动效 */
  const systemReduced = ref(false)
  /** 系统的「降低透明度」；glass 为 system 时由它决定是否磨砂 */
  const systemReducedTransparency = ref(false)

  /**
   * 旧存档里那张 data URL 本地图，等 hydrate 阶段搬进 IndexedDB。
   *
   * load() 是同步的而搬运是异步的，所以中间需要这个交接位。
   */
  let legacyLocalImage: { dataUrl: string; name: string } | null = null

  /**
   * 读全局那份存档（`:global`）。
   *
   * 缺席时**从按档存档里的旧字段迁移**：老用户的那四个值原本就写在
   * `:settings` 里（已被 claimLegacy 改名成 `@desktop`）。迁移只在这一处发生，
   * 之后 persistGlobal 会把它们写进 `:global`，按档那份不再写这些键。
   *
   * 不提 SCHEMA_VERSION 做整份丢弃的判据以外的事：这份存档只有四个字段，
   * 逐字段回落默认已经够。
   */
  function loadGlobal(legacy?: Partial<SettingsState>) {
    let source: Partial<GlobalState> | undefined
    try {
      const raw = localStorage.getItem(GLOBAL_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<GlobalState>
        if (parsed?.version === SCHEMA_VERSION) source = parsed
      }
    } catch {
      // 非法 JSON：当作没有这份存档，走下面的迁移 / 默认值
    }

    const from = source ?? legacy
    if (!from) return

    suggestEnabled.value =
      typeof from.suggestEnabled === 'boolean' ? from.suggestEnabled : DEFAULTS.suggestEnabled
    inlineCompleteEnabled.value =
      typeof from.inlineCompleteEnabled === 'boolean'
        ? from.inlineCompleteEnabled
        : DEFAULTS.inlineCompleteEnabled
    searchHistoryEnabled.value =
      typeof from.searchHistoryEnabled === 'boolean'
        ? from.searchHistoryEnabled
        : DEFAULTS.searchHistoryEnabled
    customEngines.value = sanitizeEngineList(from.customEngines)
  }

  /**
   * 读按档那份存档（`leisure-hub:settings@<active>`）；任一字段不合法就单独回退，不整体丢弃。
   *
   * 返回**整份 parsed**，供 loadGlobal 在 `:global` 缺席时当迁移源：老存档里
   * 那四个搜索字段就写在这一份里。读不到 / 读坏时返回 undefined。
   */
  function loadProfile(): Partial<SettingsState> | undefined {
    try {
      const raw = localStorage.getItem(settingsKey())
      if (!raw) return undefined

      const parsed = JSON.parse(raw) as Partial<SettingsState>
      if (parsed?.version !== SCHEMA_VERSION) return undefined

      bgMode.value = pick(parsed.bgMode, BG_MODES, DEFAULTS.bgMode)

      /*
       * 三档各自的列表，一律「新字段优先，缺了就从旧的单值字段迁移」。
       *
       * 不提 SCHEMA_VERSION：版本一变上面那句会整份丢弃存档（连方块区域尺寸、
       * 抽屉侧一起清空），代价远大于收益——与 closeOnScrim 当初的加法一致。
       */
      bgColors.value = Array.isArray(parsed.bgColors)
        ? sanitizeColors(parsed.bgColors)
        : // 旧存档只有单个 bgColor：包成一项，观感与改造前完全相同
          sanitizeColors(isHexColor(parsed.bgColor) ? [parsed.bgColor] : undefined)

      bgLocalImages.value = sanitizeLocalImages(parsed.bgLocalImages)

      bgUrls.value = Array.isArray(parsed.bgUrls)
        ? sanitizeUrls(parsed.bgUrls)
        : // 旧存档的单个 bgImage 迁成一行
          sanitizeUrls(
            typeof parsed.bgImage === 'string' && parsed.bgImage.trim()
              ? [{ id: nanoid(), url: parsed.bgImage.trim() }]
              : undefined,
          )

      bgRotate.value = sanitizeModeFlags(parsed.bgRotate, DEFAULTS.bgRotate)
      bgInterval.value = sanitizeModeIntervals(parsed.bgInterval)
      bgBlur.value = clampBlur(parsed.bgBlur)

      /*
       * 选中项。
       *
       * 只收字符串，不校验 key 是否还指向存在的帧——那一步交给读它的 watch：
       * 找不到就退回第一帧。在这里校验反而更早：bgLocalImages 的 url 要等
       * hydrateLocalImages 异步接完才有，此刻本地图那档的帧全是空的。
       */
      if (parsed.bgPick && typeof parsed.bgPick === 'object') {
        bgPick.value = {
          color: typeof parsed.bgPick.color === 'string' ? parsed.bgPick.color : '',
          local: typeof parsed.bgPick.local === 'string' ? parsed.bgPick.local : '',
          image: typeof parsed.bgPick.image === 'string' ? parsed.bgPick.image : '',
        }
      }

      /*
       * 旧的单张本地图：data URL 还在 localStorage 里，搬进 IndexedDB 再挂进列表。
       *
       * 异步进行（fetch data URL + IDB 写入都是异步的），所以这里只登记待迁移的
       * 载荷，实际搬运在 hydrateLocalImages() 里与「补 objectURL」一起做——
       * 两者都要触碰 IDB，合成一次遍历。
       */
      if (
        typeof parsed.bgLocalImageUrl === 'string' &&
        parsed.bgLocalImageUrl.startsWith('data:image/') &&
        bgLocalImages.value.length === 0
      ) {
        legacyLocalImage = {
          dataUrl: parsed.bgLocalImageUrl,
          name: typeof parsed.bgLocalImageName === 'string' ? parsed.bgLocalImageName : '',
        }
      }
      motion.value = pick(parsed.motion, MOTION_MODES, DEFAULTS.motion)
      glass.value = pick(parsed.glass, GLASS_MODES, DEFAULTS.glass)
      /*
       * 主题色。
       *
       * 同样不提 SCHEMA_VERSION（见上面那句 `parsed.version !== SCHEMA_VERSION`——
       * 版本一变整份存档丢弃，用户的背景图、区域尺寸、抽屉侧全部清空）。
       * 旧存档没这个字段，undefined 时落到默认值，观感与改造前完全一致。
       */
      /*
       * 读盘也要拍 alpha（理由见 setThemeColor）：存档可能来自手改，
       * 或早于这条约束的版本，带 alpha 的值绕过 setter 直接落进 ref。
       */
      const storedTheme = isHexColor(parsed.themeColor) ? normalizeHex(parsed.themeColor) : null
      themeColor.value = storedTheme ? alphaToHex(storedTheme, 255) : DEFAULTS.themeColor
      scrimOpacity.value = clampScrimOpacity(parsed.scrimOpacity)
      drawerSide.value = pick(parsed.drawerSide, DRAWER_SIDES, DEFAULTS.drawerSide)
      // 旧版本存档没有这个字段，undefined 时保持默认的「开启」
      closeOnScrim.value =
        typeof parsed.closeOnScrim === 'boolean' ? parsed.closeOnScrim : DEFAULTS.closeOnScrim
      /*
       * 手柄高度。
       *
       * 旧存档里没有它（那时它独占 `starfall-hub:settings-handle`）。
       * 认领旧键那一步在 load() 里做——这里只管本份存档里有没有，
       * 而「有没有」正是 load() 判断该不该去认领的依据。
       */
      handleRatio.value =
        typeof parsed.handleRatio === 'number'
          ? clampHandleRatio(parsed.handleRatio)
          : DEFAULTS.handleRatio
      /*
       * 区域四项的回落值按**当前档的预设**取，不是一套写死的数。
       *
       * 手机档缺字段时要落到 cell 3×N，落到电脑档的 pixel 1440×720 会让它那张
       * 3 列的播种表被 resize 成 15 列——首屏排布完全不是设计好的样子。
       */
      const area = areaDefaults()
      areaMode.value = pick(parsed.areaMode, AREA_MODES, area.areaMode)
      areaWidth.value = clampArea(parsed.areaWidth, AREA_SIZE_MIN, AREA_SIZE_MAX)
      areaHeight.value = clampArea(parsed.areaHeight, AREA_SIZE_MIN, AREA_SIZE_MAX)
      areaCols.value = clampArea(parsed.areaCols, AREA_CELL_MIN, AREA_CELL_MAX)
      areaRows.value = clampArea(parsed.areaRows, AREA_CELL_MIN, AREA_CELL_MAX)

      /*
       * 搜索那四个字段不在这里读。
       *
       * 它们已经搬去 `:global`（见 loadGlobal）。这里把整份 parsed 交回给调用方，
       * 让它在 `:global` 缺席时当作迁移源——老存档里那四个键还在。
       */
      return parsed
    } catch {
      // 非法 JSON：保持默认设置
      return undefined
    }
  }

  /**
   * 读盘：按档一份 + 全局一份 + 一次性认领旧手柄键。
   *
   * 顺序要紧两处：
   * - 先读按档那份，它的返回值是 `:global` 缺席时的迁移源；
   * - 手柄高度**只在按档存档里没有这个字段时**才去认领旧键。反过来（无条件认领）
   *   会让老用户每次启动都被那个旧值覆盖掉他后来拖到的位置——直到某次启动
   *   恰好在写盘之后。
   */
  function load() {
    const profile = loadProfile()
    loadGlobal(profile)
    if (typeof profile?.handleRatio !== 'number') {
      const legacy = claimLegacyHandleRatio()
      if (legacy !== null) handleRatio.value = legacy
    }
  }

  function persistGlobal() {
    const payload: GlobalState = {
      version: SCHEMA_VERSION,
      suggestEnabled: suggestEnabled.value,
      inlineCompleteEnabled: inlineCompleteEnabled.value,
      searchHistoryEnabled: searchHistoryEnabled.value,
      customEngines: customEngines.value,
    }
    try {
      localStorage.setItem(GLOBAL_KEY, JSON.stringify(payload))
    } catch {
      // 存储不可用（隐私模式 / 配额）时静默降级为内存状态
    }
  }

  function persist() {
    const payload: SettingsState = {
      version: SCHEMA_VERSION,
      bgMode: bgMode.value,
      bgColors: bgColors.value,
      /*
       * 只存 id + name。
       *
       * url 是 objectURL，出了本次文档就是死链；字节本身在 IndexedDB 里按 id 存，
       * 两边靠 id 对齐（见 BgLocalImage 与 utils/imageStore 的注释）。
       */
      bgLocalImages: bgLocalImages.value.map(({ id, name }) => ({ id, name })),
      bgUrls: bgUrls.value,
      bgRotate: bgRotate.value,
      bgInterval: bgInterval.value,
      bgPick: bgPick.value,
      bgBlur: bgBlur.value,
      motion: motion.value,
      glass: glass.value,
      themeColor: themeColor.value,
      scrimOpacity: scrimOpacity.value,
      drawerSide: drawerSide.value,
      closeOnScrim: closeOnScrim.value,
      handleRatio: handleRatio.value,
      areaMode: areaMode.value,
      areaWidth: areaWidth.value,
      areaHeight: areaHeight.value,
      areaCols: areaCols.value,
      areaRows: areaRows.value,
      /*
       * 搜索那四个字段**不写在这里**（类型上已改为可选，见 SettingsState）。
       *
       * 它们归 persistGlobal 写进 `:global`。留在这里会得到两份真相：改一次设置
       * 写两处、而 loadProfile 又不读它们，于是按档那份从此只增不减地陈旧下去，
       * 将来谁读到它都会拿到用户几个版本前的选择。
       */
    }
    try {
      localStorage.setItem(settingsKey(), JSON.stringify(payload))
    } catch {
      // 存储不可用（隐私模式 / 配额）时静默降级为内存状态
    }
  }

  /** 最终是否播放动效：system 交给系统偏好，其余两档由用户强制 */
  const motionEnabled = computed(() => {
    if (motion.value === 'always') return true
    if (motion.value === 'off') return false
    return !systemReduced.value
  })

  /** 最终是否启用磨砂：与 motionEnabled 同构 */
  const glassEnabled = computed(() => {
    if (glass.value === 'always') return true
    if (glass.value === 'off') return false
    return !systemReducedTransparency.value
  })

  /**
   * 当前档的帧列表——渲染层唯一的入口。
   *
   * 三档在这里归一成同一种形态（见 BgFrame）：纯色档每个颜色一帧，
   * 本地档每张已 hydrate 出 objectURL 的图一帧，网络档每条合法地址一帧。
   *
   * 不合法 / 未就绪的项直接不出现在列表里，而不是产出一个「空帧」——
   * 渲染层只要按列表画就行，不必再逐帧判断能不能用。列表为空时（例如网络档
   * 一条地址都还没填）背景退回底色，与改造前地址非法时的行为一致。
   */
  const bgFrames = computed<BgFrame[]>(() => {
    if (bgMode.value === 'color') {
      return bgColors.value.map((color) => ({
        key: `c:${color}`,
        sig: `c:${color}`,
        kind: 'color' as const,
        color,
      }))
    }

    if (bgMode.value === 'local') {
      return bgLocalImages.value
        .filter((item): item is BgLocalImage & { url: string } => item.url !== null)
        .map((item) => ({
          key: `l:${item.id}`,
          sig: `l:${item.id}`,
          kind: 'image' as const,
          href: item.url,
        }))
    }

    const out: BgFrame[] = []
    for (const item of bgUrls.value) {
      const href = resolveImageUrl(item.url)
      if (!href) continue
      out.push({
        key: `u:${item.id}`,
        /*
         * sig 带上 href：同一行地址被改写时 key（id）不变，只有 sig 变。
         * 渲染层靠 sig 判断「这一帧的内容换了」，否则改地址不会触发淡入。
         */
        sig: `u:${item.id}:${href}`,
        kind: 'image' as const,
        href,
      })
    }
    return out
  })

  /** 本档是否在放图片——决定压暗层 / 噪点层与模糊滑块的去向 */
  const isImageMode = computed(() => bgMode.value !== 'color')

  /** 当前档的底色：纯色档取当前帧，图片档取第一个颜色作为图未就绪时的垫底 */
  const bgBaseColor = computed(() => {
    if (bgMode.value === 'color') {
      const frames = bgFrames.value
      if (frames.length === 0) return DEFAULTS.bgColors[0]
      return frames[bgIndex.value % frames.length].color ?? DEFAULTS.bgColors[0]
    }
    return bgColors.value[0] ?? DEFAULTS.bgColors[0]
  })

  /**
   * 轮换是否真的在跑。
   *
   * 开关开着但只有一帧时不算——一张图之间「轮换」没有意义，定时器空转还会
   * 每隔几秒触发一次无变化的重算。UI 也读它来决定是否提示「至少两项才会轮换」。
   */
  const bgRotating = computed(
    () => bgRotate.value[bgMode.value] && bgFrames.value.length > 1,
  )

  /** 当前档的轮换间隔，毫秒 */
  const bgIntervalMs = computed(() => bgInterval.value[bgMode.value] * 1000)

  /** 实际生效的模糊：纯色底上模糊不产生任何视觉差异，只在图片档计入 */
  const effectiveBlur = computed(() => (isImageMode.value ? bgBlur.value : 0))

  /** 把帧里的地址拼成 CSS 的 url(...)，转义交给 cssUrl */
  function frameBackground(frame: BgFrame): string {
    return frame.href ? `url("${cssUrl(frame.href)}")` : 'none'
  }

  /* ── 轮换游标 ─────────────────────────────── */

  /**
   * 前进一帧；列表为空时归零。
   *
   * 只动 bgIndex，不写 bgPick——轮换是运行期行为，不该覆盖用户关掉轮换时选的那一张。
   * 关掉轮换后 bgIndex 会由 bgPick 重新算出来（见下面那个 watch）。
   */
  function advanceBg() {
    const total = bgFrames.value.length
    bgIndex.value = total > 0 ? (bgIndex.value + 1) % total : 0
  }

  /** 直接跳到第 n 帧 */
  function setBgIndex(next: number) {
    const total = bgFrames.value.length
    if (total === 0) {
      bgIndex.value = 0
      return
    }
    bgIndex.value = ((Math.round(next) % total) + total) % total
  }

  /**
   * 选中某一帧作为背景（点缩略图 / 点地址行那个勾）。
   *
   * 收 key 而不是下标：调用方手里是「这一行 / 这张图」，而它对应第几帧要看
   * bgFrames 过滤掉了多少项（字节丢失的本地图、空地址行）。让 UI 去算这个下标，
   * 中间任意一项失效就会选错一张。
   */
  function pickBgFrame(key: string) {
    const at = bgFrames.value.findIndex((frame) => frame.key === key)
    if (at < 0) return
    bgIndex.value = at
    bgPick.value = { ...bgPick.value, [bgMode.value]: key }
  }

  /** 当前帧的 key，UI 据此标出「正在用的是这个」 */
  const bgCurrentKey = computed(() => bgFrames.value[bgIndex.value]?.key ?? '')

  /*
   * 关着轮换时，把游标对回 bgPick 指的那一帧。
   *
   * 覆盖三种情况：刷新后（load 只恢复 bgPick）、刚关掉轮换、以及列表增删导致
   * 下标整体位移。找不到（那一帧被删了 / 存档里的 key 已失效）就退回第一帧，
   * 与「关掉轮换默认选第一张」一致。
   */
  watch(
    [bgRotating, bgFrames, () => bgPick.value[bgMode.value]],
    ([rotating, frames, key]) => {
      if (rotating) return
      if (frames.length === 0) {
        bgIndex.value = 0
        return
      }
      const at = frames.findIndex((frame) => frame.key === key)
      bgIndex.value = at >= 0 ? at : 0
    },
    { immediate: true },
  )

  /*
   * 换档 / 列表变短时把游标夹回范围内。
   *
   * 删掉最后一张图后 bgIndex 会指到列表外，此时 bgFrames[bgIndex] 是 undefined，
   * 渲染层会当成「没有帧」而退回底色——图明明还在却不显示。
   */
  watch(
    () => bgFrames.value.length,
    (total) => {
      if (total > 0 && bgIndex.value >= total) bgIndex.value = 0
    },
  )

  /*
   * 换档时把游标交还给本档自己的选择。
   *
   * 不再一律归零：bgPick 是按档存的，回到某一档就该回到上次在那一档选的那张，
   * 而不是每次切 tab 都跳回第一张。开着轮换的档没有「选中项」，从头开始即可。
   */
  watch(bgMode, (mode) => {
    if (bgRotate.value[mode]) {
      bgIndex.value = 0
      return
    }
    const at = bgFrames.value.findIndex((frame) => frame.key === bgPick.value[mode])
    bgIndex.value = at >= 0 ? at : 0
  })

  /* ── 本地图片：与 IndexedDB 的往来 ────────────── */

  /** IndexedDB 不可用（隐私模式 / 被策略禁用）时置位，UI 据此提示「刷新后会丢失」 */
  const localStoreUnavailable = ref(false)

  /**
   * 启动时把 IndexedDB 里的字节接回来。
   *
   * 做三件事，合成一次遍历，因为它们都要触碰同一个库：
   *  1. 旧存档那张 data URL 本地图搬进 IDB（只在首次升级时发生）；
   *  2. 给每个索引项造 objectURL——存档里没有可用的 url，必须重新生成；
   *  3. 清掉孤儿字节：settings 里已经删掉、但 IDB 里还留着的 id。
   *     没有这一步，删过的壁纸会永久占着磁盘且没有任何入口能再删。
   */
  async function hydrateLocalImages() {
    // 1. 旧单图迁移
    if (legacyLocalImage) {
      const { dataUrl, name } = legacyLocalImage
      legacyLocalImage = null
      const blob = await dataUrlToBlob(dataUrl)
      if (blob) {
        const id = nanoid()
        if (await putImage(id, blob)) {
          bgLocalImages.value = [{ id, name, url: URL.createObjectURL(blob) }]
        } else {
          localStoreUnavailable.value = true
          // IDB 写不进去，至少让本次会话还能看到这张图
          bgLocalImages.value = [{ id, name, url: URL.createObjectURL(blob) }]
        }
      }
    }

    // 2. 补 objectURL
    const alive = new Set<string>()
    const next: BgLocalImage[] = []
    for (const item of bgLocalImages.value) {
      if (item.url) {
        // 刚迁移过来的那张已经有 url 了，不必再读一次库
        alive.add(item.id)
        next.push(item)
        continue
      }
      const blob = await getImage(item.id)
      if (!blob) {
        // 字节没了（用户清过站点数据 / 迁移失败）：索引项一起丢掉，不留死项
        continue
      }
      alive.add(item.id)
      next.push({ ...item, url: URL.createObjectURL(blob) })
    }
    bgLocalImages.value = next

    /*
     * 3. 清孤儿——alive 集合必须是**所有档**的并集，不是这一档的。
     *
     * 曾经就用上面那个 alive（只含当前档），多档之后等于「打开电脑档就删掉手机档
     * 的全部壁纸字节」，见 referencedImageIds 开头那段。overrides 把当前档换成
     * 内存里刚整理过的这一份：存档里可能还留着刚被丢掉的死项（字节读不出来的
     * 那些），照存档算会把它们当成仍被引用，孤儿就永远清不掉。
     */
    await pruneOrphanImages(new Map([[activeProfileId(), [...alive]]]))
  }

  function setBgMode(next: BgMode) {
    bgMode.value = pick(next, BG_MODES, DEFAULTS.bgMode)
  }

  /* ── 纯色档 ───────────────────────────────── */

  /**
   * 加入一个颜色并让它立即显示。
   *
   * 已在组里就只是跳过去显示，不重复添加——重复项在轮换里只表现为
   * 「换了一次但看不出变化」。
   */
  function addBgColor(next: string) {
    const norm = normalizeHex(next)
    if (!norm) return
    const existing = bgColors.value.indexOf(norm)
    if (existing >= 0) {
      setBgIndex(existing)
      bgPick.value = { ...bgPick.value, color: `c:${norm}` }
      return
    }
    if (bgColors.value.length >= BG_COLOR_MAX) return
    bgColors.value = [...bgColors.value, norm]
    const at = bgColors.value.length - 1
    setBgIndex(at)
    // 关闭轮换时新增颜色也要成为当前帧，否则列表变化会被 watch 拉回旧颜色。
    bgPick.value = { ...bgPick.value, color: `c:${norm}` }
  }

  /**
   * 移除一个颜色。
   *
   * 组里只剩一个时拒绝——纯色档必须有至少一个颜色可显示，否则整屏没有底色。
   * UI 侧也据此把最后一个色块的删除入口禁掉，不让用户点了却没反应。
   */
  function removeBgColor(color: string) {
    if (bgColors.value.length <= 1) return
    const norm = normalizeHex(color) ?? color
    const currentColor = bgColors.value[bgIndex.value]
    const currentIndex = bgIndex.value
    const next = bgColors.value.filter((item) => item !== norm && item !== color)
    bgColors.value = next

    // 删除当前帧之前的颜色时，仍然把游标留在原来的颜色上，而不是按旧下标落到下一帧。
    if (currentColor && next.includes(currentColor)) {
      setBgIndex(next.indexOf(currentColor))
    } else if (next.length > 0) {
      setBgIndex(Math.min(currentIndex, next.length - 1))
    }

    // 删除当前颜色时把选择指针交给仍有效的帧，避免刷新后再次指向已删除的 key。
    if (bgPick.value.color === `c:${norm}`) {
      bgPick.value = { ...bgPick.value, color: next[0] ? `c:${next[0]}` : '' }
    }
  }

  /**
   * 色板上点一下：不在组里就加入，已在组里就移除。
   *
   * 真正的多选语义——点选中的那个就是取消选中。曾经的做法是「已在组里则跳过去
   * 显示」，但那样色板就没有任何取消入口了，选错一个颜色只能去改存档。
   * 只剩一个时 removeBgColor 会拒绝（纯色档必须有底色），表现为点了没变化，
   * 这一点由 UI 侧的 title 说明。
   */
  function toggleBgColor(color: string) {
    const norm = normalizeHex(color)
    if (!norm) return
    if (bgColors.value.includes(norm)) removeBgColor(norm)
    else addBgColor(norm)
  }

  /**
   * 整组换成单独一个颜色。
   *
   * 未开轮换时色板是单选的，点一下就该只剩这一个颜色。用 addBgColor 做不到：
   * 它是追加语义，点第二下会变成两个颜色都在组里、只是显示跳过去了——
   * 看起来像单选，实际上悄悄攒了一组，一开轮换就全冒出来。
   */
  function setBgColorOnly(color: string) {
    const norm = normalizeHex(color)
    if (!norm) return
    bgColors.value = [norm]
    setBgIndex(0)
    /*
     * 同步 bgPick，别让它继续指着刚被换掉的那个颜色。
     *
     * 只剩一个颜色时游标怎么算都是 0，眼下不会显示错。但存档里留着一个失效的 key，
     * 下次开轮换、再加几个颜色时，那个 watch 会按它去 findIndex——找不到就退回第一帧，
     * 表现为「明明选的是第三个，刷新后跳回第一个」。
     */
    bgPick.value = { ...bgPick.value, color: `c:${norm}` }
  }

  /** 改写第 n 个颜色（取色面板拖动时逐帧调用） */
  function updateBgColorAt(index: number, next: string) {
    const norm = normalizeHex(next)
    if (!norm || index < 0 || index >= bgColors.value.length) return
    // 与别的档重了就不写：会造成两个一模一样的色块
    if (bgColors.value.some((item, at) => item === norm && at !== index)) return
    const previous = bgColors.value[index]
    const copy = [...bgColors.value]
    copy[index] = norm
    bgColors.value = copy
    if (bgPick.value.color === `c:${previous}`) {
      bgPick.value = { ...bgPick.value, color: `c:${norm}` }
    }
  }

  /* ── 本地图片档 ───────────────────────────── */

  /**
   * 加入若干张本地图片，返回被拒绝的文件名与原因。
   *
   * 逐个校验 + 写库，而不是先全部读进内存再一次性写：一次选十张 8MB 的图，
   * 前者的峰值内存是一张，后者是十张。
   */
  async function addBgLocalImages(
    files: File[],
  ): Promise<{ name: string; reason: string }[]> {
    const rejected: { name: string; reason: string }[] = []

    for (const file of files) {
      /*
       * 上限恒为 BG_IMAGE_MAX，不看 bgRotate。
       *
       * 曾经关着轮换时压到 1 张，理由是「多张只在轮换时有意义」。那个理由不成立：
       * 关着轮换时列表是个图库，用哪一张由 bgPick 决定，攒着几张随时切很正常。
       * 而压到 1 的代价是想换图必须先删——本地图删的是 IndexedDB 里的字节，不可逆。
       */
      if (bgLocalImages.value.length >= BG_IMAGE_MAX) {
        rejected.push({ name: file.name, reason: `最多 ${BG_IMAGE_MAX} 张` })
        continue
      }
      if (!file.type.startsWith('image/')) {
        rejected.push({ name: file.name, reason: '不是图片' })
        continue
      }
      if (file.size > LOCAL_IMAGE_MAX_BYTES) {
        rejected.push({
          name: file.name,
          reason: `超过 ${LOCAL_IMAGE_MAX_BYTES / 1024 / 1024}MB`,
        })
        continue
      }

      const id = nanoid()
      const stored = await putImage(id, file)
      if (!stored) localStoreUnavailable.value = true
      /*
       * 即使写库失败也挂进列表：objectURL 在本次会话内完全可用，
       * 用户能看到自己刚选的图。刷新后会因为读不到字节而在 hydrate 阶段被丢掉，
       * localStoreUnavailable 会让抽屉把这件事说出来。
       */
      bgLocalImages.value = [
        ...bgLocalImages.value,
        { id, name: file.name, url: URL.createObjectURL(file) },
      ]
    }

    return rejected
  }

  /**
   * 移除一张本地图：撤销 objectURL、摘索引，**没有别的档引用时**才删字节。
   *
   * 「复制当前配置」会让两档指着同一个 id（IDB 里那份字节是全局共享的，抄存档时
   * 刻意不抄字节）。无条件 deleteImage 等于「从副本里删掉一张壁纸，原档的那张
   * 也一起没了」——8MB 的照片，不可逆。
   *
   * overrides 传**删除之后**的本档 id 列表：此刻内存已经改完但还没落盘（persist
   * 走 watch，在下一个 tick），照存档快照算会把正要删的 id 算成仍被引用。
   */
  async function removeBgLocalImage(id: string) {
    const target = bgLocalImages.value.find((item) => item.id === id)
    // 撤销才会真正释放那份 Blob，否则它一直挂在文档上直到关标签页
    if (target?.url) URL.revokeObjectURL(target.url)
    bgLocalImages.value = bgLocalImages.value.filter((item) => item.id !== id)

    const mine = bgLocalImages.value.map((item) => item.id)
    if (!referencedImageIds(new Map([[activeProfileId(), mine]])).has(id)) {
      await deleteImage(id)
    }
  }

  /* ── 网络图片档 ───────────────────────────── */

  /** 追加一行空地址（列表末尾那个占位按钮）；上限恒为 BG_IMAGE_MAX，与轮换开关无关 */
  function addBgUrl(url = ''): string | null {
    if (bgUrls.value.length >= BG_IMAGE_MAX) return null
    const id = nanoid()
    bgUrls.value = [...bgUrls.value, { id, url: url.trim() }]
    return id
  }

  /**
   * 改写某一行的地址。
   *
   * 空串照收（用户清空了想重填），非空则必须过协议白名单；不合法时不写入，
   * 由 UI 侧把「格式不对」提示出来——store 静默丢弃会让输入框看起来吃字。
   */
  function setBgUrlAt(id: string, url: string): boolean {
    const trimmed = url.trim()
    if (trimmed && !isSafeImageUrl(trimmed)) return false
    bgUrls.value = bgUrls.value.map((item) => (item.id === id ? { ...item, url: trimmed } : item))
    return true
  }

  function removeBgUrl(id: string) {
    bgUrls.value = bgUrls.value.filter((item) => item.id !== id)
  }

  /* ── 轮换 ─────────────────────────────────── */

  /**
   * 只改当前档的开关：整表替换，浅比较才能看到变化（persist 的 watch 没开 deep）。
   *
   * 关掉时把这一档收敛成「只显示一个背景」的状态，但不破坏用户的列表：
   *  - 纯色 / 本地图 / 网络地址：**列表不动**，只确保有一个选中项。删掉图和地址是
   *    不可逆的（图连字节一起没），而用户很可能只是临时关掉轮换。
   *    原来选中的那一项若还在就留着，只有没选过（或选的那项已失效）才落到第一项。
   */
  function setBgRotate(mode: BgMode, next: boolean) {
    bgRotate.value = { ...bgRotate.value, [mode]: next }
    if (next) return

    /*
     * 选中项落到第一项——但只在原来没有有效选中项时。
     *
     * 「第一项」而不是「当前正显示的那一项」：关掉轮换的那一刻画面停在轮换走到的
     * 某一帧上，把它当成用户的选择是替用户做决定。
     *
     * 而已经选过的那一项要留住：各档的列表不随开关增删，用户完全可能
     * 选中第三张、开一下轮换看看效果、再关回来——每次都跳回第一张等于把
     * 那次明确的点击丢掉。
     *
     * bgFrames 此刻可能还没跟上，所以按 mode 各自在源数组里找，而不是读 bgFrames。
     */
    const prev = bgPick.value[mode]
    let key = ''
    if (mode === 'color') {
      const at = bgColors.value.find((color) => `c:${color}` === prev)
      key = at ? prev : bgColors.value[0] ? `c:${bgColors.value[0]}` : ''
    } else if (mode === 'local') {
      const valid = bgLocalImages.value.filter((item) => item.url !== null)
      const kept = valid.find((item) => `l:${item.id}` === prev)
      const first = kept ?? valid[0]
      key = first ? `l:${first.id}` : ''
    } else {
      const valid = bgUrls.value.filter((item) => resolveImageUrl(item.url) !== null)
      const kept = valid.find((item) => `u:${item.id}` === prev)
      const first = kept ?? valid[0]
      key = first ? `u:${first.id}` : ''
    }
    bgPick.value = { ...bgPick.value, [mode]: key }
  }

  function setBgIntervalFor(mode: BgMode, next: number) {
    bgInterval.value = { ...bgInterval.value, [mode]: clampInterval(next) }
  }

  function setBgBlur(next: number) {
    bgBlur.value = clampBlur(next)
  }

  function setMotion(next: MotionMode) {
    motion.value = pick(next, MOTION_MODES, DEFAULTS.motion)
  }

  function setGlass(next: GlassMode) {
    glass.value = pick(next, GLASS_MODES, DEFAULTS.glass)
  }

  /**
   * 设主题色。
   *
   * 非法值静默忽略而不是回落到默认：调用方是色板与取色面板，
   * 后者拖动时逐帧回调，中途出现一个不合法值就跳回默认色会闪一下。
   *
   * **alpha 一律拍成不透明**。ColorPicker 带透明度滑杆，而半透明的主题色
   * 会同时毁掉它的两个用途：开关轨道透出底下的面板色，「开」态读不出来；
   * 面板染色那一步 color-mix 掺进来的也是半透明值，等于什么都没掺。
   * 背景色那边透明度是有意义的（透出壁纸），这里没有。
   */
  function setThemeColor(next: string) {
    const norm = normalizeHex(next)
    if (!norm) return
    themeColor.value = alphaToHex(norm, 255)
  }

  function setScrimOpacity(next: number) {
    scrimOpacity.value = clampScrimOpacity(next)
  }

  function setDrawerSide(next: DrawerSide) {
    drawerSide.value = pick(next, DRAWER_SIDES, DEFAULTS.drawerSide)
  }

  /**
   * 设手柄纵向位置，0..1。
   *
   * 与 setDrawerSide 成对：拖动手柄时两者一起改（见 useEdgeHandle 的 follow）。
   * 夹取在这里做而不是让调用方自己夹——拖拽是逐帧回调，指针拖出视口时
   * clientY / height 会越界，越界值落进 ref 会让手柄贴到屏幕角落之外。
   */
  function setHandleRatio(next: number) {
    handleRatio.value = clampHandleRatio(next)
  }

  function setCloseOnScrim(next: boolean) {
    closeOnScrim.value = next
  }

  function setAreaMode(next: AreaMode) {
    // 非法值回落到本档预设的档位，理由同 areaDefaults：不存在一套跨档通用的默认
    areaMode.value = pick(next, AREA_MODES, areaDefaults().areaMode)
  }

  function setAreaWidth(next: number) {
    areaWidth.value = clampArea(next, AREA_SIZE_MIN, AREA_SIZE_MAX)
  }

  function setAreaHeight(next: number) {
    areaHeight.value = clampArea(next, AREA_SIZE_MIN, AREA_SIZE_MAX)
  }

  function setAreaCols(next: number) {
    areaCols.value = clampArea(next, AREA_CELL_MIN, AREA_CELL_MAX)
  }

  function setAreaRows(next: number) {
    areaRows.value = clampArea(next, AREA_CELL_MIN, AREA_CELL_MAX)
  }

  /** 一键跟随画面：两个字段一起置回 AREA_AUTO，交给实测反解 */
  function resetAreaSize() {
    areaWidth.value = AREA_AUTO
    areaHeight.value = AREA_AUTO
  }

  function resetAreaCells() {
    areaCols.value = AREA_AUTO
    areaRows.value = AREA_AUTO
  }

  /**
   * 当前档位是否有任一轴被指定。
   *
   * 用「任一」而不是「全部」：两个轴各自独立生效，只填宽度也是有效设置，
   * 此时「自动」按钮就该可点。
   */
  const areaPixelFixed = computed(() => areaWidth.value > 0 || areaHeight.value > 0)
  const areaCellFixed = computed(() => areaCols.value > 0 || areaRows.value > 0)

  /* ── 搜索 ────────────────────────────────────────── */

  function setSuggestEnabled(next: boolean) {
    suggestEnabled.value = next
  }

  function setInlineCompleteEnabled(next: boolean) {
    inlineCompleteEnabled.value = next
  }

  function setSearchHistoryEnabled(next: boolean) {
    searchHistoryEnabled.value = next
  }

  /**
   * 追加一条自定义引擎，返回是否成功。
   *
   * 校验走与读盘同一个 sanitizeCustomEngine：表单之外还可能有别的写入路径
   * （将来的导入功能），让所有入口共用一处规则，而不是各自记得校验。
   */
  function addCustomEngine(name: string, url: string): boolean {
    if (customEngines.value.length >= CUSTOM_ENGINE_MAX) return false
    const engine = sanitizeCustomEngine({ id: nanoid(), name, url })
    if (!engine) return false
    customEngines.value = [...customEngines.value, engine]
    return true
  }

  function removeCustomEngine(id: string) {
    customEngines.value = customEngines.value.filter((engine) => engine.id !== id)
  }

  /**
   * 内置 + 自定义的合表，供引擎菜单、快捷行、编辑表单直接遍历。
   *
   * 自定义项一律 icon: 'custom' 且不带 suggest——让用户填任意 JSONP 地址
   * 等于给自己开一个「任意第三方 JS 执行」的入口。这条边界是刻意的。
   */
  const allEngines = computed<EngineDef[]>(() => [
    ...ENGINES,
    ...customEngines.value.map((engine) => ({
      id: engine.id,
      name: engine.name,
      url: engine.url,
      icon: 'custom' as const,
    })),
  ])

  /**
   * 按 id 取引擎，查不到时回退到默认引擎。
   *
   * 每个搜索方块把 engineId 存在自己的 props 里，用户可能把某条自定义引擎删掉，
   * 于是那些方块的 id 就悬空了。回退而不是渲染成空：方块仍然能搜，
   * 也不在渲染期间偷偷改写方块的 props——用户可能只是想再添一条同名的回来。
   */
  function resolveEngine(id: unknown): EngineDef {
    const found =
      typeof id === 'string' ? allEngines.value.find((engine) => engine.id === id) : undefined
    return found ?? ENGINES.find((engine) => engine.id === DEFAULT_ENGINE_ID) ?? ENGINES[0]
  }

  /**
   * 恢复默认设置。
   *
   * 一律逐字段写回 DEFAULTS 而不是「重建 store」：那些 watch（persist、
   * data-motion / data-glass、两个 CSS 变量）都挂在现有的 ref 上，
   * 换掉引用等于让它们全部失联。
   *
   * **作用域是当前配置档**：区域尺寸与手柄高度回到**这一档预设**的值（见
   * areaDefaults），不是一套写死的数——手机档重置后该是 cell 3×N，落到电脑档的
   * pixel 1440×720 会把它那张 3 列的布局 resize 成 15 列。全局那四个搜索字段
   * 仍一并重置：它们只有一份，「重置设置」不该留着上次的自定义引擎表。
   */
  function reset() {
    bgMode.value = DEFAULTS.bgMode
    bgColors.value = [...DEFAULTS.bgColors]
    /*
     * 图片字节一并清掉：留着就是永久孤儿，没有任何入口能再删。
     *
     * 但**只删没有别的档引用的**——理由同 removeBgLocalImage。overrides 传空数组：
     * 重置后本档一张不留，此刻存档里那份旧快照还在（persist 走 watch，下个 tick 才写）。
     */
    const doomed = bgLocalImages.value.map((item) => item.id)
    for (const item of bgLocalImages.value) {
      if (item.url) URL.revokeObjectURL(item.url)
    }
    bgLocalImages.value = []
    const aliveElsewhere = referencedImageIds(new Map([[activeProfileId(), []]]))
    for (const id of doomed) {
      if (!aliveElsewhere.has(id)) void deleteImage(id)
    }
    /*
     * 网络地址回到那张默认壁纸，不是清空。
     *
     * DEFAULTS.bgMode 是 'image'，清空会让 bgFrames 一帧都没有、背景退回底色——
     * 「重置」的结果就成了一屏纯灰，与首次打开看到的完全不同。
     */
    bgUrls.value = buildDefaultBgUrls()
    bgRotate.value = { ...DEFAULTS.bgRotate }
    bgInterval.value = { ...DEFAULTS.bgInterval }
    bgIndex.value = 0
    /*
     * bgPick 三档一起清空，不去指向刚建的那一行。
     *
     * 关着轮换时那个 watch 会按 key 找不到而退回第一帧（见它的注释），
     * 而默认每档都只有一帧，「第一帧」就是唯一正确的答案。写一个具体的 key
     * 反而要求这里知道 buildDefaultBgUrls 现取的是哪个 id。
     */
    bgPick.value = { color: '', local: '', image: '' }
    bgBlur.value = DEFAULTS.bgBlur
    motion.value = DEFAULTS.motion
    glass.value = DEFAULTS.glass
    themeColor.value = DEFAULTS.themeColor
    scrimOpacity.value = DEFAULTS.scrimOpacity
    drawerSide.value = DEFAULTS.drawerSide
    closeOnScrim.value = DEFAULTS.closeOnScrim
    handleRatio.value = DEFAULTS.handleRatio
    /*
     * 区域四项回**本档预设**，不是 DEFAULTS 里的四个数——DEFAULTS 已经没有它们了
     * （见 areaDefaults 那段）。这也是「重置」与网格 reset 必须互解的那一环：
     * grid.reset() 按同一个预设摆 15×6 / 3×N，两边取自同一张表。
     */
    const area = areaDefaults()
    areaMode.value = area.areaMode
    areaWidth.value = area.areaWidth
    areaHeight.value = area.areaHeight
    areaCols.value = area.areaCols
    areaRows.value = area.areaRows
    suggestEnabled.value = DEFAULTS.suggestEnabled
    inlineCompleteEnabled.value = DEFAULTS.inlineCompleteEnabled
    searchHistoryEnabled.value = DEFAULTS.searchHistoryEnabled
    customEngines.value = []
  }

  // 系统偏好用 matchMedia 监听，用户在系统里改设置时无需刷新
  if (typeof window !== 'undefined' && window.matchMedia) {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    systemReduced.value = motionQuery.matches
    motionQuery.addEventListener('change', (event) => (systemReduced.value = event.matches))

    // prefers-reduced-transparency 较新，不支持的浏览器 matches 恒为 false，即默认开磨砂
    const transparencyQuery = window.matchMedia('(prefers-reduced-transparency: reduce)')
    systemReducedTransparency.value = transparencyQuery.matches
    transparencyQuery.addEventListener(
      'change',
      (event) => (systemReducedTransparency.value = event.matches),
    )
  }

  load()
  /*
   * 读盘之后立刻接回 IndexedDB 里的字节。
   *
   * 不 await：store 的 setup 必须同步返回。hydrate 完成前 bgLocalImages 的每项
   * url 都是 null，bgFrames 会把它们过滤掉——本地图片档在这一小段时间里显示底色，
   * 与「图还没加载完」是同一种观感，不需要额外的加载态。
   */
  void hydrateLocalImages()

  watch(
    [
      bgMode,
      bgColors,
      bgLocalImages,
      bgUrls,
      bgRotate,
      bgInterval,
      bgPick,
      bgBlur,
      motion,
      glass,
      themeColor,
      scrimOpacity,
      drawerSide,
      closeOnScrim,
      /*
       * 手柄纵向位置也在这里。
       *
       * 它原先有自己的一份存档与一次手动 persistRatio（在 pointerup 里调），
       * 并进按档 settings 之后那次手动调用就多余了——但**必须记得加进这个依赖数组**，
       * 否则表现为「拖了手柄、刷新后回到原处」，而且看不出是哪里漏的：
       * 拖拽本身、夹取、UI 全都正常，只有落盘这一步静默失败。
       */
      handleRatio,
      areaMode,
      areaWidth,
      areaHeight,
      areaCols,
      areaRows,
      suggestEnabled,
      inlineCompleteEnabled,
      searchHistoryEnabled,
      /*
       * customEngines 不加 deep。
       *
       * 增删都整体替换数组（[...list, next] / filter），所以浅比较就能看到变化，
       * 而 deep 会让每次 persist 都多遍历一次全表。前提是**永远不要**原地
       * push / splice 它——那样改动不会被持久化，表现为「加了引擎但刷新后没了」。
       */
      customEngines,
    ],
    /*
     * 一次改动落两份盘。
     *
     * 依赖数组里既有按档字段（背景、区域、抽屉……）也有全局字段（后四个搜索项），
     * 两份存档各自只取自己那一半（见 persist / persistGlobal 的 payload），
     * 所以无脑两个都写是安全的，代价是每次改动多一次 JSON.stringify 与一次 setItem。
     *
     * 刻意不拆成两个 watch 各盯自己的依赖：那样「哪个字段属于哪份存档」就有了
     * 第二处真相，加字段时漏改一边只会表现为「这个设置不保存」——比多写一次盘难查得多。
     */
    () => {
      persist()
      persistGlobal()
    },
  )

  // 动效开关落到 <html> 的属性上：CSS 侧一处兜底关掉全部 transition / animation
  watch(
    motionEnabled,
    (enabled) => {
      document.documentElement.dataset.motion = enabled ? 'on' : 'off'
    },
    { immediate: true },
  )

  // 磨砂开关同理：style.css 里 html[data-glass='off'] 把所有 --glass-* 令牌置 none
  watch(
    glassEnabled,
    (enabled) => {
      document.documentElement.dataset.glass = enabled ? 'on' : 'off'
    },
    { immediate: true },
  )

  /*
   * 遮罩不透明度走 CSS 变量而不是每个浮层各算一遍。
   *
   * 写在 <html> 行内，因此优先级高于 style.css 的 :root 默认值，
   * 但仍低于 html[data-glass='off'] 里换的那一档——那档改的是 --scrim-tint 整条，
   * 不读 --scrim-opacity，所以关磨砂时滑块不会把压暗层重新调透。
   */
  watch(
    scrimOpacity,
    (value) => {
      document.documentElement.style.setProperty('--scrim-opacity', String(value / 100))
    },
    { immediate: true },
  )

  /*
   * 主题色同样落成 <html> 上的一个 CSS 变量，与 --scrim-opacity 同构。
   *
   * style.css 只认 --theme-color 这一个入口，其余（--accent、--accent-solid、
   * 面板染色、Tab 滑块）全在那边用 color-mix 派生——把派生放 CSS 里而不是在
   * 这里算好几个值写下来，是因为那些比例是视觉取舍，该和它们的注释待在一起。
   */
  watch(
    themeColor,
    (value) => {
      document.documentElement.style.setProperty('--theme-color', value)
    },
    { immediate: true },
  )

  return {
    bgMode,
    bgColors,
    bgLocalImages,
    bgUrls,
    bgRotate,
    bgInterval,
    bgIndex,
    bgPick,
    bgBlur,
    localStoreUnavailable,
    motion,
    glass,
    themeColor,
    scrimOpacity,
    drawerSide,
    closeOnScrim,
    /** 手柄纵向位置：唯一的真相在这里，useEdgeHandle 只是转发（见那边的文件头注释） */
    handleRatio,
    areaMode,
    areaWidth,
    areaHeight,
    areaCols,
    areaRows,
    areaPixelFixed,
    areaCellFixed,
    suggestEnabled,
    inlineCompleteEnabled,
    searchHistoryEnabled,
    customEngines,
    allEngines,
    resolveEngine,
    motionEnabled,
    glassEnabled,
    bgFrames,
    isImageMode,
    bgBaseColor,
    bgRotating,
    bgIntervalMs,
    bgCurrentKey,
    effectiveBlur,
    frameBackground,
    advanceBg,
    setBgIndex,
    pickBgFrame,
    setBgMode,
    addBgColor,
    removeBgColor,
    toggleBgColor,
    setBgColorOnly,
    updateBgColorAt,
    addBgLocalImages,
    removeBgLocalImage,
    addBgUrl,
    setBgUrlAt,
    removeBgUrl,
    setBgRotate,
    setBgIntervalFor,
    setBgBlur,
    setMotion,
    setGlass,
    setThemeColor,
    setScrimOpacity,
    setDrawerSide,
    setHandleRatio,
    setCloseOnScrim,
    setAreaMode,
    setAreaWidth,
    setAreaHeight,
    setAreaCols,
    setAreaRows,
    setSuggestEnabled,
    setInlineCompleteEnabled,
    setSearchHistoryEnabled,
    addCustomEngine,
    removeCustomEngine,
    resetAreaSize,
    resetAreaCells,
    reset,
    load,
    persist,
    persistGlobal,
  }
})

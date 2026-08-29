import { defineStore } from 'pinia'
import { nanoid } from 'nanoid'
import { computed, ref, watch } from 'vue'

import { DEFAULT_ENGINE_ID, ENGINES, type EngineDef } from '@/data/engines'
import { isHexColor } from '@/utils/color'
import { ENGINE_NAME_MAX, isSafeEngineUrl, type CustomEngine } from '@/types/search'

/** 背景来源：纯色预设 / 网络图片 */
export type BgMode = 'color' | 'image'
/** 动画开关：跟随系统偏好 / 强制开启 / 强制关闭 */
export type MotionMode = 'system' | 'always' | 'off'
/** 磨砂开关：跟随系统的「降低透明度」/ 强制开启 / 强制关闭 */
export type GlassMode = 'system' | 'always' | 'off'
/** 设置抽屉与手柄的停靠侧 */
export type DrawerSide = 'left' | 'right'
/** 方块区域尺寸的给定方式：直接写像素 / 写横竖格子数 */
export type AreaMode = 'pixel' | 'cell'

const STORAGE_KEY = 'starfall-hub:settings'
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

const BG_MODES: readonly BgMode[] = ['color', 'image']
const MOTION_MODES: readonly MotionMode[] = ['system', 'always', 'off']
const GLASS_MODES: readonly GlassMode[] = ['system', 'always', 'off']
const DRAWER_SIDES: readonly DrawerSide[] = ['left', 'right']
const AREA_MODES: readonly AreaMode[] = ['pixel', 'cell']

const DEFAULTS = {
  bgMode: 'color' as BgMode,
  bgColor: BG_PRESETS[1].value as string,
  bgImage: '',
  bgBlur: 0,
  motion: 'system' as MotionMode,
  glass: 'system' as GlassMode,
  /** 42 对应 --scrim-tint 的默认不透明度，滑块归位到此即恢复默认观感 */
  scrimOpacity: 42,
  drawerSide: 'right' as DrawerSide,
  /** 点遮罩关闭：默认开启，与改造前写死的行为一致 */
  closeOnScrim: true,
  areaMode: 'pixel' as AreaMode,
  /*
   * 尺寸默认全为 AREA_AUTO（0）。
   *
   * 这样未动过设置的用户拿到的仍是改造前的行为——区域铺满可用空间、
   * 行列数由实测反解，不需要为「默认值该填多少」硬编码一个屏幕尺寸。
   */
  areaWidth: AREA_AUTO,
  areaHeight: AREA_AUTO,
  areaCols: AREA_AUTO,
  areaRows: AREA_AUTO,
  /*
   * 搜索建议默认关闭。
   *
   * 建议只能走 JSONP（主流端点全都不发 Access-Control-Allow-Origin），
   * 而 JSONP 请求会带上该域的 Cookie，等于告诉搜索引擎用户打了什么字。
   * 这是隐私成本，必须由用户显式接受。关闭时搜索方块仍完全可用。
   *
   * 放在全局而不是每个方块的 props 里：它是一条隐私开关，
   * 「这个方块发、那个方块不发」没有意义，只会让用户以为自己已经关掉了。
   */
  suggestEnabled: false,
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

interface SettingsState {
  version: number
  bgMode: BgMode
  bgColor: string
  bgImage: string
  bgBlur: number
  motion: MotionMode
  glass: GlassMode
  scrimOpacity: number
  drawerSide: DrawerSide
  closeOnScrim: boolean
  areaMode: AreaMode
  areaWidth: number
  areaHeight: number
  areaCols: number
  areaRows: number
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

export const useSettingsStore = defineStore('settings', () => {
  const bgMode = ref<BgMode>(DEFAULTS.bgMode)
  const bgColor = ref<string>(DEFAULTS.bgColor)
  const bgImage = ref<string>(DEFAULTS.bgImage)
  const bgBlur = ref<number>(DEFAULTS.bgBlur)
  const motion = ref<MotionMode>(DEFAULTS.motion)
  const glass = ref<GlassMode>(DEFAULTS.glass)
  const scrimOpacity = ref<number>(DEFAULTS.scrimOpacity)
  const drawerSide = ref<DrawerSide>(DEFAULTS.drawerSide)
  /** 点击遮罩空白处是否关闭浮层（设置抽屉与对话框共用） */
  const closeOnScrim = ref<boolean>(DEFAULTS.closeOnScrim)

  /*
   * 方块区域尺寸。
   *
   * 两档共存而不是二选一存一份：用户在 tab 间来回切换时，
   * 另一档的输入不该被清空。areaMode 只决定「哪一档参与计算」。
   */
  const areaMode = ref<AreaMode>(DEFAULTS.areaMode)
  const areaWidth = ref<number>(DEFAULTS.areaWidth)
  const areaHeight = ref<number>(DEFAULTS.areaHeight)
  const areaCols = ref<number>(DEFAULTS.areaCols)
  const areaRows = ref<number>(DEFAULTS.areaRows)

  /*
   * 搜索。
   *
   * 三条全局开关加一张自定义引擎表——**每个搜索方块用哪个引擎存在它自己的
   * props 里**（见 types/widgetProps.ts 的 SEARCH_FIELDS），所以放两个方块可以
   * 一个百度一个 Google。这里留下的都是「不该逐方块分裂」的东西：
   * 建议与补全是隐私 / 输入法取舍，搜索记录是一份属于用户的记录（三个方块该看到
   * 同一份），自定义引擎表是所有方块共用的词典。
   */
  const suggestEnabled = ref<boolean>(DEFAULTS.suggestEnabled)
  const inlineCompleteEnabled = ref<boolean>(DEFAULTS.inlineCompleteEnabled)
  const searchHistoryEnabled = ref<boolean>(DEFAULTS.searchHistoryEnabled)
  const customEngines = ref<CustomEngine[]>([])

  /** 系统偏好；motion 为 system 时由它决定是否动效 */
  const systemReduced = ref(false)
  /** 系统的「降低透明度」；glass 为 system 时由它决定是否磨砂 */
  const systemReducedTransparency = ref(false)

  /** 读取持久化设置；任一字段不合法就单独回退，不整体丢弃 */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return

      const parsed = JSON.parse(raw) as Partial<SettingsState>
      if (parsed?.version !== SCHEMA_VERSION) return

      bgMode.value = pick(parsed.bgMode, BG_MODES, DEFAULTS.bgMode)
      // 旧存档里的配色预设已不在色板上，迁移到最接近的新档位，否则没有一格显示选中态
      bgColor.value = isHexColor(parsed.bgColor)
        ? migrateBgColor(parsed.bgColor)
        : DEFAULTS.bgColor
      bgImage.value =
        typeof parsed.bgImage === 'string' && isSafeImageUrl(parsed.bgImage)
          ? parsed.bgImage.trim()
          : DEFAULTS.bgImage
      bgBlur.value = clampBlur(parsed.bgBlur)
      motion.value = pick(parsed.motion, MOTION_MODES, DEFAULTS.motion)
      glass.value = pick(parsed.glass, GLASS_MODES, DEFAULTS.glass)
      scrimOpacity.value = clampScrimOpacity(parsed.scrimOpacity)
      drawerSide.value = pick(parsed.drawerSide, DRAWER_SIDES, DEFAULTS.drawerSide)
      // 旧版本存档没有这个字段，undefined 时保持默认的「开启」
      closeOnScrim.value =
        typeof parsed.closeOnScrim === 'boolean' ? parsed.closeOnScrim : DEFAULTS.closeOnScrim
      areaMode.value = pick(parsed.areaMode, AREA_MODES, DEFAULTS.areaMode)
      areaWidth.value = clampArea(parsed.areaWidth, AREA_SIZE_MIN, AREA_SIZE_MAX)
      areaHeight.value = clampArea(parsed.areaHeight, AREA_SIZE_MIN, AREA_SIZE_MAX)
      areaCols.value = clampArea(parsed.areaCols, AREA_CELL_MIN, AREA_CELL_MAX)
      areaRows.value = clampArea(parsed.areaRows, AREA_CELL_MIN, AREA_CELL_MAX)

      /*
       * 搜索的四个字段。
       *
       * 一律走「undefined 时取默认值」而不是提 SCHEMA_VERSION：版本一变，
       * 上面那个 `parsed.version !== SCHEMA_VERSION` 会整份丢弃存档，
       * 用户的背景图、方块区域尺寸、抽屉停靠侧全部清空。
       * 与 closeOnScrim 当初的加法完全一致。
       */
      suggestEnabled.value =
        typeof parsed.suggestEnabled === 'boolean' ? parsed.suggestEnabled : DEFAULTS.suggestEnabled
      inlineCompleteEnabled.value =
        typeof parsed.inlineCompleteEnabled === 'boolean'
          ? parsed.inlineCompleteEnabled
          : DEFAULTS.inlineCompleteEnabled
      searchHistoryEnabled.value =
        typeof parsed.searchHistoryEnabled === 'boolean'
          ? parsed.searchHistoryEnabled
          : DEFAULTS.searchHistoryEnabled
      customEngines.value = Array.isArray(parsed.customEngines)
        ? parsed.customEngines
            .map(sanitizeCustomEngine)
            .filter((engine): engine is CustomEngine => engine !== null)
            .slice(0, CUSTOM_ENGINE_MAX)
        : []
    } catch {
      // 非法 JSON：保持默认设置
    }
  }

  function persist() {
    const payload: SettingsState = {
      version: SCHEMA_VERSION,
      bgMode: bgMode.value,
      bgColor: bgColor.value,
      bgImage: bgImage.value,
      bgBlur: bgBlur.value,
      motion: motion.value,
      glass: glass.value,
      scrimOpacity: scrimOpacity.value,
      drawerSide: drawerSide.value,
      closeOnScrim: closeOnScrim.value,
      areaMode: areaMode.value,
      areaWidth: areaWidth.value,
      areaHeight: areaHeight.value,
      areaCols: areaCols.value,
      areaRows: areaRows.value,
      suggestEnabled: suggestEnabled.value,
      inlineCompleteEnabled: inlineCompleteEnabled.value,
      searchHistoryEnabled: searchHistoryEnabled.value,
      customEngines: customEngines.value,
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
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
   * 背景图最终交给浏览器的绝对地址；非图片模式或地址不合法时为 null。
   *
   * 抽屉的加载探测也读它，保证「探测的那张图」与「CSS 里那张图」是同一个地址——
   * 各自拿原始输入去归一化的话，两边只要有一处实现漂移，探测结果就会骗人。
   */
  const bgImageHref = computed(() =>
    bgMode.value === 'image' ? resolveImageUrl(bgImage.value) : null,
  )

  /** 图片模式且地址合法——决定背景层是否真的在渲染图片 */
  const hasBgImage = computed(() => bgImageHref.value !== null)

  /** 背景样式：纯色直接铺底；图片地址非法时退回纯色，避免整屏空白 */
  const backgroundStyle = computed(() => {
    const href = bgImageHref.value
    if (!href) return { backgroundColor: bgColor.value }
    return {
      backgroundColor: bgColor.value,
      backgroundImage: `url("${cssUrl(href)}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    }
  })

  /** 实际生效的模糊：纯色底上模糊不产生任何视觉差异，只在图片模式下计入 */
  const effectiveBlur = computed(() => (hasBgImage.value ? bgBlur.value : 0))

  function setBgMode(next: BgMode) {
    bgMode.value = pick(next, BG_MODES, DEFAULTS.bgMode)
  }

  function setBgColor(next: string) {
    if (isHexColor(next)) bgColor.value = next
  }

  /** 允许写入空串（表示清空），非空时才校验协议 */
  function setBgImage(next: string) {
    const trimmed = next.trim()
    if (!trimmed || isSafeImageUrl(trimmed)) bgImage.value = trimmed
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

  function setScrimOpacity(next: number) {
    scrimOpacity.value = clampScrimOpacity(next)
  }

  function setDrawerSide(next: DrawerSide) {
    drawerSide.value = pick(next, DRAWER_SIDES, DEFAULTS.drawerSide)
  }

  function setCloseOnScrim(next: boolean) {
    closeOnScrim.value = next
  }

  function setAreaMode(next: AreaMode) {
    areaMode.value = pick(next, AREA_MODES, DEFAULTS.areaMode)
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

  function reset() {
    bgMode.value = DEFAULTS.bgMode
    bgColor.value = DEFAULTS.bgColor
    bgImage.value = DEFAULTS.bgImage
    bgBlur.value = DEFAULTS.bgBlur
    motion.value = DEFAULTS.motion
    glass.value = DEFAULTS.glass
    scrimOpacity.value = DEFAULTS.scrimOpacity
    drawerSide.value = DEFAULTS.drawerSide
    closeOnScrim.value = DEFAULTS.closeOnScrim
    areaMode.value = DEFAULTS.areaMode
    areaWidth.value = DEFAULTS.areaWidth
    areaHeight.value = DEFAULTS.areaHeight
    areaCols.value = DEFAULTS.areaCols
    areaRows.value = DEFAULTS.areaRows
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
  watch(
    [
      bgMode,
      bgColor,
      bgImage,
      bgBlur,
      motion,
      glass,
      scrimOpacity,
      drawerSide,
      closeOnScrim,
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
    persist,
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

  return {
    bgMode,
    bgColor,
    bgImage,
    bgBlur,
    motion,
    glass,
    scrimOpacity,
    drawerSide,
    closeOnScrim,
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
    hasBgImage,
    bgImageHref,
    effectiveBlur,
    backgroundStyle,
    setBgMode,
    setBgColor,
    setBgImage,
    setBgBlur,
    setMotion,
    setGlass,
    setScrimOpacity,
    setDrawerSide,
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
  }
})

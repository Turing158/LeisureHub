<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import OverlayLayer from '../OverlayLayer.vue'
import UndoToast from '../UndoToast.vue'
import TileIcon from '../TileIcon.vue'
import ColorPicker from '../dialog/ColorPicker.vue'
import CloudSyncDialog from '../dialog/CloudSyncDialog.vue'
import ConfirmDialog from '../dialog/ConfirmDialog.vue'
import CustomEngines from './CustomEngines.vue'
import NumberField from './NumberField.vue'
import SegmentedControl from './SegmentedControl.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import { autoFit } from '@/composables/useAreaViewport'
import { resetSearchHistory, useSearchHistory } from '@/composables/useSearchHistory'
import { resetTodos } from '@/composables/useTodos'
import { clearWeatherCache } from '../widgets/weather/cache'
import { getWidget } from '@/data/widgets'
import { useGridStore } from '@/stores/grid'
import { tileSpanForOverflow, type Tile } from '@/types/tile'
import {
  AREA_CELL_MAX,
  AREA_CELL_MIN,
  AREA_SIZE_MAX,
  AREA_SIZE_MIN,
  BG_COLOR_MAX,
  BG_IMAGE_MAX,
  BG_INTERVAL_MAX,
  BG_INTERVAL_MIN,
  BG_PRESETS,
  BLUR_MAX,
  LOCAL_IMAGE_MAX_BYTES,
  SCRIM_OPACITY_MAX,
  SCRIM_OPACITY_MIN,
  THEME_PRESETS,
  pruneImagesAfterProfileRemoval,
  useSettingsStore,
  type AreaMode,
  type BgMode,
  type DrawerSide,
  type GlassMode,
  type MotionMode,
} from '@/stores/settings'
import {
  PRESET_LABEL,
  PRESET_ORDER,
  PROFILE_NAME_MAX,
  type ProfileEntry,
} from '@/types/profile'
import { normalizeHex } from '@/utils/color'
import {
  applyConfigImport,
  configImportConflicts,
  downloadConfigSnapshot,
  parseConfigImport,
  type ParsedConfigImport,
} from '@/utils/exportConfig'
import {
  activeProfileId,
  createProfile,
  duplicateActiveProfile,
  listProfiles,
  removeProfile,
  renameProfile,
  setActiveProfile,
} from '@/utils/profileKey'

const emit = defineEmits<{ close: [] }>()

const props = defineProps<{ open: boolean }>()

const settings = useSettingsStore()
/**
 * 方块布局。
 *
 * 抽屉平时不碰网格，只有「重置为默认」要一并把布局换回去——那是用户按下那个
 * 按钮时期待的完整结果（布局 + 设置 + 数据），少了任何一样都会让人以为没生效。
 */
const grid = useGridStore()
/**
 * 搜索记录。
 *
 * 抽屉里只用到「有几条」与「清空」。它是模块级共享的（见 useSearchHistory），
 * 所以这里清空之后，桌面上每个搜索方块下方那块区域同时变空——不需要任何联动代码。
 */
const history = useSearchHistory()
/** 停靠侧由设置驱动，抽屉出场方向与手柄同侧 */
const side = computed(() => settings.drawerSide)

/* ── 配置档 ─────────────────────────────────── */

/**
 * 档位列表。
 *
 * 存进本地 ref 而不是在模板里直接调 listProfiles()：那个函数每次返回一份新数组
 * （刻意的，见它的注释「调用方不得原地改它」），模板里现调会让每次重渲染都拿到
 * 新引用，v-for 整段重建——正在打字的重命名输入框会失焦。
 *
 * 索引本身不是响应式的（它是 utils 层的模块级单例，见 profileKey 的文件头），
 * 所以每个写操作之后手动 refresh 一次。写入口只有下面这几个函数，不会漏。
 */
const profiles = ref<ProfileEntry[]>([])

/**
 * 当前档 id，整页生命周期内恒定。
 *
 * 不必是响应式的：切档 = 写索引 + 整页 reload（见 pickProfile），
 * 这个值在一次页面生命里根本不会变。
 */
const currentProfileId = activeProfileId()

/** 每行重命名输入框的本地草稿，键是档位 id */
const nameDrafts = ref<Record<string, string>>({})

function refreshProfiles() {
  profiles.value = listProfiles()
  const next: Record<string, string> = {}
  for (const item of profiles.value) next[item.id] = item.name
  nameDrafts.value = next
}
refreshProfiles()

/**
 * 切档 = 写索引 + 整页 reload。
 *
 * 不做热切换，理由见 profileKey 的 setActiveProfile 与 plan/10 §4：三个 store 的
 * load / reset 都不是为「中途换一份存档」写的，热切换要在它们内部各开一条分支。
 * reload 是同一件事的一行版本，代价是一次白屏——而这个操作用户一天点不了两次。
 *
 * setActiveProfile 返回 false 有两种情况（id 不存在、点的就是当前档），
 * 两种都不该 reload：后者尤其要挡住，否则点一下当前档整页重载，看起来像卡了一下。
 */
function pickProfile(id: string) {
  if (setActiveProfile(id)) location.reload()
}

/**
 * 重命名：失焦或回车写入。
 *
 * 写完之后一律 refreshProfiles() 把草稿拉回索引里的值，而不是留着用户输入的原文——
 * renameProfile 会 trim、截到 PROFILE_NAME_MAX、空字符串回落成预设名。
 * 不同步回来的话，输入框里留着 20 个字，存下的是 16 个，下次失焦又写一遍。
 */
function commitProfileName(id: string) {
  renameProfile(id, nameDrafts.value[id] ?? '')
  refreshProfiles()
}

/** 从某个预设新建一档，建完不切过去：切档要 reload，会打断用户接下来的改名 */
function addProfile(preset: (typeof PRESET_ORDER)[number]) {
  createProfile(preset)
  refreshProfiles()
}

/** 复制当前档：两份按档存档整体抄一份，壁纸字节共享（见 duplicateActiveProfile） */
function copyProfile() {
  duplicateActiveProfile()
  refreshProfiles()
}

/**
 * 能不能删。
 *
 * 两条拒绝在 removeProfile 里也各拦一道，这里是 UI 侧的那一半：按钮禁掉 + title
 * 说明原因，不做成「点了没反应」。纪律来自 removeBgColor（settings.ts 那段注释）。
 */
function canRemoveProfile(id: string): boolean {
  return id !== currentProfileId && profiles.value.length > 1
}

function removeProfileTitle(id: string): string {
  if (id === currentProfileId) return '不能删除正在使用的配置，先切到别的配置'
  if (profiles.value.length <= 1) return '至少要保留一个配置'
  return '删除这个配置'
}

/** 待确认删除的档位 id；null 表示没有待确认的删除 */
const confirmRemoveId = ref<string | null>(null)

const cloudSyncOpen = ref(false)
const configFileInput = ref<HTMLInputElement | null>(null)
const configImportBusy = ref(false)
const configImportError = ref('')
const pendingConfigImport = ref<ParsedConfigImport | null>(null)
const importConflictNames = ref<string[]>([])
const recycleNotice = ref('')
const confirmRecycleDeleteId = ref<string | null>(null)

const confirmRemoveName = computed(
  () => profiles.value.find((item) => item.id === confirmRemoveId.value)?.name ?? '',
)

const confirmRecycleDeleteName = computed(() => {
  const tile = grid.overflow.find((item) => item.id === confirmRecycleDeleteId.value)
  return tile ? tileDisplayName(tile) : ''
})

const importConflictMessage = computed(() => {
  const count = importConflictNames.value.length
  const names = importConflictNames.value.slice(0, 3).map((name) => `「${name}」`).join('、')
  const remainder = count > 3 ? ` 等 ${count} 个配置` : ''
  return `检测到 UUID 相同的配置 ${names}${remainder}。要用文件中的方块布局与外观设置覆盖它们吗？导入后页面会重新载入。`
})

/**
 * 删档。
 *
 * 删完必须跑一次 pruneImagesAfterProfileRemoval：那一档的 `:settings@<id>` 已经
 * 没了，它**独占**的本地壁纸字节从此没有任何档引用得到，留在 IndexedDB 里就是
 * 谁也看不见、谁也删不掉的几 MB。被别的档共同引用的那些不会被碰（引用计数，见
 * stores/settings 的 referencedImageIds）——「复制当前配置」产出的正是这种状态。
 *
 * 不 await：它只清字节，界面上没有任何东西等着它。失败也无所谓，下次启动的
 * hydrate 会再清一遍（同一个 pruneOrphanImages）。
 */
function doRemoveProfile() {
  const id = confirmRemoveId.value
  confirmRemoveId.value = null
  if (!id || !removeProfile(id)) return
  refreshProfiles()
  void pruneImagesAfterProfileRemoval()
}

function downloadCurrentConfig() {
  settings.persist()
  settings.persistGlobal()
  grid.persist()
  downloadConfigSnapshot()
}

function openConfigFilePicker() {
  configImportError.value = ''
  pendingConfigImport.value = null
  importConflictNames.value = []
  if (!configFileInput.value) return
  configFileInput.value.value = ''
  configFileInput.value.click()
}

function commitConfigImport(config: ParsedConfigImport) {
  try {
    applyConfigImport(config)
    pendingConfigImport.value = null
    importConflictNames.value = []
    location.reload()
  } catch {
    configImportError.value = '加载配置失败，浏览器无法写入本地存储'
  }
}

async function onConfigFileChange(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  configImportError.value = ''
  pendingConfigImport.value = null
  importConflictNames.value = []
  if (!file.name.toLowerCase().endsWith('.json')) {
    configImportError.value = '只能加载 JSON 文件'
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    configImportError.value = '配置文件不能超过 10 MB'
    return
  }

  configImportBusy.value = true
  try {
    let raw: unknown
    try {
      raw = JSON.parse(await file.text())
    } catch {
      throw new Error('JSON 格式错误，无法解析')
    }
    const config = parseConfigImport(raw)
    const conflicts = configImportConflicts(config)
    if (conflicts.length > 0) {
      pendingConfigImport.value = config
      importConflictNames.value = conflicts.map((profile) => profile.name)
      return
    }
    commitConfigImport(config)
  } catch (error) {
    configImportError.value = error instanceof Error ? error.message : '加载配置失败'
  } finally {
    configImportBusy.value = false
  }
}

function confirmConfigOverwrite() {
  const config = pendingConfigImport.value
  if (config) commitConfigImport(config)
}

function tileDisplayName(tile: Tile): string {
  const name = tile.name.trim()
  if (name) return name
  if (tile.kind === 'widget') return getWidget(tile.widgetId)?.name ?? '未知组件'
  return '未命名链接'
}

function recycleTileMeta(tile: Tile): string {
  const { w, h } = tileSpanForOverflow(tile)
  return `${w} × ${h}`
}

function recycleTileReason(tile: Tile): 'capacity' | 'deleted' {
  return tile.recycleReason === 'deleted' ? 'deleted' : 'capacity'
}

function recycleTileReasonLabel(tile: Tile): string {
  return recycleTileReason(tile) === 'deleted' ? '主动删除' : '格子不够放'
}

function recycleTileTypeLabel(tile: Tile): string {
  return tile.kind === 'widget' ? getWidget(tile.widgetId)?.name ?? '内置组件' : '链接'
}

function restoreRecycleTile(id: string) {
  const tile = grid.overflow.find((item) => item.id === id)
  if (grid.restoreOverflowTile(id, tile?.recycleOrigin)) return
  recycleNotice.value = '当前格子数量或连续空位不足，无法恢复这个方格'
}

function deleteRecycleTile() {
  const id = confirmRecycleDeleteId.value
  confirmRecycleDeleteId.value = null
  if (id) grid.removeOverflowTile(id)
}

const BG_MODE_OPTIONS: { value: BgMode; label: string }[] = [
  { value: 'color', label: '纯色' },
  { value: 'local', label: '本地图片' },
  { value: 'image', label: '网络图片' },
]

const MOTION_OPTIONS: { value: MotionMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'always', label: '始终开启' },
  { value: 'off', label: '关闭' },
]

const GLASS_OPTIONS: { value: GlassMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'always', label: '始终开启' },
  { value: 'off', label: '关闭' },
]

const SIDE_OPTIONS: { value: DrawerSide; label: string }[] = [
  { value: 'left', label: '左边' },
  { value: 'right', label: '右边' },
]

const AREA_MODE_OPTIONS: { value: AreaMode; label: string }[] = [
  { value: 'pixel', label: '按尺寸' },
  { value: 'cell', label: '按格数' },
]

/** 一键填充：两个字段一起写，只填一个轴等于没生效（另一轴仍会铺满） */
function fillAreaFromViewport() {
  settings.setAreaWidth(autoFit.value.width)
  settings.setAreaHeight(autoFit.value.height)
}

function fillCellsFromViewport() {
  settings.setAreaCols(autoFit.value.cols)
  settings.setAreaRows(autoFit.value.rows)
}

/* ── 轮换 ─────────────────────────────────── */

/**
 * 轮换开关与间隔按档读写。
 *
 * 三档各有一套设置（见 store 的 DEFAULTS.bgRotate），所以这里一律带上
 * 当前档；写死某一档会让另外两档的开关互相串台。
 */
const rotateOn = computed(() => settings.bgRotate[settings.bgMode])
const rotateInterval = computed(() => settings.bgInterval[settings.bgMode])

/**
 * 轮换开关只决定颜色列表的选择语义，不限制颜色列表本身的容量。
 *
 * 纯色档和图片档一样，颜色可以先添加多个，再决定是否自动轮换；关闭轮换时仍保留
 * 列表，只显示当前选中的那一项。这样新增第二个自定义色不会意外覆盖第一个。
 */
const colorMulti = computed(() => rotateOn.value)

const rotateHint = computed(() => {
  if (!rotateOn.value) {
    /* 关着的时候说清楚开关控制的是自动轮换，而不是列表容量。 */
    if (settings.bgMode === 'color') return '开启后在已添加的颜色之间定时轮换'
    return '开启后在已添加的图片之间定时轮换'
  }
  // 开着但还凑不满两帧：说清楚现在没在转，以及差什么
  if (settings.bgFrames.length < 2) {
    switch (settings.bgMode) {
      case 'color':
        return '再选一个颜色即可开始轮换'
      case 'local':
        return '再添加一张图片即可开始轮换'
      default:
        return '再填一条可用地址即可开始轮换'
    }
  }
  return `每 ${rotateInterval.value} 秒淡入下一张`
})

/* ── 纯色档 ───────────────────────────────── */

/** 颜色是否在列表中；两边都归一后再比，6 位与 8 位写法才对得上 */
function isColorPicked(color: string) {
  const norm = normalizeHex(color)
  return norm ? settings.bgColors.includes(norm) : false
}

/** 关闭轮换时只标出当前帧，开启轮换时标出列表中的每一帧 */
function isColorActive(color: string) {
  const norm = normalizeHex(color)
  if (!norm) return false
  return colorMulti.value ? isColorPicked(norm) : settings.bgCurrentKey === `c:${norm}`
}

/**
 * 点色板：开了轮换是多选（点中的取消选中），没开则选中或追加一个颜色。
 *
 * 单选态也保留已有颜色列表，避免点第二个颜色时把自定义色一并清掉；当前帧由
 * bgPick 记录，关闭轮换时只显示这一帧。
 */
function onColorClick(color: string) {
  if (colorMulti.value) settings.toggleBgColor(color)
  else settings.addBgColor(color)
}

/** 自定义色（不在预设表里的那些）单独列出来，它们要能被改和删 */
const presetValues = computed(
  () => new Set(BG_PRESETS.map((preset) => normalizeHex(preset.value) ?? preset.value)),
)

const customColors = computed(() =>
  settings.bgColors.filter((color) => !presetValues.value.has(color)),
)

/*
 * 取色面板。
 *
 * 与 ColorSwatches 同一手法：量一次触发元素的位置存成 anchor，
 * 面板自己贴着它展开。editingIndex 为 -1 表示「新增」，否则是在改第 n 个。
 */
const pickerOpen = ref(false)
const pickerAnchor = ref<{ left: number; top: number; bottom: number; width: number } | null>(null)
const pickerDraft = ref('#0e0e11ff')
const editingIndex = ref(-1)

function anchorFrom(event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width }
}

/** 末尾的「+」：开面板挑一个新颜色 */
function openColorAdd(event: MouseEvent) {
  editingIndex.value = -1
  pickerDraft.value = settings.bgColors[settings.bgIndex] ?? '#0e0e11ff'
  pickerAnchor.value = anchorFrom(event)
  pickerOpen.value = true
}

/** 点已有的自定义色：改它 */
function openColorEdit(event: MouseEvent, color: string) {
  // 单选态下点自定义色先把它设为当前帧，再打开面板编辑。
  if (!colorMulti.value) settings.addBgColor(color)
  editingIndex.value = settings.bgColors.indexOf(color)
  pickerDraft.value = color
  pickerAnchor.value = anchorFrom(event)
  pickerOpen.value = true
}

/**
 * 面板每拖一帧都会回调。
 *
 * 新增态下第一帧就先落进列表，之后转为改这一项——否则拖动过程中看不到
 * 任何反馈，要等关掉面板才知道选中的是什么颜色。
 */
function onPickerInput(next: string) {
  pickerDraft.value = next
  if (editingIndex.value < 0) {
    // 新增态始终追加；是否轮换由下方开关决定，不应覆盖已有颜色。
    settings.addBgColor(next)
    editingIndex.value = settings.bgColors.indexOf(normalizeHex(next) ?? next)
    return
  }
  settings.updateBgColorAt(editingIndex.value, next)
}

function closePicker() {
  pickerOpen.value = false
  pickerAnchor.value = null
  editingIndex.value = -1
}

/* ── 主题色 ───────────────────────────────── */

/*
 * 主题色的取色面板独立一套状态，不与背景色那套复用。
 *
 * 背景色那套带着 editingIndex（在改第几个颜色）与「新增/编辑」两种语义——
 * 因为纯色档存的是一组颜色。主题色只有一个值，塞进同一套状态就要在每个
 * 分支里判断「这次是背景还是主题」，两种语义纠缠在一起。各自一份反而更短。
 */
const themePickerOpen = ref(false)
const themePickerAnchor = ref<{ left: number; top: number; bottom: number; width: number } | null>(
  null,
)

/** 预设值归一到 8 位，与 store 里存的形态对齐后才能比较选中态 */
const themePresetValues = computed(
  () => new Set(THEME_PRESETS.map((preset) => normalizeHex(preset.value) ?? preset.value)),
)

/** 当前主题色是否为某个预设；否则说明用户用取色器自选过 */
const themeIsCustom = computed(() => !themePresetValues.value.has(settings.themeColor))

function isThemePicked(value: string) {
  return settings.themeColor === (normalizeHex(value) ?? value)
}

function openThemePicker(event: MouseEvent) {
  themePickerAnchor.value = anchorFrom(event)
  themePickerOpen.value = true
}

function closeThemePicker() {
  themePickerOpen.value = false
  themePickerAnchor.value = null
}

/* ── 本地图片档 ───────────────────────────── */

const localFileInput = ref<HTMLInputElement | null>(null)
const localImageError = ref('')

function pickLocalFiles() {
  localFileInput.value?.click()
}

/**
 * 处理选中的本地文件（可多选）。
 *
 * 校验与写库都在 store 里（它要按 BG_IMAGE_MAX 逐个数、逐个写 IndexedDB），
 * 这里只负责把被拒的文件汇总成一句话。
 */
async function onLocalFilesPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  // 清掉 value，允许用户连续两次选同一批文件（否则 change 不会触发第二次）
  input.value = ''

  if (files.length === 0) return

  /*
   * 整批交给 store，不在这里截断。
   *
   * 曾经在关着轮换时只取第一张，现在图片档不受轮换开关限制了：多加几张只是
   * 攒了个图库，用哪一张由勾决定。数量仍有硬上限（BG_IMAGE_MAX），由 store 逐个数，
   * 超出的那些带原因回来，汇总成一句话显示。
   */
  const rejected = await settings.addBgLocalImages(files)
  localImageError.value =
    rejected.length === 0
      ? ''
      : rejected.map((item) => `${item.name}：${item.reason}`).join('；')
}

/**
 * 这一项是否正被用作背景。
 *
 * 比的是 store 算出的当前帧 key，而不是「列表里的第几个」：bgFrames 会过滤掉
 * 字节丢失的本地图和空地址行，两边的下标对不上。key 由各档前缀加 id 组成，
 * 与 store 里造帧时用的一致。
 */
function isPicked(key: string) {
  return settings.bgCurrentKey === key
}

/* ── 网络图片档 ───────────────────────────── */

/**
 * 每行地址的本地草稿。
 *
 * 按 id 存而不是按下标：删掉中间一行后下标会整体前移，草稿就会串到隔壁行去。
 * 输入期间不写 store，避免每敲一个字符都触发一次背景请求。
 */
const urlDrafts = ref<Record<string, string>>({})
/** 格式不合法的行；store 拒绝写入时在这里记一笔，让输入框旁边能说出原因 */
const urlErrors = ref<Record<string, string>>({})

/** 每行的加载状态：地址合法 ≠ 图能显示出来，见 probeUrl */
type ProbeState = 'idle' | 'loading' | 'ok' | 'error'
const urlStates = ref<Record<string, ProbeState>>({})

/*
 * 每行各领一个号，回调里比对。
 * 同一行连着改两次地址时先发的请求可能后回来，不比对就会用旧结果覆盖掉新状态。
 */
const probeTokens = new Map<string, number>()

/**
 * 探测一条地址能否加载。
 *
 * 地址合法 ≠ 图能显示出来：防盗链、403、404、图源挂了、HTTPS 页面上引 http 图
 * 被浏览器直接拦掉——这些全都表现为「填完之后背景一点变化都没有」，
 * 而协议校验对它们一无所知。所以这里真的去加载一次，把结果说出来。
 */
function probeUrl(id: string, href: string) {
  const token = (probeTokens.get(id) ?? 0) + 1
  probeTokens.set(id, token)

  if (!href) {
    urlStates.value = { ...urlStates.value, [id]: 'idle' }
    return
  }

  urlStates.value = { ...urlStates.value, [id]: 'loading' }
  // 用 Image 而不是 fetch：它与 CSS 背景走同一条 no-cors 图片路径，也命中同一份缓存
  const img = new Image()
  img.onload = () => {
    if (probeTokens.get(id) === token) urlStates.value = { ...urlStates.value, [id]: 'ok' }
  }
  img.onerror = () => {
    if (probeTokens.get(id) === token) urlStates.value = { ...urlStates.value, [id]: 'error' }
  }
  img.src = href
}

/** 把 store 的地址同步进草稿，并对每条非空地址复验一次 */
function syncUrlDrafts() {
  const drafts: Record<string, string> = {}
  for (const item of settings.bgUrls) {
    drafts[item.id] = item.url
    // 上次看到的结果可能已过期：图源挂了 / 又活了
    probeUrl(item.id, item.url)
  }
  urlDrafts.value = drafts
  urlErrors.value = {}
}

function applyUrl(id: string) {
  const draft = urlDrafts.value[id] ?? ''
  const ok = settings.setBgUrlAt(id, draft)
  urlErrors.value = { ...urlErrors.value, [id]: ok ? '' : '请填写 http/https 开头的图片地址' }
  if (ok) probeUrl(id, draft.trim())
}

function addUrlRow() {
  const id = settings.addBgUrl()
  if (!id) return
  urlDrafts.value = { ...urlDrafts.value, [id]: '' }
  /*
   * 新行渲染出来后把焦点送进去。
   *
   * 点了「添加一条」却还要再点一次输入框才能打字，是多余的一步；
   * 键盘用户尤其需要——否则焦点仍留在那个按钮上。
   */
  void nextTick(() => {
    document.getElementById(`bg-url-${id}`)?.focus()
  })
}

function removeUrlRow(id: string) {
  settings.removeBgUrl(id)
  const { [id]: _draft, ...restDrafts } = urlDrafts.value
  urlDrafts.value = restDrafts
  const { [id]: _err, ...restErrors } = urlErrors.value
  urlErrors.value = restErrors
  const { [id]: _state, ...restStates } = urlStates.value
  urlStates.value = restStates
  probeTokens.delete(id)
}

/** HTTPS 页面里的 http 图会被浏览器静默拦掉，这种失败要单独说清楚 */
function isMixedContent(url: string) {
  return window.location.protocol === 'https:' && /^http:\/\//i.test(url)
}

function urlStatusText(id: string) {
  const state = urlStates.value[id] ?? 'idle'
  switch (state) {
    case 'loading':
      return '正在加载图片…'
    case 'ok':
      return '图片已加载'
    case 'error':
      return isMixedContent(urlDrafts.value[id] ?? '')
        ? '当前页面是 HTTPS，浏览器会拦掉 http:// 图片，请换用 https 地址'
        : '图片加载失败：地址已失效、需要登录，或图源禁止外链'
    default:
      return ''
  }
}

/**
 * 网络档下的整体提示：把每行的状态汇总成一句。
 *
 * 逐行都挂一条状态文字会让列表在 5 行时长出 5 行说明，把下面的设置项挤出视野；
 * 具体哪一行出了问题由该行输入框自己的描边颜色指示。
 */
const urlSummary = computed(() => {
  const rows = settings.bgUrls
  if (rows.length === 0) return '仅支持网络图片，回车或失焦后应用'

  const failed = rows.filter((row) => urlStates.value[row.id] === 'error')
  if (failed.length === 1) return urlStatusText(failed[0].id)
  if (failed.length > 1) return `${failed.length} 条地址加载失败，已在轮换中跳过`

  const loading = rows.some((row) => urlStates.value[row.id] === 'loading')
  if (loading) return '正在加载图片…'

  const ok = rows.filter((row) => urlStates.value[row.id] === 'ok').length
  return ok > 0 ? `${ok} 条地址可用` : '仅支持网络图片，回车或失焦后应用'
})

// 抽屉重新打开时同步一次，覆盖上次未提交的草稿
watch(
  () => props.open,
  (open) => {
    if (!open) return
    localImageError.value = ''
    syncUrlDrafts()
  },
)

/*
 * 行数变化时补齐草稿。
 *
 * 「设置被重置」会整表换掉 bgUrls，只在 open 时同步会让重置后的列表
 * 仍显示旧草稿。挂在长度上而不是整个数组上：逐字符提交是本地草稿的事，
 * 不该反过来触发同步。
 */
watch(
  () => settings.bgUrls.length,
  () => {
    for (const item of settings.bgUrls) {
      if (!(item.id in urlDrafts.value)) {
        urlDrafts.value = { ...urlDrafts.value, [item.id]: item.url }
      }
    }
  },
)

/*
 * 滑块拖动期间只改 CSS 变量，不写 store。
 *
 * scrimOpacity 在 store 的 persist watch 依赖里，逐帧提交会让拖动过程中
 * 每帧同步写一次 localStorage，直接阻塞主线程——正是这次要修的那类问题。
 * 松手（change）时才落库。
 */
function onScrimOpacityInput(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  document.documentElement.style.setProperty('--scrim-opacity', String(value / 100))
}

function onScrimOpacityCommit(event: Event) {
  settings.setScrimOpacity(Number((event.target as HTMLInputElement).value))
}

/** 点遮罩关闭：由设置开关控制，关掉后只能靠关闭按钮或 Esc 退出 */
function onScrimPointerDown() {
  if (settings.closeOnScrim) emit('close')
}

/* ── 重置为默认 ─────────────────────────────── */

/**
 * 二次确认对话框是否打开。
 *
 * 重置抹掉的是整份布局、设置与待办，而其中本地壁纸的字节已从 IndexedDB 删掉、
 * 撤不回来，所以走「先问再做」而不是项目里更常见的「先做 + 可撤销」（UndoToast）。
 * 判据见 ConfirmDialog 的文件头。
 */
const confirmResetOpen = ref(false)

/**
 * 重置。
 *
 * 五处存档一次写全，顺序无关（彼此不读对方的状态），但**一处都不能少**——
 * 用户按下这个按钮期待的是「回到刚装好的样子」，剩下任何一项都会表现为
 * 「重置了但那个还在」：
 *
 *   leisure-hub:grid@<当前档>      布局      → grid.reset()
 *   leisure-hub:settings@<当前档>  外观设置  → settings.reset()
 *   leisure-hub:global            隐私开关与自定义引擎 → settings.reset()（同一个函数）
 *   leisure-hub:todos             待办      → resetTodos()
 *   leisure-hub:search-history    搜索记录  → resetSearchHistory()
 *   leisure-hub:weather:*         天气缓存  → clearWeatherCache()
 *
 * 手柄高度不再单列一条：它已并入按档的 `:settings@<id>`，由 settings.reset()
 * 一并回正中（原先那份 `:settings-handle` 与 resetEdgeHandle 都已删除）。
 *
 * **作用域跨档，这是多配置档之后最容易漏的一点。** 动的是**当前这个配置**的布局与
 * 外观，加上**所有配置共用**的待办、搜索记录、隐私开关与引擎表——后四样是全局存档
 * （理由见 stores/settings 的 `:global` 那段与 useTodos 的文件头），从手机档按下
 * 重置，电脑档的待办也一起回到初始状态。别的档的布局与外观、以及索引本身
 * （档位列表与 active）一律不动。上面那段 hint 与 ConfirmDialog 的正文都写明了这条，
 * 不写就是一次静默的跨档数据删除。
 *
 * 布局排在设置之前是刻意的：settings.reset() 会把区域尺寸写回**本档预设**的四项，
 * TileGrid 那个 watch 随即按新尺寸 resize 网格。让 grid.reset() 先落位，
 * resize 拿到的就是默认布局本身（每档各自互解：电脑档 15×6 ↔ 1440×720，
 * 手机档 3×N ↔ cell 3×N，见 types/profile 的 PROFILE_PRESETS），是一次空操作；
 * 反过来则是先按旧尺寸摆好默认布局、再被 resize 挪一遍。
 *
 * 抽屉不关：重置后主题色、背景、遮罩深浅全变了，抽屉本身就是这些变化最直接的
 * 取景框，关掉反而让人不确定到底生效了没有。
 */
function doReset() {
  confirmResetOpen.value = false
  grid.reset()
  settings.reset()
  resetTodos()
  resetSearchHistory()
  clearWeatherCache()
  /*
   * 地址行的本地草稿要跟着换。
   *
   * 那个按长度变化补齐草稿的 watch 只**新增**没见过的 id，不会删掉已经不存在的，
   * 也不会在长度恰好没变时触发——重置前后都只有一行时，输入框里还留着用户
   * 上次填的地址。syncUrlDrafts 整表重建，顺带对新地址重验一次可用性。
   */
  syncUrlDrafts()
}

const panelEl = ref<HTMLElement | null>(null)
/** 打开前的焦点，关闭后归还，键盘用户不会被丢回文档开头 */
let restoreTarget: HTMLElement | null = null

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** 焦点陷阱：Tab 在抽屉内循环，Esc 关闭 */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key !== 'Tab' || !panelEl.value) return

  const focusables = panelEl.value.querySelectorAll<HTMLElement>(FOCUSABLE)
  if (focusables.length === 0) return

  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const current = document.activeElement as HTMLElement | null

  if (!event.shiftKey && current === last) {
    event.preventDefault()
    first.focus()
  } else if (event.shiftKey && current === first) {
    event.preventDefault()
    last.focus()
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      restoreTarget = document.activeElement as HTMLElement | null
      window.addEventListener('keydown', onKeydown)
      await nextTick()
      panelEl.value?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
      return
    }

    window.removeEventListener('keydown', onKeydown)
    restoreTarget?.focus()
    restoreTarget = null
  },
  { immediate: true },
)

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <!--
    Teleport 与进出场过渡由 OverlayLayer 负责，它会在动效关闭时摘掉过渡。

    duration 必须显式给出：下面的 transition 全部挂在 .scrim 的后代上（理由见样式区），
    而 Vue 只在插槽根元素——也就是 .scrim 本身——上探测过渡时长，
    不告诉它就会判定「没有过渡」，退场时同步卸载，关闭动画一帧都看不到。
  -->
  <OverlayLayer name="drawer" duration="base">
    <!--
      遮罩拆成三层。

      磨砂与压暗必须分开：backdrop-filter 每帧都要把身后已合成的画面读回再卷积，
      让它跟着淡入就等于整个过渡期间每帧重做一次全屏模糊。
      现在 .scrim 自己不带任何视觉属性也不参与过渡，
      模糊挂在恒定不变的 __glass 上，只有纯色的 __tint 在动 opacity。
    -->
    <div v-if="open" class="scrim" @pointerdown.self="onScrimPointerDown">
      <div class="scrim__glass" aria-hidden="true" />
      <div class="scrim__tint" aria-hidden="true" />

      <aside
        ref="panelEl"
        class="drawer"
        :class="`drawer--${side}`"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header class="drawer__head">
          <span class="drawer__badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
              <circle cx="12" cy="12" r="3" />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1"
              />
            </svg>
          </span>

          <h2 id="settings-title" class="drawer__title">设置</h2>

          <button class="close" type="button" aria-label="关闭设置" @click="emit('close')">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                stroke="currentColor"
                stroke-linecap="round"
                stroke-width="1.8"
                d="M6 6l12 12M18 6L6 18"
              />
            </svg>
          </button>
        </header>

        <div class="drawer__body">
          <!-- ── 背景 ─────────────────────────────── -->
          <section class="group">
            <h3 class="group__title">背景</h3>

            <SegmentedControl
              :model-value="settings.bgMode"
              :options="BG_MODE_OPTIONS"
              label="背景来源"
              @update:model-value="settings.setBgMode"
            />

            <!--
              纯色：预设色板 + 自定义色，可多选。
              选中的每一个都是轮换里的一帧，末尾的「+」开取色面板加自定义色。
            -->
            <template v-if="settings.bgMode === 'color'">
              <div class="swatches" role="group" aria-label="背景颜色">
                <button
                  v-for="preset in BG_PRESETS"
                  :key="preset.value"
                  class="swatch"
                  :class="{ 'is-active': isColorActive(preset.value) }"
                  type="button"
                  :aria-pressed="isColorActive(preset.value)"
                  :title="preset.label"
                  :style="{ backgroundColor: preset.value }"
                  @click="onColorClick(preset.value)"
                >
                  <span class="sr-only">{{ preset.label }}</span>
                  <!-- 选中态除外圈描边外再给一个勾：一排深灰色块之间，仅靠描边不够快辨认 -->
                  <svg
                    v-if="isColorPicked(preset.value)"
                    class="swatch__tick"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      stroke="currentColor"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2.4"
                      d="m5 13 4 4L19 7"
                    />
                  </svg>
                </button>

                <!-- 自定义色：点开面板改，右上角的 x 移除 -->
                <span v-for="color in customColors" :key="color" class="swatch-slot">
                  <button
                    class="swatch swatch--custom"
                    :class="{ 'is-active': isColorActive(color) }"
                    type="button"
                    :aria-pressed="isColorActive(color)"
                    :title="`自定义颜色 ${color}`"
                    :style="{ backgroundColor: color }"
                    @click="openColorEdit($event, color)"
                  >
                    <span class="sr-only">编辑自定义颜色 {{ color }}</span>
                    <svg
                      v-if="isColorActive(color)"
                      class="swatch__tick"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2.4"
                        d="m5 13 4 4L19 7"
                      />
                    </svg>
                  </button>
                  <button
                    class="swatch-slot__del"
                    type="button"
                    :disabled="settings.bgColors.length <= 1"
                    :aria-label="`移除颜色 ${color}`"
                    data-color-picker-action
                    @click.stop="settings.removeBgColor(color)"
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-width="2.4"
                        d="M6 6l12 12M18 6L6 18"
                      />
                    </svg>
                  </button>
                </span>

                <!--
                  末尾的添加位：容量满了就禁掉，而不是点了没反应。

                  未开轮换时这里照样可点——它在单选态下是「换成这个自定义色」而不是
                  追加，所以不该按 colorMax（此时为 1）禁掉。真按了会成死路：
                  组里剩最后一个颜色时删除入口也是禁着的（纯色档必须有底色），
                  两头都堵住就再也打不开取色面板了。
                -->
                <button
                  class="swatch swatch--add"
                  type="button"
                  :disabled="settings.bgColors.length >= BG_COLOR_MAX"
                  :title="
                    settings.bgColors.length >= BG_COLOR_MAX
                      ? `最多 ${BG_COLOR_MAX} 个颜色`
                      : '添加自定义颜色'
                  "
                  aria-label="添加自定义颜色"
                  @click="openColorAdd"
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      stroke="currentColor"
                      stroke-linecap="round"
                      stroke-width="2"
                      d="M12 6v12M6 12h12"
                    />
                  </svg>
                </button>
              </div>

              <p class="group__hint">
                {{
                  colorMulti
                    ? '点色块选中或取消，选中的每个颜色都是轮换里的一帧'
                    : '可添加多个颜色；关闭轮换时只显示当前选中的颜色'
                }}
              </p>
            </template>

            <!-- 本地图片：多张缩略图 + 末尾添加位，字节存在 IndexedDB -->
            <template v-else-if="settings.bgMode === 'local'">
              <div class="field">
                <span class="field__label">
                  添加图片
                  <span class="field__value">{{ settings.bgLocalImages.length }}/{{ BG_IMAGE_MAX }}</span>
                </span>

                <!-- 真实文件输入隐藏，视觉入口是下面网格里那个添加位；随时可多选 -->
                <input
                  ref="localFileInput"
                  class="sr-only"
                  type="file"
                  accept="image/*"
                  multiple
                  @change="onLocalFilesPicked"
                />

                <div class="thumbs">
                  <!--
                    每张图是一个圆角方块。删除按钮常驻在 DOM 里但默认不可见
                    （见 .thumb__del 的 opacity），悬停或键盘聚焦时才浮出来——
                    用 v-if 挂载会让它无法被 Tab 到，键盘用户就没有删除入口了。
                  -->
                  <div v-for="image in settings.bgLocalImages" :key="image.id" class="thumb">
                    <img v-if="image.url" class="thumb__img" :src="image.url" :alt="image.name" />
                    <!-- 字节丢了（隐私模式 / 库被清）时不留空白，说明它为什么不显示 -->
                    <span v-else class="thumb__gone" :title="`${image.name}：图片数据已丢失`">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                        <rect x="3" y="3" width="18" height="18" rx="3" />
                        <path stroke-linecap="round" d="M8 8l8 8M16 8l-8 8" />
                      </svg>
                    </span>

                    <!--
                      整块缩略图当选中按钮用，只在关着轮换时挂上（开着时每张都会轮到，
                      「选中一张」没有意义）。

                      是铺满整块的独立 button，而不是把 .thumb 本身做成 button：
                      删除按钮在它里面，button 套 button 是非法结构，浏览器会把内层
                      拆出去，删除就点不到了。它铺在图上、排在删除按钮之前，
                      靠层序让右下角那一小块仍归删除按钮（见 .thumb__pick 的 z-index）。

                      字节丢了的那张不给点：它进不了 bgFrames，选了也没有对应的帧。
                    -->
                    <button
                      v-if="!rotateOn"
                      class="thumb__pick"
                      type="button"
                      :disabled="!image.url"
                      :aria-pressed="isPicked(`l:${image.id}`)"
                      :title="isPicked(`l:${image.id}`) ? '正在使用这张' : '设为背景'"
                      @click="settings.pickBgFrame(`l:${image.id}`)"
                    >
                      <span class="sr-only">{{ image.name || '这张图片' }}</span>
                    </button>

                    <!--
                      选中标记贴右上角，与右下角的删除按钮错开，两者不会叠在一起。
                      半透明深底：缩略图内容不可预测，白勾直接压在浅色照片上会看不见。
                      轮换开着时不显示——那时候每张都会轮到，标一张出来是误导。

                      始终挂在 DOM 里，显隐交给 class（同 .thumb__del 的做法）。
                      用 v-if 的话「消失」那一侧没有动画可言：元素已经被拆掉，
                      浏览器没有可过渡的对象，只会瞬间不见。
                    -->
                    <span
                      class="thumb__tick"
                      :class="{ 'thumb__tick--on': !rotateOn && isPicked(`l:${image.id}`) }"
                    >
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          stroke="currentColor"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2.6"
                          d="m5 13 4 4L19 7"
                        />
                      </svg>
                    </span>

                    <button
                      class="thumb__del"
                      type="button"
                      :aria-label="`移除图片 ${image.name || ''}`"
                      @click="settings.removeBgLocalImage(image.id)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          stroke="currentColor"
                          stroke-linecap="round"
                          stroke-width="2.2"
                          d="M6 6l12 12M18 6L6 18"
                        />
                      </svg>
                    </button>
                  </div>

                  <!-- 末尾的添加位：与缩略图同尺寸，虚线描边区分「还没有内容」 -->
                  <button
                    class="thumb thumb--add"
                    type="button"
                    :disabled="settings.bgLocalImages.length >= BG_IMAGE_MAX"
                    :title="
                      settings.bgLocalImages.length < BG_IMAGE_MAX
                        ? `可多选 · 单张 ${LOCAL_IMAGE_MAX_BYTES / 1024 / 1024}MB 以内`
                        : `最多 ${BG_IMAGE_MAX} 张`
                    "
                    aria-label="添加本地图片"
                    @click="pickLocalFiles"
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-width="2"
                        d="M12 6v12M6 12h12"
                      />
                    </svg>
                  </button>
                </div>

                <span v-if="localImageError" class="field__error">{{ localImageError }}</span>
                <span v-else class="field__hint">
                  {{ rotateOn ? '可一次选多张' : '可一次选多张，点缩略图选用哪一张' }} · 单张
                  {{ LOCAL_IMAGE_MAX_BYTES / 1024 / 1024 }}MB 以内
                </span>
              </div>

              <!--
                IndexedDB 写不进去时必须说出来：图在本次会话里能正常显示，
                刷新后却会消失，不提示的话看起来就是「设置没保存」这种 bug。
              -->
              <p v-if="settings.localStoreUnavailable" class="group__hint is-warn">
                浏览器存储不可用，本地图片仅本次会话有效，刷新后会丢失
              </p>
            </template>

            <!-- 网络图片：一列地址，每行可删，末尾按钮追加一行 -->
            <template v-else>
              <div class="field">
                <span class="field__label">
                  图片地址
                  <span v-if="settings.bgUrls.length" class="field__value">
                    {{ settings.bgUrls.length }}/{{ BG_IMAGE_MAX }}
                  </span>
                </span>

                <!--
                  列表最多显示 5 行，再多就在自己内部滚动。

                  这是纯显示上限，不是数量上限（能加到 BG_IMAGE_MAX 条）：
                  抽屉本身已经是个纵向滚动容器，列表无限长会把下面的模糊、动画、
                  磨砂等设置项推到视野之外，找不到了。
                -->
                <div
                  class="url-list"
                  :class="{ 'is-scroll': settings.bgUrls.length > 5, 'has-pick': !rotateOn }"
                >
                  <div v-for="(item, index) in settings.bgUrls" :key="item.id" class="url-row">
                    <input
                      :id="`bg-url-${item.id}`"
                      v-model="urlDrafts[item.id]"
                      class="field__input url-row__input"
                      :class="{
                        'is-error': urlErrors[item.id] || urlStates[item.id] === 'error',
                        'is-ok': urlStates[item.id] === 'ok',
                      }"
                      type="url"
                      inputmode="url"
                      :aria-label="`第 ${index + 1} 条图片地址`"
                      placeholder="https://example.com/wallpaper.jpg"
                      @change="applyUrl(item.id)"
                      @keydown.enter.prevent="applyUrl(item.id)"
                    />
                    <!--
                      选中按钮：与删除同款，只换图标，排在它左边。
                      只在关着轮换时出现——开着的时候每条地址都会轮到，
                      「选中其中一条」没有意义。

                      已选中的那条禁用：它已经是背景了，再点一次什么也不会变，
                      留着可点会让人以为没生效。禁用态同时也是「这条正在用」的标记。
                    -->
                    <button
                      v-if="!rotateOn"
                      class="url-row__pick"
                      type="button"
                      :disabled="isPicked(`u:${item.id}`)"
                      :aria-pressed="isPicked(`u:${item.id}`)"
                      :title="isPicked(`u:${item.id}`) ? '正在使用这条' : '设为背景'"
                      :aria-label="
                        isPicked(`u:${item.id}`)
                          ? `第 ${index + 1} 条地址正在用作背景`
                          : `将第 ${index + 1} 条地址设为背景`
                      "
                      @click="settings.pickBgFrame(`u:${item.id}`)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          stroke="currentColor"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2.4"
                          d="m5 13 4 4L19 7"
                        />
                      </svg>
                    </button>
                    <button
                      class="url-row__del"
                      type="button"
                      :aria-label="`删除第 ${index + 1} 条地址`"
                      @click="removeUrlRow(item.id)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          stroke="currentColor"
                          stroke-linecap="round"
                          stroke-width="2"
                          d="M6 6l12 12M18 6L6 18"
                        />
                      </svg>
                    </button>
                  </div>

                  <!-- 列表末项是占位按钮，点一下追加一行输入框 -->
                  <button
                    class="url-add"
                    type="button"
                    :disabled="settings.bgUrls.length >= BG_IMAGE_MAX"
                    @click="addUrlRow"
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-width="2"
                        d="M12 6v12M6 12h12"
                      />
                    </svg>
                    {{
                      settings.bgUrls.length < BG_IMAGE_MAX ? '添加一条地址' : `最多 ${BG_IMAGE_MAX} 条`
                    }}
                  </button>
                </div>

                <span class="field__hint">{{ urlSummary }}</span>
              </div>
            </template>

            <!--
              轮换开关与间隔：三档共用这段模板，但读写的是当前档自己的那一套
              （见 rotateOn / rotateInterval）。放在各档的列表之后，
              因为它决定列表里那些项是「依次淡入」还是「只用选中的那一个」。
            -->
            <ToggleSwitch
              id="bg-rotate"
              label="轮换背景"
              :model-value="rotateOn"
              :hint="rotateHint"
              @update:model-value="settings.setBgRotate(settings.bgMode, $event)"
            />

            <!--
              间隔只在开着轮换时露出：关着的时候它不影响任何东西，
              留在那里只会让人以为改了有用。
            -->
            <div v-if="rotateOn" class="pair">
              <NumberField
                id="bg-interval"
                label="轮换间隔"
                :model-value="rotateInterval"
                :min="BG_INTERVAL_MIN"
                :max="BG_INTERVAL_MAX"
                :step="5"
                unit="秒"
                :auto-placeholder="String(rotateInterval)"
                @update:model-value="settings.setBgIntervalFor(settings.bgMode, $event)"
              />
            </div>

            <!--
              模糊对两种图片都有意义（纯色底上看不出任何差别，因此不在纯色档露出），
              本地与网络图片共用这一档。
            -->
            <div
              v-if="settings.bgMode === 'local' || settings.bgMode === 'image'"
              class="field"
            >
              <label class="field__label" for="bg-blur">
                模糊
                <span class="field__value">{{ settings.bgBlur }}px</span>
              </label>
              <input
                id="bg-blur"
                class="slider"
                type="range"
                min="0"
                :max="BLUR_MAX"
                step="1"
                :value="settings.bgBlur"
                @input="settings.setBgBlur(Number(($event.target as HTMLInputElement).value))"
              />
            </div>
          </section>

          <!-- ── 动画 ─────────────────────────────── -->
          <section class="group">
            <h3 class="group__title">动画</h3>
            <SegmentedControl
              :model-value="settings.motion"
              :options="MOTION_OPTIONS"
              label="动画开关"
              @update:model-value="settings.setMotion"
            />
            <p class="group__hint">「跟随系统」读取系统的减弱动态效果偏好</p>
          </section>

          <!-- ── 磨砂效果 ─────────────────────────── -->
          <section class="group">
            <h3 class="group__title">磨砂效果</h3>
            <SegmentedControl
              :model-value="settings.glass"
              :options="GLASS_OPTIONS"
              label="磨砂效果"
              @update:model-value="settings.setGlass"
            />
            <p class="group__hint">「跟随系统」读取系统的降低透明度偏好；关闭可明显缓解掉帧</p>

            <!-- 关掉磨砂后压暗层由样式接管到固定值，滑块失去意义，因此只在开启时露出 -->
            <div v-if="settings.glassEnabled" class="field">
              <label class="field__label" for="scrim-opacity">
                遮罩不透明度
                <span class="field__value">{{ settings.scrimOpacity }}%</span>
              </label>
              <input
                id="scrim-opacity"
                class="slider"
                type="range"
                :min="SCRIM_OPACITY_MIN"
                :max="SCRIM_OPACITY_MAX"
                step="1"
                :value="settings.scrimOpacity"
                @input="onScrimOpacityInput"
                @change="onScrimOpacityCommit"
              />
            </div>
          </section>

          <!-- ── 主题色 ───────────────────────────── -->
          <section class="group">
            <h3 class="group__title">主题色</h3>

            <!--
              与背景色板同构（同一套 .swatch 样式与勾选反馈），但语义是**单选**：
              主题色只有一个值，点一下就是换成它，没有多选与移除。
              末尾一格开取色面板自选。
            -->
            <div class="swatches" role="group" aria-label="主题色">
              <button
                v-for="preset in THEME_PRESETS"
                :key="preset.value"
                class="swatch swatch--theme"
                :class="{ 'is-active': isThemePicked(preset.value) }"
                type="button"
                :aria-pressed="isThemePicked(preset.value)"
                :title="preset.label"
                :style="{ backgroundColor: preset.value }"
                @click="settings.setThemeColor(preset.value)"
              >
                <span class="sr-only">{{ preset.label }}</span>
                <svg
                  v-if="isThemePicked(preset.value)"
                  class="swatch__tick"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2.4"
                    d="m5 13 4 4L19 7"
                  />
                </svg>
              </button>

              <!--
                自定义格：始终在位（不像背景色那样「有才显示」），因为主题色单值，
                这一格既是入口也是当前自定义值的显示位。用了自选色时标出选中态。
              -->
              <button
                class="swatch swatch--theme"
                :class="themeIsCustom ? 'is-active' : 'swatch--add'"
                type="button"
                :aria-pressed="themeIsCustom"
                :title="themeIsCustom ? `自定义 ${settings.themeColor}` : '自定义主题色'"
                :style="themeIsCustom ? { backgroundColor: settings.themeColor } : undefined"
                @click="openThemePicker"
              >
                <span class="sr-only">自定义主题色</span>
                <!--
                  没用自选色时这一格没有颜色可显示，就借 .swatch--add 的虚线框 + 居中
                  图标当入口（与背景色那组的「添加」格同一语言）；用了则变成实心色块。
                -->
                <svg v-if="!themeIsCustom" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 5v14M5 12h14"
                  />
                </svg>
                <svg v-else class="swatch__tick" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2.4"
                    d="m5 13 4 4L19 7"
                  />
                </svg>
              </button>
            </div>

            <p class="group__hint">
              用于开关、选中标记与 Tab，并给面板掺一层极淡的同色。预设已校过对比度；
              自选过深或过淡的颜色会让开关的开合状态变得难以分辨。
            </p>
          </section>

          <!-- ── 方块区域 ─────────────────────────── -->
          <section class="group">
            <h3 class="group__title">方块区域</h3>

            <SegmentedControl
              :model-value="settings.areaMode"
              :options="AREA_MODE_OPTIONS"
              label="区域尺寸方式"
              @update:model-value="settings.setAreaMode"
            />

            <!-- 按尺寸：直接写像素宽高 -->
            <template v-if="settings.areaMode === 'pixel'">
              <div class="pair">
                <NumberField
                  id="area-width"
                  label="宽度"
                  unit="px"
                  :model-value="settings.areaWidth"
                  :min="AREA_SIZE_MIN"
                  :max="AREA_SIZE_MAX"
                  :step="10"
                  @update:model-value="settings.setAreaWidth"
                />
                <NumberField
                  id="area-height"
                  label="高度"
                  unit="px"
                  :model-value="settings.areaHeight"
                  :min="AREA_SIZE_MIN"
                  :max="AREA_SIZE_MAX"
                  :step="10"
                  @update:model-value="settings.setAreaHeight"
                />
              </div>

              <div class="actions">
                <button class="btn" type="button" @click="fillAreaFromViewport">
                  按当前画面（{{ autoFit.width }} × {{ autoFit.height }}）
                </button>
                <button
                  class="btn btn--ghost"
                  type="button"
                  :disabled="!settings.areaPixelFixed"
                  @click="settings.resetAreaSize()"
                >
                  自动
                </button>
              </div>
            </template>

            <!-- 按格数：写横竖格子数，换算成像素由网格自己做 -->
            <template v-else>
              <div class="pair">
                <NumberField
                  id="area-cols"
                  label="横向格数"
                  unit="列"
                  :model-value="settings.areaCols"
                  :min="AREA_CELL_MIN"
                  :max="AREA_CELL_MAX"
                  @update:model-value="settings.setAreaCols"
                />
                <NumberField
                  id="area-rows"
                  label="竖向格数"
                  unit="行"
                  :model-value="settings.areaRows"
                  :min="AREA_CELL_MIN"
                  :max="AREA_CELL_MAX"
                  @update:model-value="settings.setAreaRows"
                />
              </div>

              <div class="actions">
                <button class="btn" type="button" @click="fillCellsFromViewport">
                  按当前画面（{{ autoFit.cols }} × {{ autoFit.rows }}）
                </button>
                <button
                  class="btn btn--ghost"
                  type="button"
                  :disabled="!settings.areaCellFixed"
                  @click="settings.resetAreaCells()"
                >
                  自动
                </button>
              </div>
            </template>

            <p class="group__hint">
              留空或点「自动」即跟随窗口大小；区域缩小后放不下的方块会暂存，变大后自动放回
            </p>
          </section>

          <!-- ── 搜索 ─────────────────────────────── -->
          <!--
            这里只放「不该逐方块分裂」的三项：建议与补全是隐私 / 输入法取舍，
            自定义引擎表是所有搜索方块共用的词典。

            **搜索方块本身在添加对话框的「组件」里加，可以放多个**，
            每个方块用哪个引擎、多大，都在它自己的右键「编辑」里改。
          -->
          <section class="group">
            <h3 class="group__title">搜索</h3>

            <ToggleSwitch
              id="suggest-enabled"
              label="搜索建议"
              hint="开启后，输入内容会发送给所选搜索引擎以获取建议；关闭时搜索方块仍可正常使用"
              :model-value="settings.suggestEnabled"
              @update:model-value="settings.setSuggestEnabled"
            />

            <!--
              内联补全依赖建议数据，建议关着时它无从发生，所以整体禁用。
              不隐藏而是禁用：隐藏会让「我记得这里有个开关」的用户以为功能被删了。
            -->
            <ToggleSwitch
              id="inline-complete"
              label="内联补全"
              hint="边打字边把首条建议补在光标后（选中态，继续打字即覆盖）；需先开启搜索建议"
              :disabled="!settings.suggestEnabled"
              :model-value="settings.inlineCompleteEnabled && settings.suggestEnabled"
              @update:model-value="settings.setInlineCompleteEnabled"
            />

            <!--
              搜索记录默认**开启**，与上面两项相反：那两项会把用户打的字发给第三方，
              这一项全程留在本机（见 useSearchHistory）。它的成本是「摆在桌面上，
              旁人扫一眼就能看到」，所以给了开关与下面那个「清空」。

              关掉时不只是不显示：SearchWidget 的 submit 也不再往里写
              （只藏不停写等于把开关做成了一个假的）。已经存下的内容仍在，
              所以「清空」在关掉之后照样可点——这正是用户关掉它之后最可能想做的事。
            -->
            <ToggleSwitch
              id="search-history"
              label="搜索记录"
              hint="在 2 格高的搜索方块下方显示最近搜过的词；只存在本机，不发送给任何一方"
              :model-value="settings.searchHistoryEnabled"
              @update:model-value="settings.setSearchHistoryEnabled"
            />

            <div class="actions">
              <button
                class="btn btn--ghost"
                type="button"
                :disabled="!history.hasItems.value"
                @click="history.clear()"
              >
                清空搜索记录（{{ history.items.value.length }} 条）
              </button>
            </div>

            <div class="field">
              <span class="field__label">自定义引擎</span>
              <CustomEngines />
            </div>

            <p class="group__hint">
              搜索方块在「添加 → 组件」里放置，可以放多个；引擎与尺寸在方块的右键「编辑」里改
            </p>
          </section>

          <!-- ── 抽屉位置 ─────────────────────────── -->
          <section class="group">
            <h3 class="group__title">抽屉位置</h3>
            <SegmentedControl
              :model-value="settings.drawerSide"
              :options="SIDE_OPTIONS"
              label="抽屉位置"
              @update:model-value="settings.setDrawerSide"
            />
            <p class="group__hint">手柄与抽屉一起换到该侧，也可直接拖动手柄</p>
          </section>

          <!-- ── 交互 ─────────────────────────────── -->
          <section class="group">
            <h3 class="group__title">交互</h3>
            <ToggleSwitch
              id="close-on-scrim"
              label="点击遮罩关闭"
              hint="关闭后，设置抽屉与弹窗只能用关闭按钮或 Esc 退出，不会因误点空白处丢失填写内容"
              :model-value="settings.closeOnScrim"
              @update:model-value="settings.setCloseOnScrim"
            />
          </section>

          <!-- ── 回收站 ─────────────────────────── -->
          <section class="group">
            <h3 class="group__title">回收站</h3>

            <div class="recycle-card">
              <div v-if="grid.overflow.length > 0" class="recycle-list" role="list">
                <article v-for="tile in grid.overflow" :key="tile.id" class="recycle-row" role="listitem">
                  <div class="recycle-row__visual" :class="{ 'recycle-row__visual--widget': tile.kind === 'widget' }">
                    <TileIcon
                      v-if="tile.kind === 'link'"
                      :name="tileDisplayName(tile)"
                      :icon="tile.icon"
                      :bg-color="tile.bgColor"
                    />
                    <svg v-else viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect x="4" y="4" width="6" height="6" rx="1.2" stroke="currentColor" stroke-width="1.6" />
                      <rect x="14" y="4" width="6" height="6" rx="1.2" stroke="currentColor" stroke-width="1.6" />
                      <rect x="4" y="14" width="6" height="6" rx="1.2" stroke="currentColor" stroke-width="1.6" />
                      <rect x="14" y="14" width="6" height="6" rx="1.2" stroke="currentColor" stroke-width="1.6" />
                    </svg>
                  </div>

                  <div class="recycle-row__content">
                    <div class="recycle-row__heading">
                      <span class="recycle-row__name">{{ tileDisplayName(tile) }}</span>
                    </div>
                    <div class="recycle-row__details">
                      <span class="recycle-row__type">{{ recycleTileTypeLabel(tile) }}</span>
                      <span class="recycle-row__separator" aria-hidden="true">·</span>
                      <span class="recycle-row__meta">{{ recycleTileMeta(tile) }} 格</span>
                      <span class="recycle-row__separator" aria-hidden="true">·</span>
                      <span
                        class="recycle-row__reason"
                        :class="{ 'recycle-row__reason--deleted': recycleTileReason(tile) === 'deleted' }"
                      >
                        {{ recycleTileReasonLabel(tile) }}
                      </span>
                    </div>
                  </div>

                  <div class="recycle-row__actions" aria-label="回收站操作">
                    <button
                      class="recycle-row__button recycle-row__button--restore"
                      type="button"
                      :aria-label="`恢复 ${tileDisplayName(tile)}`"
                      title="恢复到网格"
                      @click="restoreRecycleTile(tile.id)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          stroke="currentColor"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="1.8"
                          d="M9 8H5V4M5.5 8.5A7 7 0 1 1 5 13"
                        />
                      </svg>
                    </button>
                    <button
                      class="recycle-row__button recycle-row__button--danger"
                      type="button"
                      :aria-label="`彻底删除 ${tileDisplayName(tile)}`"
                      title="彻底删除"
                      @click="confirmRecycleDeleteId = tile.id"
                    >
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          stroke="currentColor"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="1.8"
                          d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"
                        />
                      </svg>
                    </button>
                  </div>
                </article>
              </div>
              <div v-else class="recycle-empty" role="status">
                <div class="recycle-empty__placeholder">
                  <span class="recycle-empty__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path
                        d="M4.5 8.5h15v10h-15zM3.5 5.5h17v3h-17zM9 12h6"
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.6"
                      />
                    </svg>
                  </span>
                  <span class="recycle-empty__title">回收站为空</span>
                  <span class="recycle-empty__hint">暂时没有可恢复的方格</span>
                </div>
              </div>
            </div>

            <p class="group__hint">空间不足的方格会自动暂存，主动删除的方格也会保留在这里；点击恢复即可放回网格。</p>
          </section>

          <!-- ── 配置档 ─────────────────────────── -->
          <section class="group">
            <h3 class="group__title">配置档</h3>

            <div class="url-list">
              <div v-for="item in profiles" :key="item.id" class="url-row">
                <input
                  :id="`profile-name-${item.id}`"
                  v-model="nameDrafts[item.id]"
                  class="field__input url-row__input"
                  type="text"
                  :maxlength="PROFILE_NAME_MAX"
                  :aria-label="`配置名称：${item.name}`"
                  @change="commitProfileName(item.id)"
                  @keydown.enter.prevent="commitProfileName(item.id)"
                />
                <button
                  class="url-row__pick"
                  type="button"
                  :disabled="item.id === currentProfileId"
                  :aria-pressed="item.id === currentProfileId"
                  :title="item.id === currentProfileId ? '正在使用这个配置' : '切过去（会重新载入页面）'"
                  :aria-label="
                    item.id === currentProfileId
                      ? `${item.name} 正在使用中`
                      : `切换到 ${item.name}，页面会重新载入`
                  "
                  @click="pickProfile(item.id)"
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      stroke="currentColor"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2.4"
                      d="m5 13 4 4L19 7"
                    />
                  </svg>
                </button>
                <button
                  class="url-row__del"
                  type="button"
                  :disabled="!canRemoveProfile(item.id)"
                  :title="removeProfileTitle(item.id)"
                  :aria-label="`删除配置 ${item.name}`"
                  @click="confirmRemoveId = item.id"
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      stroke="currentColor"
                      stroke-linecap="round"
                      stroke-width="2"
                      d="M6 6l12 12M18 6L6 18"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <div class="actions actions--wrap">
              <button
                v-for="preset in PRESET_ORDER"
                :key="preset"
                class="btn btn--ghost"
                type="button"
                @click="addProfile(preset)"
              >
                从{{ PRESET_LABEL[preset] }}预设新建
              </button>
              <button class="btn btn--ghost" type="button" @click="copyProfile">复制当前配置</button>
            </div>

            <p class="group__hint">
              每个配置各有一套方块布局与外观设置；待办、搜索记录与搜索的三个开关由所有配置共用。
            </p>

            <div class="actions actions--wrap">
              <button class="btn btn--ghost" type="button" @click="cloudSyncOpen = true">
                云同步
              </button>
              <input
                ref="configFileInput"
                class="file-input"
                type="file"
                accept=".json,application/json"
                aria-label="选择要加载的 JSON 配置文件"
                @change="onConfigFileChange"
              />
              <button
                class="btn btn--ghost"
                type="button"
                :disabled="configImportBusy"
                :aria-busy="configImportBusy"
                @click="openConfigFilePicker"
              >
                {{ configImportBusy ? '正在加载…' : '加载配置' }}
              </button>
              <button class="btn btn--ghost" type="button" @click="downloadCurrentConfig">
                下载配置
              </button>
            </div>
            <p v-if="configImportError" class="field__error" role="alert">
              {{ configImportError }}
            </p>
          </section>

          <!--
            ── 重置 ───────────────────────────────

            钉在最底下，与上面各组之间多留一条分隔线：它不是一个设置项，
            而是一个作用于**全部**设置项的动作，混在中间会被误当成某一组的附属。
            抽屉是纵向滚动容器，放这里也意味着要滚到底才碰得到，正合适。
          -->
          <section class="group group--last">
            <h3 class="group__title">重置</h3>
            <!--
              hint 必须写明作用域，这是多档之后最要紧的一句。

              「把布局、设置与待办恢复成初始状态」字面上仍然对，却漏了一件事：
              待办、搜索记录与搜索的三个开关是**全局**存档，从手机档按下这个按钮，
              电脑档的待办也一起没了。不写出来，它就是一次静默的跨档数据删除。

              两句拆开写、按「只动这一档」→「跨全部档」→「不动别的档」排：
              抽屉里所有 hint 都是纯文本，不用 strong 之类的行内标记加重
              （视觉语言里没有那一档，也没有对应样式），靠句子顺序表达轻重。
            -->
            <p class="group__hint">
              当前配置的方块摆放与外观设置回到初始状态：默认布局、壁纸与主题色。
              所有配置共用的待办、搜索记录与搜索的三个开关也一并回到初始状态，天气缓存清空。
              其它配置的布局与外观不受影响。
            </p>
            <div class="actions">
              <button class="btn btn--danger" type="button" @click="confirmResetOpen = true">
                重置为默认
              </button>
            </div>
          </section>
        </div>
      </aside>

      <!--
        取色面板：加 / 改纯色档的自定义颜色。

        挂在 .scrim 内部而不是与它并列——外层 OverlayLayer 的 Transition
        只接受单个根元素，并列的第二个节点会让过渡失效。它自己再 Teleport
        到 body，且 --z-menu(1200) 高于 --z-drawer(1100)，所以仍浮在抽屉之上。
      -->
      <OverlayLayer v-if="pickerOpen && pickerAnchor" name="cp">
        <ColorPicker
          :model-value="pickerDraft"
          :anchor="pickerAnchor"
          label="背景颜色"
          @update:model-value="onPickerInput"
          @close="closePicker"
        />
      </OverlayLayer>

      <!--
        主题色的取色面板。与上面那台是两个独立实例而不是一台切换用途：
        两者的 v-if 条件、锚点、回调各不相同，共用一台就得在每个回调里分辨
        「这次是背景还是主题」。同一时刻只可能开一台，多一个节点不占什么。
      -->
      <OverlayLayer v-if="themePickerOpen && themePickerAnchor" name="cp">
        <ColorPicker
          :model-value="settings.themeColor"
          :anchor="themePickerAnchor"
          label="主题色"
          :alpha="false"
          @update:model-value="settings.setThemeColor"
          @close="closeThemePicker"
        />
      </OverlayLayer>

      <!--
        重置的二次确认。

        与两台取色面板同样挂在 .scrim 内部（并列的第二个根节点会让外层过渡失效），
        自己再 Teleport 到 body。它的 z-index 也是 --z-menu，压在抽屉之上。

        文案把作用域与后果都点名：只说「恢复默认设置」会让人以为方块摆放不受影响
        （那是这次重置里最不可逆的一样），而多档之后还要说清「这一档」与「全部档」
        的分界——待办与搜索记录是全局的，从任一档重置都会一起清掉。
      -->
      <OverlayLayer name="confirm">
        <ConfirmDialog
          v-if="confirmResetOpen"
          title="重置为默认？"
          message="当前配置的方块摆放与外观设置会被丢弃，换回初始状态；所有配置共用的待办、搜索记录与搜索开关也一并回到初始状态，天气缓存清空。此配置里添加的本地壁纸会被删除，此操作无法撤销。其它配置不受影响。"
          confirm-label="重置"
          @confirm="doReset"
          @cancel="confirmResetOpen = false"
        />
      </OverlayLayer>

      <OverlayLayer name="confirm-recycle">
        <ConfirmDialog
          v-if="confirmRecycleDeleteId"
          title="彻底删除这个方格？"
          :message="`「${confirmRecycleDeleteName}」将从回收站永久删除，无法恢复。`"
          confirm-label="彻底删除"
          @confirm="deleteRecycleTile"
          @cancel="confirmRecycleDeleteId = null"
        />
      </OverlayLayer>

      <OverlayLayer name="cloud-sync" duration="base">
        <CloudSyncDialog v-if="cloudSyncOpen" @close="cloudSyncOpen = false" />
      </OverlayLayer>

      <OverlayLayer name="confirm">
        <ConfirmDialog
          v-if="pendingConfigImport"
          title="覆盖同一个配置？"
          :message="importConflictMessage"
          confirm-label="覆盖并加载"
          cancel-label="取消加载"
          :danger="false"
          @confirm="confirmConfigOverwrite"
          @cancel="pendingConfigImport = null"
        />
      </OverlayLayer>

      <OverlayLayer name="toast">
        <UndoToast v-if="recycleNotice" :message="recycleNotice" @close="recycleNotice = ''" />
      </OverlayLayer>

      <!--
        删档的二次确认。

        与重置那台是两个独立实例而不是一台切换用途，与两台取色面板同一个判据：
        v-if 条件、文案、回调各不相同，共用一台就得在每个回调里分辨「这次是重置
        还是删档」。同一时刻只可能开一台，多一个节点不占什么。

        删档删的是那一档的布局、外观与它独占的本地壁纸字节，撤不回来
        （壁纸字节已从 IndexedDB 删掉），所以走「先问再做」而不是可撤销。
      -->
      <OverlayLayer name="confirm">
        <ConfirmDialog
          v-if="confirmRemoveId"
          title="删除这个配置？"
          :message="`「${confirmRemoveName}」的方块布局与外观设置会被删除，只被它用到的本地壁纸也会一并删掉，无法撤销。待办与搜索记录是所有配置共用的，不受影响。`"
          confirm-label="删除"
          @confirm="doRemoveProfile"
          @cancel="confirmRemoveId = null"
        />
      </OverlayLayer>
    </div>
  </OverlayLayer>
</template>

<style scoped>
.scrim {
  position: fixed;
  z-index: var(--z-drawer);
  display: flex;
  padding: var(--sp-3);
  inset: 0;
}

/*
 * 两层都是装饰层，pointer-events: none 保证 @pointerdown.self 仍能命中 .scrim 本身，
 * 点空白关闭的行为不受拆层影响。
 */
.scrim__glass,
.scrim__tint {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* 磨砂层：属性在整个生命周期内恒定，绝不进入任何过渡 */
.scrim__glass {
  backdrop-filter: var(--glass-scrim);
}

/* 压暗层：只有它跟着进出场动 opacity，纯色层重合成几乎零成本 */
.scrim__tint {
  background: var(--scrim-tint);
}

/* 不支持 backdrop-filter 时退化为更深的纯色半透明 */
@supports not (backdrop-filter: blur(1px)) {
  .scrim__tint {
    background: rgb(6 6 8 / 0.82);
  }
}

/* ── 面板：悬浮卡片，四周留白不贴边 ─────────────────── */

.drawer {
  position: relative;
  display: flex;
  width: min(380px, 100%);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--panel-radius);
  background: var(--bg-drawer);
  backdrop-filter: var(--glass-drawer);
  /*
   * 单层阴影，不再叠顶部的 inset 内高光。
   * 内高光是拟物玻璃的痕迹：它模拟的是「玻璃厚度的高光边」，
   * 而这里的面板语言是一张压在页面上的纸，只需要一道描边。
   */
  box-shadow: var(--shadow-lg);
}

.drawer--left {
  margin-right: auto;
}

.drawer--right {
  margin-left: auto;
}

@supports not (backdrop-filter: blur(1px)) {
  .drawer {
    background: var(--surface-1);
  }
}

/* ── 头部 ─────────────────────────────────────────── */

.drawer__head {
  position: relative;
  display: flex;
  align-items: center;
  padding: var(--sp-4) var(--sp-4) var(--sp-4) 18px;
  border-bottom: 1px solid var(--line-subtle);
  gap: var(--sp-3);
}

.drawer__badge {
  display: grid;
  width: 34px;
  height: 34px;
  flex: none;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  /* 中性填充：徽章不该是全屏唯一的彩色块，--accent 只留给状态 */
  background: var(--fill-raised);
  color: var(--color-text);
  place-items: center;
}

.drawer__badge svg {
  width: 18px;
  height: 18px;
}

.drawer__title {
  margin: 0;
  flex: 1;
  font-size: var(--fs-lg);
  font-weight: 600;
  letter-spacing: 0.01em;
}

.close {
  position: relative;
  display: grid;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: var(--r-md);
  color: var(--color-text-dim);
  place-items: center;
  transition:
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.close svg {
  width: 16px;
  height: 16px;
}

/* 视觉 34px、命中区域补到 44px，满足触控最小尺寸 */
.close::after {
  position: absolute;
  content: '';
  inset: -5px;
}

.close:hover {
  background: var(--fill-raised);
  color: var(--color-text);
}

.close:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/* ── 主体 ─────────────────────────────────────────── */

.drawer__body {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow-y: auto;
  padding: 18px;
  gap: 22px;
  scrollbar-color: rgb(255 255 255 / 0.18) transparent;
  scrollbar-width: thin;
}

/* ── 设置分组 ─────────────────────────────────────── */

.group {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.group__title {
  margin: 0;
  color: var(--color-text);
  font-size: var(--fs-base);
  font-weight: 600;
  letter-spacing: 0.02em;
}

/*
 * 最后一组（重置）与上面隔开。
 *
 * 一条分隔线 + 双倍间距：它是作用于全部设置项的动作，不是又一个设置项。
 * margin-top 而不是给 .drawer__body 加 justify-content——抽屉的内容比视口高，
 * 「钉在底部」在滚动容器里只能靠顺序，不能靠对齐。
 */
.group--last {
  margin-top: var(--sp-2);
  border-top: 1px solid var(--line-subtle);
  padding-top: 22px;
}

.group__hint {
  margin: 0;
  color: var(--color-text-faint);
  font-size: var(--fs-sm);
  line-height: 1.5;
}

/*
 * 需要用户注意但不是错误：存储不可用属于环境限制，用户改不了，
 * 只需要知道后果。用 --danger 而不是新造一个警告色——视觉语言里没有黄色档。
 */
.group__hint.is-warn {
  color: var(--danger);
}

/* 回收站列表与空状态共用一张卡片，条目再用轻量卡片分组，状态切换时边界不跳动。 */
.recycle-card {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--fill);
  padding: var(--sp-2);
}

.recycle-list {
  display: flex;
  max-height: 280px;
  flex-direction: column;
  overflow-y: auto;
  padding: var(--sp-1);
  gap: var(--sp-2);
  scrollbar-width: thin;
}

.recycle-row {
  display: grid;
  flex: none;
  min-height: 64px;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  grid-template-areas: 'visual content actions';
  align-items: center;
  border: 1px solid var(--line-subtle);
  border-radius: var(--r-md);
  background: var(--surface-2);
  padding: var(--sp-3);
  gap: var(--sp-3);
  transition:
    border-color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease),
    transform var(--dur-fast) var(--ease);
}

.recycle-row:hover {
  border-color: var(--line-strong);
  background: var(--fill-hover);
}

.recycle-row__visual {
  grid-area: visual;
  display: grid;
  width: 42px;
  height: 42px;
  flex: none;
  overflow: hidden;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--fill-raised);
  color: var(--color-text-dim);
}

.recycle-row__visual--widget {
  background: color-mix(in srgb, var(--accent) 14%, var(--fill-raised));
  color: var(--accent);
}

.recycle-row__visual svg {
  width: 21px;
  height: 21px;
}

.recycle-row__visual :deep(.tile-icon) {
  border-radius: inherit;
  font-size: 19px;
}

.recycle-row__content {
  grid-area: content;
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--sp-1);
}

.recycle-row__heading {
  display: flex;
  min-width: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-2);
}

.recycle-row__name {
  overflow: hidden;
  min-width: 0;
  color: var(--color-text);
  font-size: var(--fs-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recycle-row__details {
  display: flex;
  min-width: 0;
  align-items: center;
  flex-wrap: wrap;
  row-gap: var(--sp-1);
  color: var(--color-text-faint);
  font-size: var(--fs-xs);
  line-height: 1.4;
}

.recycle-row__type {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recycle-row__separator {
  padding: 0 var(--sp-1);
  color: var(--color-text-disabled);
}

.recycle-row__meta {
  color: var(--color-text-faint);
}

.recycle-row__reason {
  flex: none;
  width: fit-content;
  padding: 2px 7px;
  border: 1px solid color-mix(in srgb, var(--focus) 45%, transparent);
  border-radius: var(--r-full);
  color: var(--focus);
  font-size: var(--fs-xs);
  line-height: 1.3;
}

.recycle-row__reason--deleted {
  border-color: color-mix(in srgb, var(--danger) 45%, transparent);
  color: var(--danger);
}

.recycle-row__actions {
  grid-area: actions;
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--sp-2);
}

.recycle-row__button {
  position: relative;
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: var(--r-sm);
  color: var(--color-text-faint);
  transition:
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

/* 视觉图标保持紧凑，命中区域扩展到约 44px，方便触控操作。 */
.recycle-row__button::after {
  position: absolute;
  content: '';
  inset: -7px;
}

.recycle-row__button svg {
  width: 15px;
  height: 15px;
}

.recycle-row__button:hover {
  background: var(--fill-hover);
  color: var(--color-text);
}

.recycle-row__button--restore:hover {
  color: var(--accent);
}

.recycle-row__button--danger:hover {
  color: var(--danger);
}

.recycle-row__button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.recycle-empty {
  display: flex;
  min-height: 174px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  padding: var(--sp-2);
}

.recycle-empty__placeholder {
  display: flex;
  width: 100%;
  min-height: 150px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: var(--sp-2);
  border: 1px dashed var(--line);
  border-radius: var(--r-md);
  color: var(--color-text-faint);
  font-size: var(--fs-sm);
  text-align: center;
}

.recycle-empty__icon {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid var(--line-subtle);
  border-radius: var(--r-full);
  background: var(--fill-raised);
  color: var(--color-text-disabled);
}

.recycle-empty__icon svg {
  width: 20px;
  height: 20px;
}

.recycle-empty__title {
  color: var(--color-text-dim);
}

.recycle-empty__hint {
  color: var(--color-text-faint);
  font-size: var(--fs-xs);
}

@media (max-width: 480px) {
  .recycle-row {
    grid-template-areas:
      'visual content'
      'visual actions';
    grid-template-columns: 36px minmax(0, 1fr);
    padding: var(--sp-2);
  }

  .recycle-row__visual {
    width: 36px;
    height: 36px;
  }

  .recycle-row__actions {
    justify-content: flex-end;
    margin-top: calc(var(--sp-1) * -1);
  }
}

/* ── 色板 ─────────────────────────────────────────── */

/* 固定 4 列而非 auto-fit：8 个预设正好两行，色块保持足够的点击宽度 */
.swatches {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--sp-2);
}

.swatch {
  position: relative;
  height: 34px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  transition:
    transform var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}

.swatch:hover {
  border-color: var(--color-text-faint);
  transform: translateY(-1px);
}

/*
 * 选中态用外圈描边而不是内部勾号：色块本身很小，勾号在深色上不易辨识。
 * 这是 --accent 的三处用途之一——纯灰描边在一排深灰色块上分不出选中的是哪个。
 */
.swatch.is-active {
  border-color: transparent;
  box-shadow:
    0 0 0 2px var(--accent),
    var(--shadow-sm);
}

/*
 * 主题色块的选中环不能用 --accent。
 *
 * --accent 就是当前主题色，而被选中的那一格底色恰好也是它——环会融进色块里，
 * 一排色块看不出选中的是哪个。这里换中性亮边：它与任何色相的预设都分得开。
 */
.swatch--theme.is-active {
  box-shadow:
    0 0 0 2px var(--color-text),
    var(--shadow-sm);
}

.swatch:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/*
 * 选中勾。
 *
 * 颜色写死 #fff 而不是用 --color-text：色块的底色由用户选，
 * 令牌色在浅色块上可能与底一致。深色预设配白勾，加一层投影兜住极浅的自定义色。
 */
.swatch__tick {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 16px;
  height: 16px;
  color: #fff;
  filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.6));
  transform: translate(-50%, -50%);
}

/* 自定义色与删除按钮共用一个定位上下文，删除按钮才能贴到它右上角 */
.swatch-slot {
  position: relative;
  display: block;
}

.swatch-slot .swatch {
  width: 100%;
}

/*
 * 自定义色的删除入口常驻。
 *
 * 与缩略图那边（悬停才显形）不同：色块只有 34px 高，悬停才出现的按钮会盖住
 * 大半个色块，反而看不清自己选的颜色；这里体积小、位置在角上，常驻更省事。
 */
.swatch-slot__del {
  position: absolute;
  z-index: 2;
  top: -5px;
  right: -5px;
  display: grid;
  width: 18px;
  height: 18px;
  border: 1px solid var(--line);
  border-radius: 50%;
  background-color: var(--bg-menu);
  color: var(--color-text-dim);
  place-items: center;
  touch-action: manipulation;
  transition: background-color var(--dur-fast) var(--ease);
}

/* 视觉按钮保持紧凑，命中区扩展到约 40px，满足触控与窄色块场景。 */
.swatch-slot__del::after {
  position: absolute;
  content: '';
  inset: -8px;
}

.swatch-slot__del svg {
  position: relative;
  z-index: 1;
  width: 9px;
  height: 9px;
}

.swatch-slot__del:hover:not(:disabled) {
  background-color: var(--danger-bg);
  color: var(--danger);
}

.swatch-slot__del:disabled {
  color: var(--color-text-disabled);
  cursor: not-allowed;
  opacity: 0.65;
}

.swatch-slot__del:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

/* 添加位：虚线描边表示「这里还没有内容」，与缩略图的添加位同一语言 */
.swatch--add {
  display: grid;
  border-style: dashed;
  background: var(--fill);
  color: var(--color-text-faint);
  place-items: center;
}

.swatch--add svg {
  width: 16px;
  height: 16px;
}

.swatch--add:hover:not(:disabled) {
  color: var(--color-text);
}

.swatch--add:disabled {
  color: var(--color-text-disabled);
  cursor: default;
  transform: none;
}

/* ── 本地图片缩略图 ───────────────────────────────── */

/*
 * 固定 4 列，与色板同一栅格。
 * aspect-ratio: 1 让每格是正方形，圆角由 --r-md 给。
 */
.thumbs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--sp-2);
}

.thumb {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--surface-2);
}

.thumb__img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

/* 字节丢失的占位：与「加载失败」同一个弱化灰，不用 --danger 喊 */
.thumb__gone {
  display: grid;
  width: 100%;
  height: 100%;
  color: var(--color-text-faint);
  place-items: center;
}

.thumb__gone svg {
  width: 22px;
  height: 22px;
}

/*
 * 删除按钮：贴右下角，默认透明。
 *
 * 用 opacity 而不是 display/v-if——它必须始终留在无障碍树与 Tab 序列里，
 * 否则键盘用户没有任何删除入口。聚焦时同样显形（:focus-visible 分支），
 * 不然 Tab 到了却看不见焦点落在哪。
 */
.thumb__del {
  position: absolute;
  /* 压在铺满的选中区（z-index: 1）之上，右下角那一小块才归删除 */
  z-index: 3;
  right: 4px;
  bottom: 4px;
  display: grid;
  width: 22px;
  height: 22px;
  border-radius: var(--r-sm);
  /* 缩略图内容不可预测，按钮自带深底才能保证 x 在任何图上都看得见 */
  background: rgb(6 6 8 / 0.72);
  color: #fff;
  opacity: 0;
  place-items: center;
  transition:
    opacity var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.thumb__del svg {
  width: 13px;
  height: 13px;
}

.thumb:hover .thumb__del,
.thumb__del:focus-visible {
  opacity: 1;
}

.thumb__del:hover {
  background: rgb(6 6 8 / 0.88);
  color: var(--danger);
}

.thumb__del:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

/*
 * 选中用的点击区：铺满整块缩略图。
 *
 * 自身不画任何东西（选中态由右上角的勾表达），只承接点击。
 * 铺满是有意的——「点这张图用它」里被点的对象就是整张图，
 * 缩到一个小角标会让人以为图本身不可点。
 *
 * z-index 比删除按钮低一级：两者重叠的右下角那一小块必须归删除按钮，
 * 否则想删的时候点到的是「设为背景」。
 */
.thumb__pick {
  position: absolute;
  z-index: 1;
  border-radius: inherit;
  inset: 0;
}

.thumb__pick:disabled {
  cursor: not-allowed;
}

.thumb__pick:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

/* 悬停时压一层薄暗，说明这块是可点的；选中的那张已有勾，不需要再提示 */
.thumb__pick:hover:not(:disabled) {
  background: rgb(6 6 8 / 0.28);
}

.thumb__pick[aria-pressed='true']:hover {
  background: none;
}

/*
 * 选中勾：右上角，自带半透明深底。
 *
 * 底不能省——缩略图是用户自己的照片，纯白勾压在浅色天空上就消失了。
 * 与右下角的删除按钮分处两角，同时出现也不重叠。
 * pointer-events: none 让点击穿到下面铺满的选中按钮，
 * 否则勾自己会把「再点一下这张」的点击吃掉。
 *
 * 常驻 DOM，靠 --on 开合，两个方向都有过渡（见模板注释）。缩放比 ContextMenu 的
 * 0.96 深得多：那是一整块菜单，缩 4% 已是可观位移；这里只有 22px，同样比例
 * 折算下来不足 1px，等于没动。缩放原点压在右上角——它贴着那个角，
 * 从中心缩放会让它在出现过程中离角一小段又贴回去。
 */
.thumb__tick {
  position: absolute;
  z-index: 2;
  top: 4px;
  right: 4px;
  display: grid;
  width: 22px;
  height: 22px;
  border-radius: var(--r-sm);
  background: rgb(6 6 8 / 0.72);
  color: #fff;
  opacity: 0;
  place-items: center;
  transform: scale(0.72);
  transform-origin: top right;
  pointer-events: none;
  transition:
    opacity var(--dur-fast) var(--ease),
    transform var(--dur-fast) var(--ease);
}

.thumb__tick--on {
  opacity: 1;
  transform: scale(1);
}

.thumb__tick svg {
  width: 14px;
  height: 14px;
}

/* 添加位与缩略图同尺寸，虚线描边 */
.thumb--add {
  display: grid;
  border-style: dashed;
  background: var(--fill);
  color: var(--color-text-faint);
  place-items: center;
  transition:
    border-color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.thumb--add svg {
  width: 20px;
  height: 20px;
}

.thumb--add:hover:not(:disabled) {
  border-color: var(--color-text-faint);
  background: var(--fill-hover);
  color: var(--color-text);
}

.thumb--add:disabled {
  color: var(--color-text-disabled);
  cursor: default;
}

.thumb--add:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/* ── 行列表（网络地址 / 配置档共用） ─────────────── */

/*
 * 这一套 .url-list / .url-row / __input / __pick / __del 有两个消费方：
 * 网络图片的地址列表与最上面那节配置档。类名沿用 url- 前缀而不是另起一套
 * 中性名（list-row 之类）——两处的形状完全一致（一行输入框 + 行尾一颗勾一个叉），
 * 改名要动的是两处模板与十几条选择器，换来的只是名字更准。
 * 配置档那节不用 .url-add（新增走下面的 ghost 按钮），所以 --url-tail-w 与它无关。
 *
 * 行高固定成一个变量，下面的滚动上限直接乘它。
 *
 * 曾经按 .field__input 的 padding + 字号「推算」出 34px，实测行高却是 37px
 * ——字号是 rem 派生的，推算差 3px，5 行就差出 15px，正好把第五行切掉一截，
 * 「最多显示 5 条」变成 4 条半。行高与上限共用同一个值就不会再错位。
 */
.url-list {
  --url-row-h: 37px;
  /* 行尾按钮占的总宽（含与输入框之间的 gap），添加行据此对齐右边缘 */
  --url-tail-w: calc(30px + var(--sp-1));

  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

/* 关着轮换时每行多一个「勾」，行尾宽度翻一倍 */
.url-list.has-pick {
  --url-tail-w: calc(30px * 2 + var(--sp-1) * 2);
}

/*
 * 超过 5 行就在列表内部滚动。
 *
 * 这是纯显示上限（数量上限是 BG_IMAGE_MAX）：抽屉本身已是纵向滚动容器，
 * 列表无限长会把下面的模糊、动画等设置项推出视野。
 * padding-right 给滚动条留位，否则它会压在删除按钮上。
 */
.url-list.is-scroll {
  max-height: calc(var(--url-row-h) * 5 + var(--sp-1) * 4);
  overflow-y: auto;
  padding-right: var(--sp-1);
  scrollbar-width: thin;
}

.url-row {
  display: flex;
  height: var(--url-row-h);
  align-items: center;
  flex: none;
  gap: var(--sp-1);
}

.url-row__input {
  min-width: 0;
  flex: 1;
}

/*
 * 每行的状态只靠描边色表达，不逐行挂说明文字——
 * 5 行各带一句会把下面的设置项挤出视野，汇总语在列表下方统一给。
 */
.url-row__input.is-error {
  border-color: var(--danger);
}

.url-row__input.is-ok {
  border-color: var(--line-strong);
}

/* 两个行尾按钮同款同尺寸，差别只在图标与悬停色 */
.url-row__del,
.url-row__pick {
  display: grid;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: var(--r-sm);
  color: var(--color-text-faint);
  place-items: center;
  transition:
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.url-row__del svg,
.url-row__pick svg {
  width: 14px;
  height: 14px;
}

.url-row__del:hover:not(:disabled) {
  background: var(--fill-hover);
  color: var(--danger);
}

/*
 * 删除禁用态压暗，与「勾」的禁用态相反。
 *
 * 那颗勾禁用时保持 opacity: 1 且染 --accent，因为它表达的是「已选中」；
 * 这里的禁用是真的不可用（不能删当前档 / 不能删到零档），压暗才对得上。
 * 原因写在按钮的 title 里，不做成点了没反应。
 */
.url-row__del:disabled {
  color: var(--color-text-disabled);
  cursor: default;
}

/*
 * 选中态用 --accent 而不是灰：一列长得一样的地址行里，
 * 「正在用的是哪条」得能一眼扫出来，弱化灰的勾在禁用后更认不出来。
 * 这是 --accent 少数几处用途之一（标状态）。
 */
.url-row__pick:hover:not(:disabled) {
  background: var(--fill-hover);
  color: var(--color-text);
}

.url-row__pick:disabled {
  color: var(--accent);
  cursor: default;
  /* 不降不透明度：禁用在这里表达的是「已选中」，压暗反而像不可用 */
  opacity: 1;
}

.url-row__del:focus-visible,
.url-row__pick:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

/*
 * 列表末尾的添加行：虚线框 + 居中图标文案，宽度与输入行对齐
 * （右侧留出与行尾按钮等宽的空隙，末项不至于比上面几行长出一截）。
 *
 * 留多宽跟着行尾有几个按钮走：关着轮换时每行是「勾 + x」两个，
 * 仍按一个算的话添加行会比上面几行长出 31px，右边缘对不齐。
 */
.url-add {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: var(--url-tail-w);
  padding: var(--sp-2);
  border: 1px dashed var(--line-strong);
  border-radius: var(--r-md);
  background: var(--fill);
  color: var(--color-text-dim);
  font-size: var(--fs-sm);
  gap: var(--sp-1);
  transition:
    border-color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.url-add svg {
  width: 14px;
  height: 14px;
}

.url-add:hover:not(:disabled) {
  border-color: var(--color-text-faint);
  background: var(--fill-hover);
  color: var(--color-text);
}

.url-add:disabled {
  color: var(--color-text-disabled);
  cursor: default;
}

.url-add:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/* ── 表单字段 ─────────────────────────────────────── */

.field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.field__label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  color: var(--color-text-dim);
  font-size: var(--fs-sm);
  gap: var(--sp-2);
}

.field__value {
  color: var(--color-text);
  font-size: var(--fs-sm);
  font-variant-numeric: tabular-nums;
}

.field__input {
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--fill);
  font-size: var(--fs-base);
  transition: border-color var(--dur-fast) var(--ease);
}

.field__input:focus {
  border-color: var(--focus);
  outline: none;
}

.field__hint {
  color: var(--color-text-faint);
  font-size: var(--fs-xs);
}

/*
 * 加载失败沿用 --danger，但仍留在 hint 位而不是换成 .field__error：
 * 地址本身是合法的，问题在远端，用户不需要重填格式——只需要知道这张图取不到。
 */
.field__hint.is-error {
  color: var(--danger);
}

.field__hint.is-ok {
  color: var(--color-text-dim);
}

.field__error {
  color: var(--danger);
  font-size: var(--fs-xs);
}

/* ── 成对数值输入 ─────────────────────────────────── */

/* 两个输入平分一行：宽 / 高、列 / 行都是同级的一对，竖排会拉长面板 */
.pair {
  display: flex;
  gap: var(--sp-2);
}

.actions {
  display: flex;
  gap: var(--sp-2);
}

.file-input {
  display: none;
}

/*
 * 配置档那排三个 ghost 按钮要换行。
 *
 * .actions 默认单行不换（那里最多两个按钮：一个主 + 一个「自动」），
 * 三个「从…新建 / 复制当前配置」在 380px 宽的抽屉里横排必然挤成竖条文字。
 * flex: 1 1 auto 让它们按文字长度分配、放不下就折行，而 .btn--ghost 自己是
 * flex: none——所以这里要把它盖回来。
 */
.actions--wrap {
  flex-wrap: wrap;
}

.actions--wrap .btn {
  flex: 1 1 auto;
}

.btn {
  flex: 1;
  padding: var(--sp-2) var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--fill-raised);
  color: var(--color-text);
  font-size: var(--fs-sm);
  line-height: 1.3;
  transition:
    background-color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}

.btn:hover:not(:disabled) {
  border-color: var(--line-strong);
  background: var(--fill-hover);
}

/* 「自动」是退回默认的次要动作，不与主按钮争视觉重量 */
.btn--ghost {
  flex: none;
  background: none;
  color: var(--color-text-dim);
}

/*
 * 重置按钮：红字 + 淡红底，与右键菜单的 is-danger、确认框的 .btn--danger 同一套令牌。
 * 不用实心红底——那会让它成为整个抽屉里最重的元素，而这里要的是「看清了再点」。
 */
.btn--danger {
  border-color: rgb(248 113 113 / 0.32);
  background: var(--danger-bg);
  color: var(--danger);
}

.btn--danger:hover:not(:disabled) {
  border-color: rgb(248 113 113 / 0.5);
  background: rgb(248 113 113 / 0.24);
}

.btn:disabled {
  color: var(--color-text-disabled);
  cursor: default;
}

.btn:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/* ── 滑块 ─────────────────────────────────────────── */

.slider {
  width: 100%;
  height: 20px;
  margin: 0;
  appearance: none;
  background: none;
  cursor: pointer;
}

.slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: var(--r-full);
  background: var(--fill-hover);
}

.slider::-moz-range-track {
  height: 4px;
  border-radius: var(--r-full);
  background: var(--fill-hover);
}

/* margin-top 让圆钮相对 4px 轨道垂直居中：(4 - 14) / 2 */
.slider::-webkit-slider-thumb {
  width: 14px;
  height: 14px;
  margin-top: -5px;
  appearance: none;
  border: none;
  border-radius: 50%;
  background: var(--color-text);
  box-shadow: var(--shadow-sm);
}

.slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: none;
  border-radius: 50%;
  background: var(--color-text);
  box-shadow: var(--shadow-sm);
}

.slider:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 4px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* ── 进出场：只动 transform / opacity ───────────────── */

/*
 * 过渡刻意不落在 .scrim 上。
 *
 * 祖先的 opacity < 1 会建立新的 backdrop root，让后代的 backdrop-filter
 * 只能采样到祖先内部（此时几乎全透明），既每帧付全屏读回的代价、
 * 又看不到真正的模糊结果。所以淡入淡出只交给纯色的 __tint。
 */
.drawer-enter-active .scrim__tint,
.drawer-leave-active .scrim__tint {
  transition: opacity var(--dur-base) var(--ease);
  /* 只在动画窗口内提升；class 移除后自动撤销，不留常驻的全屏纹理 */
  will-change: opacity;
}

/* 退场期间组件还挂着，遮罩得让出点击，否则关闭后有一段时间点不动下面的方格 */
.drawer-leave-active {
  pointer-events: none;
}

.drawer-enter-from .scrim__tint,
.drawer-leave-to .scrim__tint {
  opacity: 0;
}

.drawer-enter-active .drawer,
.drawer-leave-active .drawer {
  transition:
    transform var(--dur-base) var(--ease),
    opacity var(--dur-base) var(--ease);
  will-change: transform, opacity;
}

.drawer-enter-from .drawer,
.drawer-leave-to .drawer {
  opacity: 0;
}

.drawer-enter-from .drawer--right,
.drawer-leave-to .drawer--right {
  transform: translateX(24px);
}

.drawer-enter-from .drawer--left,
.drawer-leave-to .drawer--left {
  transform: translateX(-24px);
}
</style>

/**
 * 存档键的寻址层：把「哪一档」这件事收在一处。
 *
 * 存档分两类，键的形状不同：
 *
 *   按档  leisure-hub:grid@<id>      leisure-hub:settings@<id>
 *   全局  leisure-hub:global   leisure-hub:todos   leisure-hub:search-history
 *         leisure-hub:weather:<lat>,<lon>
 *
 * 后缀用 `@` 而不是 `:`——`:` 已经是**段**分隔符，而天气那条键证明段之后可以跟
 * 任意内容（`weather:22.21,113.46`）。再用 `:` 挂档位 id 就没法一眼看出
 * `leisure-hub:weather:mobile` 是「mobile 档的天气」还是「地点叫 mobile」。
 * `@` 另起一个层级，且 `grep "leisure-hub:grid"` 仍然命中所有档。
 * `clearWeatherCache` 的前缀扫描（weather/cache.ts）扫的是 `leisure-hub:weather:`，
 * 不会误伤带 `@` 的键。
 *
 * **索引是自初始化的**：任何一次 keyFor / activePreset 都会先跑一遍 ensure()，
 * 于是「谁先被求值」不再是正确性的前提。这一点是刻意的——types/tile 在模块求值
 * 时就要拿预设的列数，而模块求值顺序在打包器手里，不该靠它。
 */

import { nanoid } from 'nanoid'

import {
  PRESET_LABEL,
  PRESET_ORDER,
  PROFILE_NAME_MAX,
  PROFILE_PRESETS,
  PROFILE_SCHEMA_VERSION,
  isProfilePreset,
  type PresetDef,
  type ProfileEntry,
  type ProfileIndex,
  type ProfilePreset,
} from '@/types/profile'
import { ensureStorageMigrated, STORAGE_NAMESPACE } from '@/utils/storageNamespace'

ensureStorageMigrated()

const NS = STORAGE_NAMESPACE
const INDEX_KEY = `${NS}:profiles`

/** 按档存档的 base 名，删档时要按这张表逐个清 */
export const PER_PROFILE_BASES = ['grid', 'settings'] as const

/**
 * 首次检测的门槛，单位 px。
 *
 * 693 不是拍的数，它是「电脑档的默认布局还能不能完整渲染」的临界值：
 * 那一档最宽的方块是搜索，占 7 格；放不下 7 格，grid 的 resize 就会把它丢进
 * overflow 暂存（`areaFree` 里 `col + w > cols` 恒真 → displaced → 补位循环的
 * `col + w <= nextCols` 也永不成立 → overflow）。**在放不下 7 格的屏上选电脑档，
 * 搜索方块从一开始就是不可见的。**
 *
 * 写成算式而不是字面量 693，是为了让「7 格」「75+20」「两侧各 24 的 --grid-padding」
 * 这三个来源留在原地；改 tile 尺寸或 padding 时这里跟着走。
 */
const SEARCH_WIDEST_SPAN = 7
const DETECT_MIN_EDGE =
  SEARCH_WIDEST_SPAN * 75 + (SEARCH_WIDEST_SPAN - 1) * 20 + 2 * 24

/* ── localStorage 的薄包装：无痕模式 / 配额下一律降级为「没有」 ── */

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 存储不可用：本次会话仍然能跑，只是切档、改名活不过刷新
  }
}

function removeRaw(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // 同上
  }
}

/* ── 键 ─────────────────────────────────────────────── */

/** 全局存档的键（待办、搜索记录、:global） */
export function globalKey(base: string): string {
  return `${NS}:${base}`
}

/** 某一档的存档键 */
export function keyForProfile(base: string, id: string): string {
  return `${NS}:${base}@${id}`
}

/** 当前档的存档键。store 的 load / persist 一律走这里 */
export function keyFor(base: string): string {
  return keyForProfile(base, activeProfileId())
}

/** `leisure-hub:<base>@` 前缀，供跨档扫描（IDB 引用计数、索引恢复） */
export function profileKeyPrefix(base: string): string {
  return `${NS}:${base}@`
}

/**
 * 扫出某个 base 下所有档的键与 id。
 *
 * **先收集再操作**，与 clearWeatherCache 同一条纪律：在遍历里 removeItem
 * 会让后续下标整体前移，漏掉相邻的键。
 */
export function scanProfileKeys(base: string): { id: string; key: string }[] {
  const prefix = profileKeyPrefix(base)
  const out: { id: string; key: string }[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(prefix)) continue
      const id = key.slice(prefix.length)
      if (id) out.push({ id, key })
    }
  } catch {
    return []
  }
  return out
}

/* ── 索引 ───────────────────────────────────────────── */

let index: ProfileIndex | null = null

function sanitizeName(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim().slice(0, PROFILE_NAME_MAX) : ''
  return text || fallback
}

/**
 * 校验索引。
 *
 * 一处不合法就整份判为「不认识」（返回 null），而不是逐字段兜底：索引是其余所有
 * 按档键的**寻址表**，一个坏掉的 id 会让那一档的存档从此找不到，比整份重建更难查。
 * 整份重建并不丢数据——见 ensure() 里的恢复分支。
 */
function sanitizeIndex(raw: string | null): ProfileIndex | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ProfileIndex>
    if (parsed?.version !== PROFILE_SCHEMA_VERSION) return null
    if (!Array.isArray(parsed.items)) return null

    const items: ProfileEntry[] = []
    for (const row of parsed.items) {
      if (!row || typeof row !== 'object') continue
      const entry = row as Partial<ProfileEntry>
      if (typeof entry.id !== 'string' || !entry.id) continue
      if (entry.id.includes('@') || entry.id.includes(':')) continue
      if (items.some((existing) => existing.id === entry.id)) continue
      const preset: ProfilePreset = isProfilePreset(entry.preset) ? entry.preset : 'desktop'
      items.push({ id: entry.id, name: sanitizeName(entry.name, PRESET_LABEL[preset]), preset })
    }
    if (items.length === 0) return null

    const active =
      typeof parsed.active === 'string' && items.some((item) => item.id === parsed.active)
        ? parsed.active
        : items[0].id
    return { version: PROFILE_SCHEMA_VERSION, active, items }
  } catch {
    return null
  }
}

/**
 * 落盘。
 *
 * 索引从参数进来而不是读模块级的 `index`：下面三个建索引的分支都是「先造好、
 * 再交给 ensure 赋值」，造好的那一刻 `index` 还是 null。传参也让每个写入口
 * 显式说出自己落的是哪一份，不必回头确认「这时候 index 是不是已经换过了」。
 */
function persistIndex(state: ProfileIndex): void {
  writeRaw(INDEX_KEY, JSON.stringify(state))
}

/** 按预设造一档；id 由调用方给（首次实例化用字面量，新增用 nanoid） */
function entryOf(id: string, preset: ProfilePreset, name?: string): ProfileEntry {
  return { id, name: sanitizeName(name, PRESET_LABEL[preset]), preset }
}

/**
 * 首次检测：只决定 active，只跑一次。
 *
 * 判据是算术而不是设备——项目里没有任何 UA 嗅探，也不该从这里开头。真正要问的
 * 不是「这是不是手机」，而是**电脑档在这块屏上还成不成立**（见 DETECT_MIN_EDGE）。
 *
 * 取**短边**让结果不随旋转改变：用 innerWidth 的话，横过来的手机（844）会判成
 * desktop，而换档要 reload——等于旋转屏幕会重载页面。
 *
 * 两个信号必须同时成立：把桌面窗口拉到 380px 宽仍然给 desktop（拉宽窗口就好了，
 * 而 TileGrid 已经有一句「窗口过小，建议放大窗口」在场）。
 *
 * **刻意不挂 change / resize 监听**：那会让旋转手机、拖动窗口自动切档，
 * 而每次切档都是一次整页 reload，用户正在改布局的中途被打断且无从得知原因。
 */
function detectPreset(): ProfilePreset {
  try {
    if (typeof window === 'undefined' || !window.matchMedia) return 'desktop'
    const coarse = window.matchMedia('(pointer: coarse)').matches
    if (!coarse) return 'desktop'
    const shortEdge = Math.min(window.innerWidth, window.innerHeight)
    return shortEdge > 0 && shortEdge < DETECT_MIN_EDGE ? 'mobile' : 'desktop'
  } catch {
    return 'desktop'
  }
}

/**
 * 认领老存档：把无后缀的 `:grid` / `:settings` 搬到 `@desktop`。
 *
 * 只搬原始字节、不解析内容——存档的形状是各 store 的知识，这里只管改键名。
 * 于是 `:settings@desktop` 里仍带着隐私三开关与自定义引擎那几个字段，
 * 由 stores/settings 的 load() 在 `:global` 缺席时从它们迁移（那边有一整套
 * 「新字段优先，缺了就从旧字段迁」的先例）。
 *
 * **不跑检测**：老用户此刻手里已经有一份自己摆好的布局，再猜一次只会得出
 * 「你这是电脑」——猜对了是空转，猜错了（他正好在手机上打开）就把布局挪进
 * 一个 3 列的档里。已有的数据本身就是最强的信号。
 *
 * 三个建索引的分支一律**返回**新索引（认不出就返回 null），由 ensure 赋给
 * 模块级的 `index`：赋值收在一处，类型上也就不再有「造完了但还是 null」这一态。
 */
function claimLegacy(): ProfileIndex | null {
  const legacy = PER_PROFILE_BASES.map((base) => ({ base, raw: readRaw(globalKey(base)) }))
  if (!legacy.some((item) => item.raw !== null)) return null

  for (const { base, raw } of legacy) {
    if (raw === null) continue
    writeRaw(keyForProfile(base, 'desktop'), raw)
    removeRaw(globalKey(base))
  }
  const state: ProfileIndex = {
    version: PROFILE_SCHEMA_VERSION,
    active: 'desktop',
    items: PRESET_ORDER.map((preset) => entryOf(preset, preset)),
  }
  persistIndex(state)
  return state
}

/**
 * 索引丢了但按档存档还在：从键名把它重建回来。
 *
 * 这一支不是设想出来的边界情况——`:profiles` 是唯一一份「读错就等于所有档都
 * 找不到」的存档，而 sanitizeIndex 一旦判定「这份我不认识」就会整份丢弃。
 * 不重建的话，用户的两档布局都还在磁盘上，页面却当成全新安装。
 *
 * 预设按 id 猜（只认那两个字面量），猜不出的一律 desktop：预设只影响
 * 「重置为默认」回到哪一档与首帧的行列数，猜错的代价远小于丢一整档。
 */
function recoverFromKeys(): ProfileIndex | null {
  const found = new Map<string, ProfilePreset>()
  for (const base of PER_PROFILE_BASES) {
    for (const { id } of scanProfileKeys(base)) {
      if (!found.has(id)) found.set(id, isProfilePreset(id) ? id : 'desktop')
    }
  }
  if (found.size === 0) return null

  const items = [...found].map(([id, preset]) => entryOf(id, preset))
  const state: ProfileIndex = {
    version: PROFILE_SCHEMA_VERSION,
    active: items.find((item) => item.id === 'desktop')?.id ?? items[0].id,
    items,
  }
  persistIndex(state)
  return state
}

/**
 * 全新安装：把**两档**都实例化出来，active 由检测决定。
 *
 * 实例化两档而不是只建检测中的那一档，多花的是索引里的一行（两条按档存档要等
 * 第一次进那档才写），换来切换列表从第一次打开就有两项，而不是「一项 + 一个加号」。
 * 这个功能的发现成本几乎全在这里。
 */
function seedFresh(): ProfileIndex {
  const state: ProfileIndex = {
    version: PROFILE_SCHEMA_VERSION,
    active: detectPreset(),
    items: PRESET_ORDER.map((preset) => entryOf(preset, preset)),
  }
  persistIndex(state)
  return state
}

/** 读索引；四种情况各走一支，之后内存里恒有一份合法索引 */
function ensure(): ProfileIndex {
  if (index) return index

  // 顺序要紧：先认领无后缀的老存档，它比按档键更旧
  index = sanitizeIndex(readRaw(INDEX_KEY)) ?? claimLegacy() ?? recoverFromKeys() ?? seedFresh()
  return index
}

/* ── 对外的读 ───────────────────────────────────────── */

export function activeProfileId(): string {
  return ensure().active
}

export function activeProfileEntry(): ProfileEntry {
  const state = ensure()
  return state.items.find((item) => item.id === state.active) ?? state.items[0]
}

export function activeProfilePreset(): ProfilePreset {
  return activeProfileEntry().preset
}

/** 当前档的预设几何：网格行列 + 区域四项，两者互解（见 types/profile） */
export function activePresetDef(): PresetDef {
  return PROFILE_PRESETS[activeProfilePreset()]
}

/** 档位列表的快照；调用方不得原地改它 */
export function listProfiles(): ProfileEntry[] {
  return ensure().items.map((item) => ({ ...item }))
}

/* ── 对外的写 ───────────────────────────────────────── */

/**
 * 换档。
 *
 * 只写索引，**不碰任何 store**——切档的完整语义是「以这个档打开一次页面」，
 * 由调用方紧接着 location.reload()。理由见 plan/10 §4：热切换要过七道门，
 * 其中三道是已经写在注释里的破坏性路径（settings.load 在 raw 为空时直接 return、
 * reset 的中间态会被 persist 写进新档、TileGrid 的 resize 早于新档 slots 读入）。
 */
export function setActiveProfile(id: string): boolean {
  const state = ensure()
  if (!state.items.some((item) => item.id === id)) return false
  if (state.active === id) return false
  state.active = id
  persistIndex(state)
  return true
}

/**
 * 新增一档，返回新 id。
 *
 * id 一律现取 nanoid，**永不复用 `desktop` / `mobile` 这两个字面量**：
 * 「删掉 desktop → 又从电脑预设新建一个」会捡回一份没清干净的旧存档。
 */
export function createProfile(preset: ProfilePreset, name?: string): string {
  const state = ensure()
  const entry = entryOf(nanoid(), preset, name)
  state.items = [...state.items, entry]
  persistIndex(state)
  return entry.id
}

/**
 * 复制当前档：索引里加一项，并把两份按档存档整体抄过去。
 *
 * 抄原始字节而不是「读出来再写回」：那会让副本的内容取决于当前内存状态是否
 * 已经落盘。壁纸字节不抄——IDB 里那份是全局共享的，两档引用同一个 id 即可
 * （这正是引用计数存在的理由，见 stores/settings 的 referencedImageIds）。
 */
export function duplicateActiveProfile(name?: string): string {
  const state = ensure()
  const from = activeProfileEntry()
  const id = nanoid()
  state.items = [...state.items, entryOf(id, from.preset, name ?? `${from.name} 副本`)]
  persistIndex(state)

  for (const base of PER_PROFILE_BASES) {
    const raw = readRaw(keyForProfile(base, from.id))
    if (raw !== null) writeRaw(keyForProfile(base, id), raw)
  }
  return id
}

export function renameProfile(id: string, name: string): boolean {
  const state = ensure()
  const entry = state.items.find((item) => item.id === id)
  if (!entry) return false
  const next = sanitizeName(name, PRESET_LABEL[entry.preset])
  if (next === entry.name) return false
  entry.name = next
  // 整体换一份数组：store 侧靠引用变化察觉，原地改属性它看不到
  state.items = [...state.items]
  persistIndex(state)
  return true
}

/**
 * 删一档：清它的按档存档与索引项。
 *
 * 两条拒绝在这里也拦一道（UI 侧同样把按钮禁掉并给出 title）：
 * 删当前档意味着「删除 + 隐式切档 + reload」三件事挤在一次点击里；
 * 删到零档则连一个可寻址的档都不剩。
 *
 * 壁纸字节不在这里删——那要看别的档是否还引用同一个 id，见
 * stores/settings 的 pruneOrphanImages，由调用方在这一步之后跑一次。
 */
export function removeProfile(id: string): boolean {
  const state = ensure()
  if (id === state.active) return false
  if (state.items.length <= 1) return false
  if (!state.items.some((item) => item.id === id)) return false

  state.items = state.items.filter((item) => item.id !== id)
  persistIndex(state)
  for (const base of PER_PROFILE_BASES) removeRaw(keyForProfile(base, id))
  return true
}

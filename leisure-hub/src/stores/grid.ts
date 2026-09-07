import { defineStore } from 'pinia'
import { nanoid } from 'nanoid'
import { computed, ref, watch } from 'vue'

import {
  GRID_SCHEMA_VERSION,
  defaultGridCols,
  defaultGridRows,
  setGridCols,
  tileSpan,
  tileSpanForOverflow,
  type GridState,
  type RecycleReason,
  type Tile,
  type TileDraft,
} from '@/types/tile'
import { buildDefaultGrid } from '@/data/defaults'
import { isHexColor } from '@/utils/color'
import { activeProfilePreset, keyFor } from '@/utils/profileKey'
import { sanitizeWidgetProps } from '@/types/widgetProps'

/**
 * 存档键按档带后缀（`leisure-hub:grid@<id>`）。
 *
 * 现取而不是模块级常量：模块求值可能早于配置档索引被读，那一刻拼出来的键会
 * 指向错误的档。keyFor 内部保证索引已就绪，代价是一次字符串拼接。
 */
function storageKey(): string {
  return keyFor('grid')
}

function emptySlots(count: number): (Tile | null)[] {
  return Array.from({ length: count }, () => null)
}

/**
 * 区域是否可容纳。
 *
 * 写成接受数组的纯函数，因为 resize 要在尚未提交的临时数组上做同样的判断，
 * 否则「当前 slots」与「新数组」两套逻辑必然分叉。
 * ignoreAnchor 用于「移动 / 改尺寸时不与自己冲突」。
 */
function areaFree(
  arr: (Tile | null)[],
  cols: number,
  rows: number,
  anchor: number,
  w: number,
  h: number,
  ignoreAnchor?: number,
): boolean {
  const col = anchor % cols
  const row = Math.floor(anchor / cols)
  if (col + w > cols || row + h > rows) return false

  for (let i = 0; i < arr.length; i++) {
    const tile = arr[i]
    if (!tile || i === ignoreAnchor) continue
    const s = tileSpan(tile)
    const c = i % cols
    const r = Math.floor(i / cols)
    // 两个矩形不相交即可
    if (c + s.w <= col || col + w <= c) continue
    if (r + s.h <= row || row + h <= r) continue
    return false
  }
  return true
}

/**
 * 区域内的占用者锚点，按槽位下标升序。
 *
 * 与 store 里的 occupantsIn 同义，但接受数组而不是读 coverage 计算属性：
 * 连锁推挤会一步一步改写 slots，每一步都必须看到上一步的结果，
 * 让派生计算属性在同一个同步过程里反复重算整张覆盖表并不划算。
 */
function occupantsOf(
  arr: (Tile | null)[],
  cols: number,
  anchor: number,
  w: number,
  h: number,
): number[] {
  const col = anchor % cols
  const row = Math.floor(anchor / cols)
  const found: number[] = []
  for (let i = 0; i < arr.length; i++) {
    const tile = arr[i]
    if (!tile) continue
    const s = tileSpan(tile)
    const c = i % cols
    const r = Math.floor(i / cols)
    // 与 areaFree 同一套相交判定
    if (c + s.w <= col || col + w <= c) continue
    if (r + s.h <= row || row + h <= r) continue
    found.push(i)
  }
  return found
}

/**
 * 连锁推挤的递归深度上限。
 *
 * 一次推挤最多搬动网格里的每个方块一次，取一个宽松于任何合理网格的常数即可，
 * 只为挡住万一出现的环形依赖，不参与正常逻辑。
 */
const PUSH_DEPTH_LIMIT = 64

/**
 * 把 w×h 的空间推入 (col,row)，挡路的方块依次让位：先试右边，再试下方。
 *
 * 直接改写传入数组，成功时该区域已腾空（但未写入新方块，由调用方写）。
 * 失败时数组可能已被部分改写，所以调用方必须在副本上试算、成功后才提交。
 *
 * 「右优先、下兜底」这个顺序就是交互上要的效果：被顶开的方块沿着推挤方向
 * 往同一行的后面挪，一行放不下才换行，视觉上像文字重排而不是随机跳位。
 */
function pushInto(
  arr: (Tile | null)[],
  cols: number,
  rows: number,
  col: number,
  row: number,
  w: number,
  h: number,
  depth = 0,
): boolean {
  if (col < 0 || row < 0 || col + w > cols || row + h > rows) return false
  if (depth > PUSH_DEPTH_LIMIT) return false

  const anchor = row * cols + col
  for (const index of occupantsOf(arr, cols, anchor, w, h)) {
    const tile = arr[index]
    if (!tile) continue
    const s = tileSpan(tile)
    const oc = index % cols
    const or = Math.floor(index / cols)

    // 先摘下再递归：留在原处它会被算成挡自己路的占用者，直接死循环
    arr[index] = null
    // 右：保持自己的行，左边缘贴到推入区域的右侧
    if (pushInto(arr, cols, rows, col + w, or, s.w, s.h, depth + 1)) {
      arr[or * cols + col + w] = tile
      continue
    }
    // 下：保持自己的列，上边缘贴到推入区域的下方
    if (pushInto(arr, cols, rows, oc, row + h, s.w, s.h, depth + 1)) {
      arr[(row + h) * cols + oc] = tile
      continue
    }
    arr[index] = tile
    return false
  }
  return true
}

/**
 * 校验并夹紧单个方块，挡住 localStorage 里被改过的脏数据。
 *
 * keepSpan 供 overflow 暂存区用：那些方块正因为「当前网格放不下」才被摘出来，
 * 宽度是按**当时的**列数写的，可能大于现在的列数——按当前列数夹会把一条合法
 * 的暂存悄悄改小，网格重新变宽后也回不来了。暂存里的占格不参与渲染与落位
 * 计算（所有读取都走 tileSpan 现夹），原样保留是安全的；脏数据最多在暂存里
 * 多躺几轮，真要落位时仍会被 resolvePlacement 夹住。
 */
function sanitizeTile(value: unknown, keepSpan = false): Tile | null {
  if (!value || typeof value !== 'object') return null
  const tile = value as Tile
  if (tile.kind !== 'link' && tile.kind !== 'widget') return null
  if (typeof tile.name !== 'string') return null
  /*
   * widgetId 缺失就无从渲染，直接丢弃这一格。
   *
   * 只校验类型不校验是否在注册表里：id 未知时 TileWidget 会画出占位，
   * 这样「组件暂时改名 / 下个版本才加回来」不会静默吃掉用户放好的方块。
   */
  if (tile.kind === 'widget' && typeof tile.widgetId !== 'string') return null

  /*
   * 占格走 tileSpan 而不是两次裸 clampSpan。
   *
   * 它会按 kind / widgetId 查这一种方块自己的上下限——搜索方块的宽下限是 2，
   * 而存档里可能是 1（手改过，或来自「搜索还是 1..4」的旧版本）。
   * 两次裸 clampSpan 只认全局的 1..SPAN_MAX，那个 1 会被原样留下。
   */
  const next = { ...tile } as Tile
  if (!keepSpan) {
    const span = tileSpan(tile)
    next.spanW = span.w
    next.spanH = span.h
  } else {
    const span = tileSpanForOverflow(tile)
    next.spanW = span.w
    next.spanH = span.h
  }
  // 底色会直接进 background，非法值一律丢弃而不是照原样渲染
  if (next.kind === 'link' && next.bgColor !== undefined && !isHexColor(next.bgColor)) {
    delete next.bgColor
  }
  /*
   * 组件配置同理，而且它整个是个自由对象：逐键过白名单与颜色校验，
   * 一个都不剩时连键本身删掉，让「未配置」始终是 undefined 这一种表示。
   */
  if (next.kind === 'widget') {
    const cleaned = sanitizeWidgetProps(next.widgetId, next.props)
    if (cleaned) next.props = cleaned
    else delete next.props
  }
  if (keepSpan) {
    // 旧版 overflow 没有原因字段，默认就是网格空间不足。
    next.recycleReason = next.recycleReason === 'deleted' ? 'deleted' : 'capacity'
    if (!Number.isInteger(next.recycleOrigin) || (next.recycleOrigin as number) < 0) {
      delete next.recycleOrigin
    }
  } else {
    // 回收站元数据不应随着脏存档进入可见网格。
    delete next.recycleReason
    delete next.recycleOrigin
  }
  return next
}

function withRecycleMeta(tile: Tile, reason: RecycleReason, origin?: number): Tile {
  const next = { ...tile }
  next.recycleReason = reason
  if (Number.isInteger(origin) && (origin as number) >= 0) next.recycleOrigin = origin
  else delete next.recycleOrigin
  return next
}

function withoutRecycleMeta(tile: Tile): Tile {
  const next = { ...tile }
  delete next.recycleReason
  delete next.recycleOrigin
  return next
}

export const useGridStore = defineStore('grid', () => {
  const cols = ref(defaultGridCols())
  const rows = ref(defaultGridRows())
  const slots = ref<(Tile | null)[]>(emptySlots(cols.value * rows.value))
  /**
   * 网格缩小时挤出来的方块。
   * 暂存而不丢弃，窗口重新变大后 resize 会按顺序放回空位。
   */
  const overflow = ref<Tile[]>([])

  /**
   * 装入默认布局（见 data/defaults.ts）。
   *
   * 首次打开与「重置为默认」共用这一处，也是**读盘失败时的落点**——空网格曾经是
   * 那个落点，但「默认」现在有了内容，两条路各给一种结果就等于同一个概念有两个答案。
   *
   * 布局按**当前配置档自己的预设**取：手机档回到 3 列的那张表，不是回到电脑档
   * （这正是索引里持久化 preset 的原因，见 types/profile 的 ProfileEntry）。
   *
   * 先 setGridCols 再赋值，与 load / resize 同一条顺序纪律：所有 tileSpan 读取
   * （搜索方块的宽度上限跟随列数）都必须看到新的列数。
   */
  function seedDefaults() {
    const seed = buildDefaultGrid(activeProfilePreset())
    setGridCols(seed.cols)
    cols.value = seed.cols
    rows.value = seed.rows
    slots.value = seed.slots
    overflow.value = []
  }

  /**
   * 读取持久化数据；版本或长度不匹配一律回退默认布局，避免脏数据白屏。
   *
   * 「回退」不再是空网格而是 seedDefaults()：见它的注释。存档存在但非法与
   * 从未存过档，对用户是同一件事——他看到的都该是这个项目的默认桌面。
   */
  function load() {
    try {
      const raw = localStorage.getItem(storageKey())
      if (!raw) return seedDefaults()

      const parsed = JSON.parse(raw) as GridState
      if (parsed?.version !== GRID_SCHEMA_VERSION) return seedDefaults()
      if (!Number.isInteger(parsed.cols) || !Number.isInteger(parsed.rows)) return seedDefaults()
      if (!Array.isArray(parsed.slots)) return seedDefaults()
      if (parsed.slots.length !== parsed.cols * parsed.rows) return seedDefaults()

      cols.value = parsed.cols
      // 先同步再夹取：sanitizeTile → tileSpan 要按这一份列数算搜索的宽度上限
      setGridCols(parsed.cols)
      rows.value = parsed.rows
      // 箭头包一层：map 会把元素下标当第二个参数塞进来，正好撞上 keepSpan
      slots.value = parsed.slots.map((tile) => sanitizeTile(tile))
      overflow.value = Array.isArray(parsed.overflow)
        ? parsed.overflow.map((tile) => sanitizeTile(tile, true)).filter((tile): tile is Tile => tile !== null)
        : []
    } catch {
      // 非法 JSON：同样落到默认布局
      seedDefaults()
    }
  }

  function persist() {
    const payload: GridState = {
      version: GRID_SCHEMA_VERSION,
      cols: cols.value,
      rows: rows.value,
      slots: slots.value,
      overflow: overflow.value,
    }
    try {
      localStorage.setItem(storageKey(), JSON.stringify(payload))
    } catch {
      // 存储不可用（隐私模式 / 配额）时静默降级为内存状态
    }
  }

  function inRange(index: number) {
    return Number.isInteger(index) && index >= 0 && index < slots.value.length
  }

  /**
   * 每个槽位被哪个锚点占用；null 表示真空位，锚点自身指向自己。
   *
   * 大方块只存在于锚点槽位，被覆盖的槽位在 slots 里仍是 null，
   * 归属关系由这张派生表表达——持久化结构与「index 即位置」的不变量因此完全不变。
   */
  const coverage = computed<(number | null)[]>(() => {
    const map: (number | null)[] = Array.from({ length: slots.value.length }, () => null)
    slots.value.forEach((tile, index) => {
      if (!tile) return
      const { w, h } = tileSpan(tile)
      const col = index % cols.value
      const row = Math.floor(index / cols.value)
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          const target = (row + r) * cols.value + col + c
          if (target < map.length) map[target] = index
        }
      }
    })
    return map
  })

  /**
   * 把「期望落在 index、尺寸 w×h」夹成界内的合法落位。
   *
   * 先把 span 夹进网格尺寸，再把锚点往左上推回来，
   * 这样拖一个 2×2 到最后一列也能落下，而不是被判为非法。
   *
   * 这里只夹「网格装不装得下」，**不再夹 SPAN_MAX**：入参一律来自 tileSpan，
   * 已按那一种方块自己的上下限夹过了。再套一次全局的 1..4 会把搜索方块
   * 4 格以上的宽度悄悄压回 4——用户在编辑框里选了更宽的档，保存后变成 4，
   * 且没有任何提示。
   */
  function resolvePlacement(index: number, w: number, h: number) {
    const sw = Math.min(Math.max(1, Math.trunc(w) || 1), cols.value)
    const sh = Math.min(Math.max(1, Math.trunc(h) || 1), rows.value)
    const col = Math.min(index % cols.value, cols.value - sw)
    const row = Math.min(Math.floor(index / cols.value), rows.value - sh)
    return { anchor: row * cols.value + col, col, row, w: sw, h: sh }
  }

  /** 该区域内的占用者锚点（去重），不含 ignoreAnchor */
  function occupantsIn(anchor: number, w: number, h: number, ignoreAnchor?: number): number[] {
    const col = anchor % cols.value
    const row = Math.floor(anchor / cols.value)
    const found = new Set<number>()
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const owner = coverage.value[(row + r) * cols.value + col + c]
        if (owner !== null && owner !== undefined && owner !== ignoreAnchor) found.add(owner)
      }
    }
    return [...found]
  }

  /** 从头找第一个能整块放下 w×h 的锚点；找不到返回 -1 */
  function findFreeAnchor(w: number, h: number): number {
    if (w > cols.value || h > rows.value) return -1
    for (let row = 0; row + h <= rows.value; row++) {
      for (let col = 0; col + w <= cols.value; col++) {
        const anchor = row * cols.value + col
        if (areaFree(slots.value, cols.value, rows.value, anchor, w, h)) return anchor
      }
    }
    return -1
  }

  /**
   * 摘下这些锚点上的方块并返回。
   *
   * 与「重新安置」拆成两步，因为顺序至关重要：必须先把目标区域腾空并写入新方块，
   * 再给被摘下的方块找位置——否则 findFreeAnchor 会把它们放进那块尚未写入的空白区域，
   * 造成两个方块重叠。
   */
  function lift(anchors: number[]): Tile[] {
    const taken: Tile[] = []
    for (const anchor of anchors) {
      const tile = slots.value[anchor]
      if (!tile) continue
      taken.push(tile)
      slots.value[anchor] = null
    }
    return taken
  }

  /** 给被摘下的方块重新找位置；网格真的满了才进 overflow 暂存，不丢数据 */
  function reflow(tiles: Tile[]) {
    for (const tile of tiles) {
      const { w, h } = tileSpan(tile)
      const spot = findFreeAnchor(w, h)
      if (spot >= 0) slots.value[spot] = tile
      else overflow.value.push(withRecycleMeta(tile, 'capacity'))
    }
  }

  /**
   * 写入前把草稿过一遍同一套校验。
   *
   * 读盘时已经校验过一次，这里是写入侧的第二道：组件配置是自由对象，
   * 表单之外还可能有别的写入路径（推荐项、将来的导入功能），
   * 让所有入口共用一处规则，而不是各自记得校验。
   */
  function cleanDraft(draft: TileDraft): TileDraft {
    if (draft.kind !== 'widget') return draft
    const cleaned = sanitizeWidgetProps(draft.widgetId, draft.props)
    const next = { ...draft }
    if (cleaned) next.props = cleaned
    else delete next.props
    return next
  }

  /** 写入指定槽位，自动补 id；返回实际落位的锚点，-1 表示失败 */
  function setTile(index: number, draft: TileDraft): number {
    if (!inRange(index)) return -1
    const requested = tileSpanForOverflow(draft)
    if (requested.w > cols.value || requested.h > rows.value) {
      const tile = {
        ...cleanDraft(draft),
        spanW: requested.w,
        spanH: requested.h,
        id: nanoid(),
      } as Tile
      overflow.value.push(withRecycleMeta(tile, 'capacity'))
      return -1
    }
    const span = tileSpan(draft)
    const { anchor, w, h } = resolvePlacement(index, span.w, span.h)
    const evicted = lift(occupantsIn(anchor, w, h))
    slots.value[anchor] = { ...cleanDraft(draft), spanW: w, spanH: h, id: nanoid() } as Tile
    reflow(evicted)
    return anchor
  }

  /** 原地更新，保留 id——拖拽与列表 key 都依赖它稳定；返回实际锚点 */
  function updateTile(index: number, draft: TileDraft): number {
    if (!inRange(index)) return -1
    const current = slots.value[index]
    if (!current) return -1

    const requested = tileSpanForOverflow(draft)
    if (requested.w > cols.value || requested.h > rows.value) return -1
    const span = tileSpan(draft)
    const { anchor, w, h } = resolvePlacement(index, span.w, span.h)
    const evicted = lift(occupantsIn(anchor, w, h, index))
    // 摘掉自己：尺寸变大时锚点可能被夹到别处，留着旧位置就成了幽灵方块
    slots.value[index] = null
    slots.value[anchor] = { ...cleanDraft(draft), spanW: w, spanH: h, id: current.id } as Tile
    reflow(evicted)
    return anchor
  }

  function clearTile(index: number) {
    if (!inRange(index)) return
    slots.value[index] = null
  }

  /** 主动删除：先移入回收站，撤销与设置里的恢复都复用同一条数据。 */
  function moveTileToRecycle(index: number): string | null {
    if (!inRange(index)) return null
    const tile = slots.value[index]
    if (!tile) return null
    const entry = withRecycleMeta(tile, 'deleted', index)
    slots.value[index] = null
    overflow.value.push(entry)
    return entry.id
  }

  /**
   * 撤销删除：把带原 id 的方块放回原槽位。
   *
   * 判空不能只看 slots[index]——该格可能被邻格的大方块覆盖着，
   * 必须整个 w×h 区域都空才写回。
   */
  function restoreTile(index: number, tile: Tile) {
    if (!inRange(index)) return false
    const { w, h } = tileSpan(tile)
    if (!areaFree(slots.value, cols.value, rows.value, index, w, h)) return false
    slots.value[index] = tile
    return true
  }

  /**
   * 从回收站恢复一个方块。
   *
   * 只在当前网格找到能完整容纳它的空位时才移动；网格空间不足或被切碎时
   * 保留在回收站里，让调用方可以给出明确提示，而不是静默丢弃。
   */
  function restoreOverflowTile(id: string, preferredIndex?: number): boolean {
    const index = overflow.value.findIndex((tile) => tile.id === id)
    if (index < 0) return false
    const tile = overflow.value[index]
    const { w, h } = tileSpanForOverflow(tile)
    const preferred = typeof preferredIndex === 'number' && Number.isInteger(preferredIndex) ? preferredIndex : -1
    const anchor =
      preferred >= 0 && areaFree(slots.value, cols.value, rows.value, preferred, w, h)
        ? preferred
        : findFreeAnchor(w, h)
    if (anchor < 0) return false

    overflow.value = overflow.value.filter((_, i) => i !== index)
    slots.value[anchor] = withoutRecycleMeta(tile)
    return true
  }

  /** 永久删除回收站中的方块，不进入撤销队列。 */
  function removeOverflowTile(id: string): boolean {
    const next = overflow.value.filter((tile) => tile.id !== id)
    if (next.length === overflow.value.length) return false
    overflow.value = next
    return true
  }

  /**
   * 移动。
   *
   * 目标区域空就直接落位；有占用者则把它们朝右推开，右边放不下才往下方推，
   * 被推到的方块若又挡住别人就继续同样地推下去（连锁）。
   *
   * 不再做「同尺寸互换」：互换会把占用者搬到网格另一头，与推挤这条规则冲突，
   * 同一个操作出现两种截然不同的结果反而更难预期。
   *
   * 推挤在 slots 的副本上试算，只有整条连锁都成功才提交；
   * 中途失败时退回旧的「挤走 + reflow 补位」，保证任何拖拽都有确定结果、不丢方块。
   */
  function moveTile(from: number, to: number) {
    if (!inRange(from) || !inRange(to)) return
    const tile = slots.value[from]
    if (!tile) return

    const span = tileSpan(tile)
    const { anchor, col, row, w, h } = resolvePlacement(to, span.w, span.h)
    if (anchor === from) return

    // 先把自己从副本里摘掉：否则源方块会被算成挡路者，把自己往右推一格
    const draft = slots.value.slice()
    draft[from] = null
    if (pushInto(draft, cols.value, rows.value, col, row, w, h)) {
      draft[anchor] = tile
      slots.value = draft
      return
    }

    // 推不动（右侧与下方都满）：退回挤走 + 补位，先落位拖动者再给被挤走的找地方，
    // 反过来它们会占进这块还没写入的空白区
    const others = occupantsIn(anchor, w, h, from)
    slots.value[from] = null
    const evicted = lift(others)
    slots.value[anchor] = tile
    reflow(evicted)
  }

  /**
   * 按新的行列数重排网格。
   *
   * 方块尽量留在原来的行列坐标上（整块仍在界内且不与已保位者冲突）；
   * 落到新范围外的按原顺序补进能放下的位置，仍放不下的进 overflow 暂存。
   */
  function resize(nextCols: number, nextRows: number) {
    if (!Number.isInteger(nextCols) || !Number.isInteger(nextRows)) return
    if (nextCols < 1 || nextRows < 1) return
    if (nextCols === cols.value && nextRows === rows.value) return

    const next = emptySlots(nextCols * nextRows)
    /** 保留原有相对顺序，作为补位与暂存的排队依据 */
    const displaced: Tile[] = []

    slots.value.forEach((tile, index) => {
      if (!tile) return
      const { w, h } = tileSpan(tile)
      const r = Math.floor(index / cols.value)
      const c = index % cols.value
      const anchor = r * nextCols + c
      if (areaFree(next, nextCols, nextRows, anchor, w, h)) next[anchor] = tile
      else displaced.push(tile)
    })

    // 主动删除的条目不会因为网格变大而自动回桌面，只能由用户明确恢复。
    const deleted = overflow.value.filter((tile) => tile.recycleReason === 'deleted')
    const capacityOverflow = overflow.value.filter((tile) => tile.recycleReason !== 'deleted')

    // 先安置被挤出的，再取回历史暂存，避免旧数据插队到当前可见内容之前
    const queue = [
      ...displaced.map((tile) => ({ tile, preserveSpan: false })),
      ...capacityOverflow.map((tile) => ({ tile, preserveSpan: true })),
    ]
    const rest: Tile[] = [...deleted]
    for (const item of queue) {
      const { tile } = item
      const { w, h } = item.preserveSpan ? tileSpanForOverflow(tile) : tileSpan(tile)
      let placed = false
      for (let row = 0; row + h <= nextRows && !placed; row++) {
        for (let col = 0; col + w <= nextCols && !placed; col++) {
          const anchor = row * nextCols + col
          if (!areaFree(next, nextCols, nextRows, anchor, w, h)) continue
          next[anchor] = withoutRecycleMeta(tile)
          placed = true
        }
      }
      if (!placed) rest.push(tile)
    }

    // 先同步再提交：提交后的所有 tileSpan 读取都按新列数算搜索的宽度上限
    setGridCols(nextCols)
    cols.value = nextCols
    rows.value = nextRows
    slots.value = next
    overflow.value = rest
  }

  load()
  watch([cols, rows, slots, overflow], persist, { deep: true })

  return {
    cols,
    rows,
    slots,
    overflow,
    coverage,
    resolvePlacement,
    setTile,
    updateTile,
    clearTile,
    moveTileToRecycle,
    restoreTile,
    restoreOverflowTile,
    removeOverflowTile,
    moveTile,
    resize,
    /**
     * 重置为默认布局。
     *
     * 就是 seedDefaults 本身，只换一个对外的名字：store 内部「读盘失败的落点」
     * 与设置里「重置为默认」要的是同一个结果，两处若各写一份，改默认布局时
     * 必然漏改一处。不在这里 persist——watch 会自动落盘。
     */
    reset: seedDefaults,
    load,
    persist,
  }
})

import { computed, ref } from 'vue'

import {
  MAX_ITEMS,
  normalizeGroup,
  normalizeText,
  sanitizeTodos,
  type TodoItem,
} from '@/types/todo'
import { buildDefaultTodos } from '@/data/defaults'
import { nanoid } from 'nanoid'

const STORAGE_KEY = 'starfall-hub:todos'

/**
 * 待办清单。
 *
 * **模块级共享 + 独立 storage key**，走的是 useSearchHistory 那条路而不是搜索引擎
 * 那条（存在 WidgetTile.props 里、每个方块各一份）。三条理由，最后一条单独就足够：
 *
 * - `sanitizeWidgetProps` 是逐键校验器，一个 check 收一个值。让它收 `TodoItem[]`
 *   就得在 WidgetFieldCheck 里写一遍遍历 + 逐项校验 + 截断——那已经是下面 load()
 *   的全部工作，只是塞进了一个本意是「验一个 hex 色」的钩子里。
 * - props 的写入路径是 `emit('update-props') → TileGrid.onWidgetProps →
 *   grid.updateTile`，而 updateTile 是**整块替换**（还会重新 place 一次算推挤）。
 *   每勾一个待办都要为一个布尔翻转付一次网格重排。
 * - grid.ts 的存档里方块可以进 overflow 暂存区、可以被删，方块删掉时 props 一起没了。
 *   **搜索引擎跟着方块消失是对的，用户手打的十几条待办跟着方块消失是数据损失。**
 *
 * 共享的代价是「桌面上放两个待办方块，内容一模一样」。这不是缺陷：两个方块可以是
 * 不同尺寸不同版式——一格 1×1 只报未完成数当计数器，一格 3×4 展开完整清单，
 * 看的是同一份数据的不同切面，跟同一个日历放两次一样自然。真要分组走 TodoItem.group。
 *
 * 全程不发一次网络请求，这是它相对天气 / 搜索的卖点，也是注册表 desc 里
 * 「数据只存在本机」那句承诺。
 */
const items = ref<TodoItem[]>(load())

/**
 * 上一次写盘失败了。
 *
 * 比 useSearchHistory 多出来的一件事。那边 persist 失败只 try/catch 吞掉，理由是
 * 搜索记录没人会注意也没人在意；待办写失败意味着「我打进去的东西下次打开就没了」，
 * **必须说出来**。做成模块级 ref 而不是抛异常：抛出去会让一次正常的勾选看起来失败了，
 * 而内存里的数据其实是好的，用户这一刻仍然可以继续用。
 *
 * 由渲染层（TodoWidget）观察它并弹一条浮条，用完调 clearPersistError() 收掉。
 */
const persistError = ref(false)

/**
 * 读存档。
 *
 * **没有存档键**时装入默认清单（见 data/defaults.ts），而键存在但解析出空数组时
 * 保持空——两者必须分开：后者是用户把示例那条删掉了，再塞回去等于删不掉。
 * 判据只能是 `raw === null`，不能看 sanitizeTodos 的结果长度。
 *
 * 首次装入默认清单后**不写盘**（persist 只在增删改时跑），所以「一次都没碰过待办」
 * 的用户每次打开都重新生成一遍——内容一样，只有 id 与 createdAt 是新的，
 * 而这两项都只用于排序与 v-for key，没有可观察差异。
 */
function load(): TodoItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return buildDefaultTodos()
    return sanitizeTodos(JSON.parse(raw))
  } catch {
    /*
     * 整份存档不是 JSON（被手改成别的东西）时给空清单而不是抛错。
     * 逐项容错在 sanitizeTodos 里，这一层只兜「连 parse 都过不去」。
     *
     * 这里刻意**不**装默认清单：存档键存在说明用户用过待办，
     * 拿一条示例去覆盖一份读不出来的数据，会让「原来那些去哪了」更难回答。
     */
    return []
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.value))
    persistError.value = false
  } catch {
    // 配额满或无痕模式。内存里的清单仍可用，但用户必须知道它不会留到下次
    persistError.value = true
  }
}

/** 新增的三种结果。'full' 与 'empty' 各要一句不同的提示，所以不能只回布尔 */
export type AddResult = 'ok' | 'empty' | 'full'

/** 一条被删掉的待办连它原来的下标；撤销要还原到原位，不是 push 到末尾 */
export interface TodoEntry {
  index: number
  item: TodoItem
}

/** 一个分组的展示单元 */
export interface TodoGroup {
  /** 组名；未分组为空串。v-for 的 key */
  key: string
  /** 标题文案，未分组写「其他」 */
  label: string
  items: TodoItem[]
}

export function useTodos() {
  /**
   * 未完成，按 createdAt 倒序（新的在上）。
   *
   * 用 slice() 再排：sort 原地改数组，直接排 items.value 会在一个 computed 里
   * 写它自己的依赖，触发无穷更新。
   */
  const active = computed(() =>
    items.value.filter((item) => !item.done).sort((a, b) => b.createdAt - a.createdAt),
  )

  /**
   * 已完成，按 doneAt 倒序。
   *
   * 刚勾掉的浮到最上：用户能立刻看见自己干了什么，手滑勾错也就地能撤。
   * doneAt 缺失的（存档被改过、或某个未来的写入路径漏了）退回 createdAt，
   * 不让它们塌到一起。
   */
  const completed = computed(() =>
    items.value
      .filter((item) => item.done)
      .sort((a, b) => (b.doneAt ?? b.createdAt) - (a.doneAt ?? a.createdAt)),
  )

  const activeCount = computed(() => active.value.length)
  const completedCount = computed(() => completed.value.length)

  /** 「最近一条」= 最近**新建**的未完成项，即 active 的头一条（latest 档要它） */
  const latest = computed<TodoItem | undefined>(() => active.value[0])

  /**
   * 分组视图，只有 grouped 档消费。
   *
   * **没有独立的分组注册表**：一个组存在，是因为有条目引用它；最后一条被删或改组，
   * 这个组自动消失。于是「空组要不要显示」「删组时里面的条目去哪」这两个问题不存在。
   *
   * 组序按「组内最早的 createdAt」——组是按它第一次出现的时间排的，不会因为往老组里
   * 加了一条新待办就整组跳到最前。未分组一律排最后：它是「还没归类」的兜底，
   * 不该插在真正的组中间。
   *
   * 只含未完成项：已完成的一律归到折叠区（见 CompletedSection），不在各组里重复出现。
   */
  const groups = computed<TodoGroup[]>(() => {
    const bucket = new Map<string, TodoItem[]>()
    for (const item of active.value) {
      const key = item.group ?? ''
      const list = bucket.get(key)
      if (list) list.push(item)
      else bucket.set(key, [item])
    }

    const out: TodoGroup[] = []
    for (const [key, list] of bucket) {
      out.push({ key, label: key || '其他', items: list })
    }

    return out.sort((a, b) => {
      // 未分组恒在末尾，与另一个未分组不可能同时存在，所以不必再比时间
      if (a.key === '') return 1
      if (b.key === '') return -1
      return earliest(a.items) - earliest(b.items)
    })
  })

  /** 组内最早的创建时刻。active 是按 createdAt 倒序的，最早那条在末尾 */
  function earliest(list: TodoItem[]): number {
    return list[list.length - 1]?.createdAt ?? 0
  }

  /**
   * 新建一条。
   *
   * 上限处**拒绝并提示**，不挤掉最旧的：待办是手打的，静默丢弃用户刚打的字
   * 是比报错更坏的结果（与 useSearchHistory.push 的「挤掉旧的」刻意相反，
   * 那边的数据可再生）。
   *
   * 不去重。同名两条待办是完全合理的（「打电话」可以有两通），
   * 而搜索记录去重是因为搜同一个词两次没有意义。
   *
   * 新条目 unshift 到数组头部：items 的数组顺序是「插入顺序的倒序」，与 active
   * 的排序一致，撤销时按下标插回才落在原来看到的位置上。
   */
  function add(text: string, group?: string): AddResult {
    const clean = normalizeText(text)
    if (!clean) return 'empty'
    if (items.value.length >= MAX_ITEMS) return 'full'

    const item: TodoItem = {
      id: nanoid(),
      text: clean,
      done: false,
      createdAt: Date.now(),
    }
    // 归一化后为空的组名让这个键整个消失，而不是留一个空串（见 TodoItem.group）
    const cleanGroup = group === undefined ? undefined : normalizeGroup(group)
    if (cleanGroup !== undefined) item.group = cleanGroup

    items.value = [item, ...items.value]
    persist()
    return 'ok'
  }

  /**
   * 勾选 / 取消勾选。
   *
   * **不需要撤销**：它是可逆的，再点一下就回来了，条目还在原地。这也是 doneAt 让
   * 已完成区按完成时间倒序的用处——刚勾错的那条就在折叠区最上面。
   *
   * 取消勾选时删掉 doneAt 而不是留着：那个时间戳此刻不再成立，留着会让已完成区
   * 的排序读到一个属于未完成项的值（与 sanitizeTodos 里同一条规矩）。
   */
  function toggle(id: string) {
    let hit = false
    items.value = items.value.map((item) => {
      if (item.id !== id) return item
      hit = true
      if (item.done) {
        const { doneAt: _drop, ...rest } = item
        return { ...rest, done: false }
      }
      return { ...item, done: true, doneAt: Date.now() }
    })
    if (hit) persist()
  }

  /**
   * 删一条，返回它连原下标，供调用方接 UndoToast。
   *
   * 与 RecentSearches 的「删一条不确认」刻意不同：搜索记录可再生（再搜一次就有了），
   * 一条手打的「周五前把报销交了」删掉就没了，它和删掉一个方块同级——而删方块
   * 走的正是 UndoToast。
   *
   * 找不到时返回 null（同一条被两个方块同时删）：调用方据此不弹浮条。
   */
  function remove(id: string): TodoEntry | null {
    const index = items.value.findIndex((item) => item.id === id)
    if (index < 0) return null
    const item = items.value[index]
    items.value = items.value.filter((_, i) => i !== index)
    persist()
    return { index, item }
  }

  /**
   * 清空已完成，返回被删的全部条目连各自原下标。
   *
   * 它一次删掉一批不可再生的数据，所以同样要能撤销。
   */
  function clearCompleted(): TodoEntry[] {
    const removed: TodoEntry[] = []
    const kept: TodoItem[] = []
    items.value.forEach((item, index) => {
      if (item.done) removed.push({ index, item })
      else kept.push(item)
    })
    if (removed.length === 0) return []
    items.value = kept
    persist()
    return removed
  }

  /**
   * 按原下标插回。
   *
   * 收一个数组而不是 plan 里那个 `restore(item, index)`：clearCompleted 要还原一批，
   * 而「逐条调用单条版」在多条时下标会互相错位（插回第一条后，第二条记的下标已经
   * 偏了一位）。批量版从小到大依次 splice 就自然正确，单条只是长度为 1 的特例——
   * 与其写两个函数再要求调用方记住哪个能批量，不如只留这一个。
   *
   * 下标越界（期间别的方块删了几条）时夹到末尾：撤销的语义是「把它拿回来」，
   * 位置不精确远好过整条丢失。
   */
  function restore(entries: TodoEntry[]) {
    if (entries.length === 0) return
    const next = [...items.value]
    for (const { index, item } of [...entries].sort((a, b) => a.index - b.index)) {
      // 同 id 已经在场（用户手动又建了一条同源的）就跳过，不制造重复 key
      if (next.some((exist) => exist.id === item.id)) continue
      next.splice(Math.min(index, next.length), 0, item)
    }
    items.value = next.slice(0, MAX_ITEMS)
    persist()
  }

  /** 浮条被收掉后清标记，否则下一次任何写入都会重新弹出同一条提示 */
  function clearPersistError() {
    persistError.value = false
  }

  return {
    /** 全量，只读；改动一律走下面的方法，「每次变更后 persist」因此只有一处调用点 */
    items,
    active,
    completed,
    activeCount,
    completedCount,
    latest,
    groups,
    persistError,
    add,
    toggle,
    remove,
    clearCompleted,
    restore,
    clearPersistError,
  }
}

/**
 * 重置成默认清单，供设置里的「重置为默认」调用。
 *
 * 放在 useTodos **之外**：调用方是 SettingsDrawer 的一个事件处理函数，
 * 而 useTodos 返回的是一整套 computed（active / groups / …）。为了一次写入
 * 去建那一套派生是白付的——items 与 persist 本就是模块级的，直接用。
 *
 * 与 add / remove 一样立刻 persist：重置是一次明确的写入，不能等下一次勾选才落盘。
 */
export function resetTodos() {
  items.value = buildDefaultTodos()
  persist()
}

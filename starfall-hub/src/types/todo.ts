import { nanoid } from 'nanoid'

/**
 * 一条待办。
 *
 * 放在 types/ 而不是 composables/useTodos.ts 里，与 types/widgetProps.ts 同一个理由：
 * 校验层不该 import 任何 Vue 组件或组合式函数。将来若 sanitizeWidgetProps 要认识
 * 这个类型，也不会因此把 ref 拖进校验层。
 */
export type TodoItem = {
  /**
   * 稳定身份，用于 v-for key 与勾选 / 删除定位。
   *
   * nanoid() 而不是 Date.now()：同一次粘贴多行会在同一毫秒里生成多条，
   * 时间戳撞了之后 v-for 的 key 重复，Vue 复用错节点，勾选会勾到隔壁那条。
   * 与 grid.ts 的 Tile.id 同源。
   */
  id: string
  /** 正文，归一化后不含控制字符 */
  text: string
  /** 是否已完成 */
  done: boolean
  /** 创建时刻（毫秒）。「最近一条」与未完成区的排序都要它 */
  createdAt: number
  /**
   * 完成时刻；未完成为 undefined。
   *
   * 与 createdAt 分开存而不是只留一个 updatedAt：「最近一条」指的是最近**新建**的
   * 未完成项，而已完成区要按**完成**时间倒序（刚勾掉的浮到最上，用户能立刻看见
   * 自己干了什么、也方便手滑后就地撤销）。一个字段答不了两个问题。
   */
  doneAt?: number
  /** 分组名，缺省即「未分组」。由新建输入行的冒号前缀给出 */
  group?: string
}

/**
 * 条数上限。
 *
 * 不是 useSearchHistory 那个 12：搜索记录是**可再生**的（再搜一次就有了），
 * 超上限挤掉旧的没有损失；待办是手打的，挤掉就是丢东西。所以这个数字不是
 * 「界面上放得下多少」，而是「localStorage 的护栏」——200 × 120 字符 ≈ 24KB，
 * 量级安全。达到上限时的行为是**拒绝新增并提示**，不是挤掉最旧的：
 * 静默丢弃用户刚打的字，是比报错更坏的结果。
 */
export const MAX_ITEMS = 200

/** 单条正文上限 */
export const MAX_LENGTH = 120

/** 分组名上限。也是冒号前缀被认成组名的长度门槛（见 parseTodoInput） */
export const MAX_GROUP_LENGTH = 16

/**
 * 正文归一化。
 *
 * 剥控制字符的理由与 useSearchHistory.normalize / widgetProps 的 placeCheck 相同：
 * 它在界面上完全不可见，却能把 JSON 序列化搞坏，属于最难察觉的那类脏数据。
 * 内部连续空白（含粘贴进来的换行）压成一个空格：一条待办是一行。
 *
 * 控制字符写成 \u 转义而不是把真字符敲进正则字面量：后者会让这个 .ts 文件里
 * 真的含有 NUL 字节，于是 ripgrep 把它当二进制跳过——「搜不到引用」比这段代码
 * 本身要挡的脏数据更难察觉。
 */
export function normalizeText(raw: string): string {
  const clean = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
  // 用扩展运算符按码位截断，避免把一个 emoji 切成半个代理对
  return [...clean].slice(0, MAX_LENGTH).join('')
}

/** 组名归一化；归一化后为空即「没有组」，返回 undefined 让这个键整个消失 */
export function normalizeGroup(raw: string): string | undefined {
  const clean = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!clean) return undefined
  return [...clean].slice(0, MAX_GROUP_LENGTH).join('')
}

/**
 * 从输入框的一行里解析出「组名 + 正文」。
 *
 * 分组不需要任何额外控件、也不需要新的 WidgetFieldCheck kind：在新建行里打
 * `工作: 交电费` 即可。分隔符认半角 `:` 与全角 `：`。
 *
 * 三道门槛，缺一不可，否则整串当正文：
 *   - 冒号前非空且不超过 MAX_GROUP_LENGTH
 *   - 冒号前**不含空格**——「记得: 明天下雨」不该变成一个叫「记得」的组
 *   - 冒号后归一化仍有内容——`工作:` 是个还没打完的输入，不是一条空待办
 *
 * 返回 null 表示这一行没有可提交的内容（空串 / 纯空白）。
 *
 * 放在这里而不是 TodoInput.vue 里：它要读上面两个上限与两个归一化函数，
 * 搬进组件就得把常量也带过去或从这里 import 一半，规则反而分成了两处。
 */
export function parseTodoInput(raw: string): { text: string; group?: string } | null {
  const match = /^([^:：]{1,})[:：]([\s\S]*)$/.exec(raw)
  if (match) {
    const head = match[1].trim()
    const rest = normalizeText(match[2])
    if (rest && head && !/\s/.test(head) && [...head].length <= MAX_GROUP_LENGTH) {
      return { text: rest, group: normalizeGroup(head) }
    }
  }
  const text = normalizeText(raw)
  return text ? { text } : null
}

/**
 * 逐项校验一份存档。
 *
 * 核心纪律与 useSearchHistory.load 一致：**不合法的单项丢掉，绝不因为一项坏而丢
 * 整份存档**——localStorage 可被随意改写，一条脏数据不该让用户手打的十几条消失。
 *
 * 各字段的处置方向刻意不同，判据是**能修的就修，不能修的才丢，而「正文还在」
 * 永远算能修**：
 *   非 object                        → 丢这一项
 *   text 非 string / 归一化后为空    → 丢这一项（没有正文的待办不是待办）
 *   id 非 string 或空                → 补 nanoid()（正文是用户资产，id 只是内部身份）
 *   done 非 boolean                  → 视作 false（宁可让一条已完成的重新冒出来，
 *                                       也不要静默删掉）
 *   createdAt 非有限数               → 补 Date.now()
 *   doneAt 非有限数                  → 删掉这个键
 *   group 非 string / 归一化后为空   → 删掉这个键（落到「未分组」）
 *   id 重复                          → 后者补新 id（seen Set，与 history 的去重同一手法）
 */
export function sanitizeTodos(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) return []

  const out: TodoItem[] = []
  const seen = new Set<string>()

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const source = entry as Record<string, unknown>

    if (typeof source.text !== 'string') continue
    const text = normalizeText(source.text)
    if (!text) continue

    let id = typeof source.id === 'string' ? source.id.trim() : ''
    if (!id || seen.has(id)) id = nanoid()
    seen.add(id)

    const createdAt =
      typeof source.createdAt === 'number' && Number.isFinite(source.createdAt)
        ? source.createdAt
        : Date.now()

    const item: TodoItem = {
      id,
      text,
      done: source.done === true,
      createdAt,
    }

    /*
     * doneAt 只在「确实已完成」时保留。
     *
     * done 被判成 false 的项若还留着 doneAt，已完成区按 doneAt 排序时会读到一个
     * 属于未完成项的时间戳；而这一项此刻的语义就是「重新变成待办」。
     */
    if (item.done && typeof source.doneAt === 'number' && Number.isFinite(source.doneAt)) {
      item.doneAt = source.doneAt
    }

    if (typeof source.group === 'string') {
      const group = normalizeGroup(source.group)
      if (group !== undefined) item.group = group
    }

    out.push(item)
    /*
     * 超出上限即停。
     *
     * 与 add() 的「拒绝并提示」不同：这里丢掉的是存档里超出护栏的部分，
     * 那只可能来自手改 localStorage，没有「用户刚打的字」要保护。
     */
    if (out.length >= MAX_ITEMS) break
  }

  return out
}

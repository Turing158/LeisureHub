import { computed, ref } from 'vue'

const STORAGE_KEY = 'starfall-hub:search-history'

/**
 * 保留条数。
 *
 * 12 条约等于「最近半天搜过什么」，而 h=2 那一档的展示区在最窄的 2 格宽上
 * 也只放得下三四条——多存的部分靠横向滚动够得着，再多就成了只占存储不被看见的数据。
 */
const MAX_ITEMS = 12

/** 单条长度上限：一条超长查询会把整排 chip 挤成一条，展示侧还要再截一次 */
const MAX_LENGTH = 60

/**
 * 搜索记录。
 *
 * **模块级共享**，与 useSuggest（每个方块一份）刻意不同：记录回答的是
 * 「我搜过什么」，那是一份属于用户的记录，不属于某一个方块。桌面上放三个搜索方块
 * 时，它们该看到同一份记录；各存一份会让「刚在上面那个框搜过的词，下面这个框看不到」。
 *
 * 只落 localStorage，**不发给任何第三方**——这与搜索建议是两类东西：
 * 建议必须把输入送到搜索引擎（见 utils/jsonp.ts），记录全程留在本机。
 * 但它仍有隐私成本：内容直接显示在桌面上，旁人扫一眼就能看到。
 * 所以给了设置开关与「清空」，见 stores/settings 的 searchHistoryEnabled。
 */
const items = ref<string[]>(load())

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    /*
     * 逐条过滤而不是整份丢弃：localStorage 可被随意改写，
     * 一条脏数据不该让用户的整份记录消失。
     */
    const out: string[] = []
    const seen = new Set<string>()
    for (const item of parsed) {
      if (typeof item !== 'string') continue
      const text = normalize(item)
      if (!text) continue
      const key = text.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(text)
      if (out.length >= MAX_ITEMS) break
    }
    return out
  } catch {
    return []
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.value))
  } catch {
    // 配额满或无痕模式：内存里的记录仍可用，抛出去只会让一次正常搜索看起来失败了
  }
}

/**
 * 归一化。
 *
 * 剥控制字符的理由与 widgetProps 的 placeCheck 相同：它在界面上完全不可见，
 * 却能把 JSON 序列化搞坏，属于最难察觉的那类脏数据。
 * 内部连续空白压成一个空格，让「vue  教程」与「vue 教程」算同一条。
 *
 * 控制字符写成 \u 转义而不是直接贴进字面量：后者会让这个 .ts 文件里真的含有
 * NUL 字节，于是 grep / ripgrep 把它当二进制跳过——「搜不到引用」比这段代码
 * 本身要挡的脏数据更难察觉。
 */
function normalize(raw: string): string {
  const clean = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
  return [...clean].slice(0, MAX_LENGTH).join('')
}

export function useSearchHistory() {
  /**
   * 记一条。
   *
   * 已存在的条目**移到最前**而不是跳过：重复搜同一个词说明它更常用，
   * 留在原位会让它慢慢被新词挤掉。大小写不敏感地比对，但保留用户这次的写法。
   */
  function push(query: string) {
    const text = normalize(query)
    if (!text) return
    const key = text.toLowerCase()
    items.value = [text, ...items.value.filter((item) => item.toLowerCase() !== key)].slice(
      0,
      MAX_ITEMS,
    )
    persist()
  }

  function remove(query: string) {
    const key = query.toLowerCase()
    items.value = items.value.filter((item) => item.toLowerCase() !== key)
    persist()
  }

  function clear() {
    items.value = []
    persist()
  }

  /** 有没有可清空的东西；设置里的「清空」按钮据此禁用 */
  const hasItems = computed(() => items.value.length > 0)

  return { items, hasItems, push, remove, clear }
}

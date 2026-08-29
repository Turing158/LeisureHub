import { onBeforeUnmount, ref } from 'vue'

import { jsonp } from '@/utils/jsonp'
import type { EngineDef } from '@/data/engines'

/** 输入停止后多久才发请求；落在 --dur-fast(140) 与 --dur-base(240) 之间 */
const DEBOUNCE_MS = 200

/** 一次最多显示几条：端点通常返回 10 条，再多列表就要滚动了 */
const MAX_ITEMS = 10

/**
 * 搜索建议。
 *
 * 三条约束写在这里而不是散在组件里：
 *
 * 1. **合成期间不发请求**。拼音每敲一个字母都会触发 input，不拦的话打一个中文词
 *    要发七八次请求，而那些拼音串在中文引擎上根本查不出东西。
 * 2. **每次请求领一个序号，回调里比对后才写入状态**。与 SettingsDrawer 的
 *    probeToken 是同一个模式，理由也相同：连着改两次输入时，先发的请求可能后回来，
 *    不比对就会用旧结果覆盖新状态。
 * 3. **输入清空时立刻收起，不等请求回来**。
 */
export function useSuggest() {
  const items = ref<string[]>([])

  let timer = 0
  /** 与 probeToken 同一个模式：领号 → 回调里比对 */
  let token = 0

  function clear() {
    token += 1
    if (timer) {
      clearTimeout(timer)
      timer = 0
    }
    items.value = []
  }

  /**
   * 安排一次取数。
   *
   * engine 每次传入而不是闭包捕获：用户可能在两次输入之间切了引擎，
   * 而这个 composable 不该持有「当前引擎」这份状态的第二个副本。
   */
  function schedule(engine: EngineDef, query: string) {
    if (timer) {
      clearTimeout(timer)
      timer = 0
    }

    const text = query.trim()
    const source = engine.suggest
    if (!text || !source) {
      // 清空输入或换到不提供建议的引擎：立刻收起，且让在飞的请求作废
      token += 1
      items.value = []
      return
    }

    token += 1
    const mine = token

    timer = window.setTimeout(() => {
      timer = 0
      void jsonp(source.url, text).then((payload) => {
        if (mine !== token) return
        // parse 的入参是第三方脚本传进来的任意值，各引擎的实现都做了存在性检查
        const list = payload === null ? [] : source.parse(payload)
        items.value = dedupe(list).slice(0, MAX_ITEMS)
      })
    }, DEBOUNCE_MS)
  }

  onBeforeUnmount(clear)

  return { items, schedule, clear }
}

/**
 * 去重并去掉纯空白项。
 *
 * 端点偶尔会返回同一条的两种写法（大小写不同、尾部多个空格），
 * 而列表是用文本当 key 的，重复会让 Vue 复用错元素。
 */
function dedupe(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const text = raw.trim()
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

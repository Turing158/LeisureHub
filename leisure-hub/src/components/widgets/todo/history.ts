import { WEEKDAY_LABELS } from '../calendar/dateGrid'
import type { TodoItem } from '@/types/todo'

/**
 * 「近 N 天各天完成了几条」的换算。
 *
 * 只有 rail 档（w=1）消费：那一档 75px 宽放不下正文，纵向却有 200~400px 的余量，
 * 于是把这块空白交给一个**回顾**——点阵回答「还剩几件」，这里回答「最近在推进吗」。
 *
 * 和 calendar/dateGrid.ts 同一条纪律：**纯函数，日期一律从参数传入**，
 * 这里绝不读 `new Date()`。时钟的唯一来源是 composables/useToday（模块级共享 +
 * 跨零点翻页），在这里再读一次会让网格里的方块与拖拽浮层里的那个在零点前后错开一天。
 *
 * 星期文案直接复用日历那份 WEEKDAY_LABELS 而不是在这里再抄一遍七个字：
 * 「周一到周日怎么写」是全站一致的事实，抄第二份就有了第二个真值源。
 */

/** 窗口里的一天 */
export interface DoneDay {
  /** YYYY-MM-DD，作 v-for 的 key */
  key: string
  /** 「一」…「日」；今天写「今」 */
  label: string
  /** 这一天完成了几条 */
  count: number
  isToday: boolean
}

/**
 * 窗口天数。
 *
 * 7 而不是「按高度给几天就画几天」：一周是用户自己就有的时间单位，
 * 「最近七天」在 1×2 和 1×4 里是同一句话，只是行更矮或更高。
 * 让天数跟着高度变，则同一份数据在两个方块上给出两条不同的曲线。
 */
export const WINDOW_DAYS = 7

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function dateKey(y: number, m: number, d: number): string {
  // 交给 Date 归一化，避免自己处理「今天是 1 号，往前六天」的跨月跨年
  const at = new Date(y, m, d)
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

/**
 * 按天汇总最近 WINDOW_DAYS 天的完成数，**今天在最后一项**。
 *
 * 返回的数组长度恒为 WINDOW_DAYS，没有完成记录的那天 count 为 0 而不是缺项：
 * 缺项会让「周三什么都没干」在图里变成不存在的一天，行数也随之跳动。
 *
 * 归属日按**本地日历日**比对（先把 doneAt 折成 YYYY-MM-DD 再查表），
 * 不用 `(now - doneAt) / 86400000` 那种毫秒除法：后者在夏令时切换的那一周会整体偏
 * 一小时，跨过零点附近的条目于是被算进隔壁那一天。
 */
export function recentDone(items: TodoItem[], today: Date): DoneDay[] {
  const y = today.getFullYear()
  const m = today.getMonth()
  const d = today.getDate()

  /** 日期键 → 窗口内下标；顺带就是「这一天在不在窗口里」的判据 */
  const slot = new Map<string, number>()
  const out: DoneDay[] = []

  for (let back = WINDOW_DAYS - 1; back >= 0; back--) {
    const at = new Date(y, m, d - back)
    const key = dateKey(y, m, d - back)
    const isToday = back === 0
    slot.set(key, out.length)
    out.push({
      key,
      // 今天不写星期：一列里最该被认出来的是「今天」，而星期几要数一下才知道是哪行
      label: isToday ? '今' : WEEKDAY_LABELS[(at.getDay() + 6) % 7],
      count: 0,
      isToday,
    })
  }

  for (const item of items) {
    // 未完成、或存档里缺 doneAt 的已完成项（sanitizeTodos 允许这种）都不计入
    if (!item.done || item.doneAt === undefined) continue
    const at = new Date(item.doneAt)
    // 时钟被改过时 doneAt 可能是未来或极久以前，落在窗口外即忽略
    const index = slot.get(dateKey(at.getFullYear(), at.getMonth(), at.getDate()))
    if (index !== undefined) out[index].count++
  }

  return out
}

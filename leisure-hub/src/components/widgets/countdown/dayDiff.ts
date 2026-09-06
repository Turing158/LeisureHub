/**
 * 倒计时的日期算术。
 *
 * 单独一个文件而不是写在组件里：它是纯函数，可以在 devtools 里直接验，
 * 而三个坑（字符串解析、夏令时、2 月 29 日）各要一句注释。
 *
 * 全程只在**本地时区**里活动：「纪念日」是一个日历日，不是一个时间瞬间。
 * 一旦掺进 UTC，「今天几号」就有了两个答案。
 */

/** 一天的毫秒数。夏令时那天不是这个值，见 dayDiff 的 round */
const MS_PER_DAY = 86_400_000

/** 拆好的年月日，month 是 1-based（与用户看到的一致，不是 Date 的 0-based） */
export interface DateParts {
  year: number
  month: number
  day: number
}

/**
 * 解析 `YYYY-MM-DD`。
 *
 * **绝不 `new Date('2027-01-01')`**：带横线的日期串按 ES 规范当 UTC 解析，
 * 于是 `getDate()` 在 UTC+8 之外的时区会给出前一天——UTC-5 的用户存了元旦，
 * 方块显示 12 月 31 日。手拆成三个整数再 `new Date(y, m - 1, d)`
 * （后者是**本地**构造）是唯一没有这个坑的路径。
 *
 * 同时挡掉「格式对但不存在」的日子（2 月 30 日）：构造后回读月日，对不上就拒。
 * 与 dateCheck 是同一道校验，两处都要——这里是渲染路径的最后一道，
 * 而 props 可能由将来别的写入路径绕过 store。
 */
export function parseDateParts(raw: unknown): DateParts | undefined {
  if (typeof raw !== 'string') return undefined
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim())
  if (!m) return undefined

  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined

  // 回读：new Date(2027, 1, 30) 会静默溢出到 3 月 2 日，正则拦不住
  const probe = new Date(year, month - 1, day)
  if (probe.getMonth() !== month - 1 || probe.getDate() !== day) return undefined

  return { year, month, day }
}

/** 归一到本地零点，否则「今天下午到明天上午」会算出 0.7 天 */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * 相差几天，两端都按本地零点算。
 *
 * `Math.round` 而非 `Math.floor`：夏令时切换的那一天只有 23 小时，跨过它的差值是
 * `n - 0.042` 天，`floor` 会少一天——一年错一次，且错在春天某个说不清的日子。
 * 国内不用夏令时，但把它写对的成本是一个单词。
 */
export function dayDiff(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY)
}

/**
 * 某一年里的「同月同日」，超出该月天数时**夹到月末**。
 *
 * 不夹的话 `new Date(2027, 1, 29)` 会静默溢出到 3 月 1 日——闰年生日的人
 * 每三年被挪到隔月。夹到 2 月 28 是显式选择：「纪念这个月的这一天」
 * 比「纪念这一天之后的 24 小时」更接近直觉。
 */
export function sameDayInYear(year: number, month: number, day: number): Date {
  // month 是 1-based；day = 0 取的是「上一个月的最后一天」，即 month 月的天数
  const last = new Date(year, month, 0).getDate()
  return new Date(year, month - 1, Math.min(day, last))
}

/**
 * 下一次纪念日（按年重复时用）。
 *
 * `>= 0` 而非 `> 0`：今天正是纪念日时应当停在今天说「就是今天」，
 * 而不是跳到明年说「还有 365 天」。
 */
export function nextAnniversary(today: Date, month: number, day: number): Date {
  const thisYear = sameDayInYear(today.getFullYear(), month, day)
  return dayDiff(today, thisYear) >= 0
    ? thisYear
    : sameDayInYear(today.getFullYear() + 1, month, day)
}

/**
 * 天数上限（约 27 年）。两个理由，第二个是硬的：
 *
 * - 版式那套字宽账按 1..4 位算。5 位数要么溢出，要么把字号压到比副信息还小。
 * - 更硬：targetDate 来自 localStorage，可以被手改成 `9999-12-31`，那是 6 位。
 *
 * 超界**不夹数字**，改写单位（见 countdownText）：夹成「9999 天」是在撒谎，
 * 而年为单位在这个量级上恰好是用户真正想读的。
 */
export const MAX_DAYS = 9999

/** 展示用的三段文案。prefix / unit 可为空串（「今天」那一档） */
export interface CountdownText {
  /** 「还有」/「已经」；micro 与超界档不画 */
  prefix: string
  /** 数字或「今天」 */
  value: string
  /** 「天」/「天前」/「年后」/「年前」；「今天」那一档为空 */
  unit: string
}

/**
 * 由天数差生成文案。
 *
 * 三个状态每个都有文案（RecentSearches 立的那条纪律），且**「0 天」永远不出现**
 * ——它读起来像「已过期」或「加载中」，而那一天恰恰是这个方块整个生命周期里
 * 最重要的一天。
 *
 * **方向由文案承载，不由颜色**：视觉语言只准 --accent 标二元状态，
 * 而「未来 / 过去」不是状态而是内容。这也顺带解决了最小档的歧义——
 * micro 只画得下数字 + 单位，而单位本身就是 `天` / `天前`，方向没丢。
 */
export function countdownText(diff: number): CountdownText {
  if (diff === 0) return { prefix: '', value: '今天', unit: '' }

  const future = diff > 0
  const days = Math.abs(diff)
  const prefix = future ? '还有' : '已经'

  // 超界：改写单位而不是夹数字。floor 而非 round——「27 年后」宁可说少不说多
  if (days > MAX_DAYS) {
    return { prefix, value: String(Math.floor(days / 365)), unit: future ? '年后' : '年前' }
  }
  return { prefix, value: String(days), unit: future ? '天' : '天前' }
}

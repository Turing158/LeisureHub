/**
 * 日历的日期换算。
 *
 * 全部是纯函数，日期一律从参数传入而不在这里读 `new Date()`：
 * 时钟的唯一来源是 composables/useToday（模块级共享 + 跨零点翻页），
 * 这里再读一次时钟会让「网格里的日历」和「拖拽浮层里的日历」在零点前后短暂不一致。
 */

/** 周一为首列：中文语境下的习惯，也与 ISO 8601 的周定义一致 */
export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const

/** 整月网格恒定 6 行：行数随月份变化会让行高跳动，跨零点看起来像方块在抽动 */
const GRID_ROWS = 6

/** 一格日期 */
export interface DayCell {
  /** 1..31，该格自己所属月份里的日号 */
  day: number
  /** 相对当前月：-1 上月、0 当月、1 下月 */
  offset: -1 | 0 | 1
  isToday: boolean
  isWeekend: boolean
  /** YYYY-MM-DD，作 v-for 的 key；跨月的两个「1 号」不会撞 key */
  key: string
}

/** 一周，days 恒为 7 项 */
export interface WeekRow {
  /** ISO 周数，1..53 */
  week: number
  days: DayCell[]
}

/** 组件需要的全部派生值，外壳算一次后整体下传 */
export interface CalendarView {
  year: number
  /** 1..12，直接可显示，不是 getMonth() 的 0..11 */
  month: number
  day: number
  /** 「星期四」 */
  weekdayText: string
  /** WEEKDAY_LABELS 的下标，0=周一 */
  weekdayIndex: number
  /** 今天所在的 ISO 周数 */
  week: number
  /** 1..366，今天是今年的第几天 */
  dayOfYear: number
  /** 365 或 366，今年的总天数 */
  yearDays: number
  /** 含今天的那一周 */
  currentWeek: WeekRow
  /** 整月网格，恒 6 行 × 7 列 */
  grid: WeekRow[]
}

/** 周一为 0 的星期下标：getDay() 里周日是 0，直接用会把周日排到最前 */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * ISO 8601 周数。
 *
 * 在 UTC 上算而非本地时间：本地午夜的 Date 跨 DST 边界做加减时，
 * 结果可能落回前一天 23:00，周数因此偏 1。取出 y/m/d 重建 UTC 时刻后，
 * 每天恒为 86400000ms，减法才是可靠的。
 *
 * 规则是「周四归属年」：把日期移到它所在周的周四，那一年就是它的 ISO 年，
 * 再数它是该年的第几周。
 */
export function isoWeek(date: Date): number {
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const thursday = new Date(utc)
  // getUTCDay() 周日为 0，|| 7 把它归到周末那一侧，+4 即移到本周周四
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7))
  const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1)
  return Math.ceil(((thursday.getTime() - jan1) / 86400000 + 1) / 7)
}

/**
 * 今天是今年的第几天，1..366。
 *
 * 在 UTC 上算，理由同 isoWeek：本地午夜的两个 Date 跨 DST 边界做减法，
 * 差值可能是 86400000 ± 3600000，向下取整后偏 1 天。
 */
export function dayOfYear(date: Date): number {
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const jan1 = Date.UTC(date.getFullYear(), 0, 1)
  return Math.round((utc - jan1) / 86400000) + 1
}

/**
 * 今年的总天数，365 或 366。
 *
 * 由「2 月 29 日是否存在」判定而不自己写闰年规则（4 / 100 / 400）：
 * 规则写对不难，但让 Date 判定的版本不可能写错——平年传 (y, 1, 29) 会被
 * 构造函数归一化到 3 月 1 日，getMonth() 因此变成 2。
 * 与 monthGrid 里「让构造函数归一化」是同一个取舍。
 */
export function daysInYear(date: Date): number {
  return new Date(date.getFullYear(), 1, 29).getMonth() === 1 ? 366 : 365
}

/**
 * 造一格。
 *
 * offset 由日期本身与基准月份反推，而不是由循环下标推断：
 * 6 行网格的尾部可能整行都在下月，用下标判断要写两处边界。
 */
function makeCell(date: Date, baseMonth: number, baseYear: number, today: Date): DayCell {
  const monthDelta =
    (date.getFullYear() - baseYear) * 12 + (date.getMonth() - baseMonth)
  const offset = monthDelta < 0 ? -1 : monthDelta > 0 ? 1 : 0
  const weekday = date.getDay()

  return {
    day: date.getDate(),
    offset,
    isToday: isSameDay(date, today),
    isWeekend: weekday === 0 || weekday === 6,
    key: dateKey(date),
  }
}

/**
 * 整月网格，恒 6 行 × 7 列，首列为周一。
 *
 * 每格都用 `new Date(y, m, n)` 现造并让构造函数归一化（传 0 或 -3 会自动退到上月），
 * 而不是拿一个 Date 反复 setDate(+1)：后者在本地午夜跨 DST 时可能停在同一天，
 * 网格里会静默出现重复日期，且这种 bug 一年只在两天可复现。
 */
export function monthGrid(today: Date): WeekRow[] {
  const year = today.getFullYear()
  const month = today.getMonth()

  // 当月 1 号是周几，就要在它前面补几格上月
  const leading = mondayIndex(new Date(year, month, 1))

  const rows: WeekRow[] = []
  for (let row = 0; row < GRID_ROWS; row++) {
    const days: DayCell[] = []
    for (let col = 0; col < 7; col++) {
      const date = new Date(year, month, 1 - leading + row * 7 + col)
      days.push(makeCell(date, month, year, today))
    }
    // 周数取该行首日：同一行内不会跨周，取哪一天都一样
    rows.push({ week: isoWeek(new Date(year, month, 1 - leading + row * 7)), days })
  }
  return rows
}

/** 含今天的那一周，首列为周一 */
export function weekRow(today: Date): WeekRow {
  const year = today.getFullYear()
  const month = today.getMonth()
  const monday = today.getDate() - mondayIndex(today)

  const days: DayCell[] = []
  for (let col = 0; col < 7; col++) {
    days.push(makeCell(new Date(year, month, monday + col), month, year, today))
  }
  return { week: isoWeek(today), days }
}

/**
 * 组件需要的全部派生值。
 *
 * 只放「无法从别的字段一步算出」的量：剩余天数（yearDays - dayOfYear）与
 * 年度进度（两者相除）都不进 view，否则同一件事有了两份真值源，
 * 而组件里一次减法比一个需要跟着同步的字段更难写错。
 */
export function calendarView(today: Date): CalendarView {
  const weekdayIndex = mondayIndex(today)

  return {
    year: today.getFullYear(),
    month: today.getMonth() + 1,
    day: today.getDate(),
    weekdayText: `星期${WEEKDAY_LABELS[weekdayIndex]}`,
    weekdayIndex,
    week: isoWeek(today),
    dayOfYear: dayOfYear(today),
    yearDays: daysInYear(today),
    currentWeek: weekRow(today),
    grid: monthGrid(today),
  }
}

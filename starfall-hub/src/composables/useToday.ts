import { onBeforeUnmount, ref, type Ref } from 'vue'

/**
 * 当天日期，跨过零点自动翻页。
 *
 * 状态与定时器都是模块级的：一个页面上可能同时存在多个日历（网格里一个、
 * 拖拽浮层里一个、Dialog 预览里再一个），各自起一个定时器既浪费也会出现
 * 「两个日历在零点前后短暂显示不同日期」。引用计数归零才真正撤掉定时器。
 */
const today = ref(new Date())

let timer = 0
let consumers = 0

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * 距下一个零点的毫秒数。
 *
 * 下限 1s：系统时间在边界上回拨几毫秒时，算出的间隔可能是 0 甚至负数，
 * 那样 setTimeout 会以最小间隔连续空转。
 */
function msToNextMidnight(from: Date): number {
  const next = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1)
  return Math.max(1000, next.getTime() - from.getTime())
}

/**
 * 对齐到真实时间并排下一次唤醒。
 *
 * 每次都重新读 `new Date()` 而不是在上一个值上累加：设备休眠、标签页被节流、
 * 用户改系统时间都会让 setTimeout 的实际触发时刻偏离预期，
 * 只有以当前时钟为准重排，才不会一次误差之后长期错位。
 */
function sync() {
  const now = new Date()
  // 同一天就不写 ref，避免无谓的组件更新（可见性回调会频繁走到这里）
  if (!isSameDay(now, today.value)) today.value = now

  clearTimeout(timer)
  timer = window.setTimeout(sync, msToNextMidnight(now))
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') sync()
}

/**
 * 订阅当天日期。
 *
 * 返回的是共享 ref，只读使用；调用方在卸载时自动退订。
 */
export function useToday(): Ref<Date> {
  if (consumers === 0) {
    today.value = new Date()
    sync()
    /*
     * 后台标签页里 setTimeout 会被浏览器节流到分钟级，休眠更是完全停摆，
     * 回到前台时靠这一下补齐，而不是让用户看着昨天的日期发呆。
     */
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  consumers++

  onBeforeUnmount(() => {
    consumers--
    if (consumers > 0) return
    clearTimeout(timer)
    timer = 0
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return today
}

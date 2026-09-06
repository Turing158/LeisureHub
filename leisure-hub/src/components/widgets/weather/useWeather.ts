import {
  computed,
  onScopeDispose,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue'

import { fetchForecast } from './api'
import { isStale, placeKey, readCache, writeCache, TTL_MS } from './cache'
import type { WeatherPlace, WeatherView } from './types'

/** 方块要渲染哪一种版式（见设计文档 §8.3 的四态） */
export type WeatherStatus = 'unset' | 'loading' | 'ready' | 'error'

export interface WeatherState {
  view: ComputedRef<WeatherView | undefined>
  status: ComputedRef<WeatherStatus>
  /** 失败文案；有缓存时不进入失败态，但仍带着它供陈旧提示使用 */
  error: ComputedRef<string | undefined>
  /** 当前显示的是过期数据 */
  stale: ComputedRef<boolean>
}

/**
 * 一个地点的共享取数状态。
 *
 * 与 useToday 的模块级单值是同一个手法，只是这里的状态依赖参数，
 * 所以是 Map 而非单值。桌面上可能同时存在多个同地点的天气方块
 * （网格里两个、拖拽浮层一个、编辑面板预览一个），各自取一次数既浪费额度，
 * 也会出现「两个方块显示不同温度」。
 */
interface Entry {
  place: WeatherPlace
  view: Ref<WeatherView | undefined>
  error: Ref<string | undefined>
  loading: Ref<boolean>
  consumers: number
  timer: number
  /** 连续失败次数，决定退避时长；成功即归零 */
  failures: number
  controller: AbortController | undefined
}

const entries = new Map<string, Entry>()

/** 失败退避：1 / 2 / 4 / 8 分钟，之后恒为 8 分钟 */
const BACKOFF_MS = [60_000, 120_000, 240_000, 480_000]

function backoffOf(failures: number): number {
  return BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)]
}

/**
 * 排下一次唤醒。
 *
 * 后台标签页里不排：浏览器已把 setTimeout 节流到分钟级，再叠一层只会在
 * 回到前台的瞬间打出一串并发请求。回前台由 visibilitychange 统一补齐。
 */
function schedule(entry: Entry, delay: number) {
  clearTimeout(entry.timer)
  entry.timer = 0
  if (entry.consumers <= 0) return
  if (document.visibilityState !== 'visible') return
  entry.timer = window.setTimeout(() => {
    entry.timer = 0
    void refresh(entry)
  }, delay)
}

async function refresh(entry: Entry) {
  // 已有请求在飞就不再发第二个：TTL 定时器与 visibilitychange 可能同时触发
  if (entry.loading.value) return

  entry.loading.value = true
  const controller = new AbortController()
  entry.controller = controller

  try {
    const view = await fetchForecast(entry.place, controller.signal)
    entry.view.value = view
    entry.error.value = undefined
    entry.failures = 0
    writeCache(placeKey(entry.place), view)
    schedule(entry, TTL_MS)
  } catch (err) {
    // 主动取消（地点改了或最后一个订阅者卸载）不算失败，不该触发退避
    if (controller.signal.aborted) return
    entry.failures++
    entry.error.value = err instanceof Error ? err.message : '取数失败'
    schedule(entry, backoffOf(entry.failures))
  } finally {
    if (entry.controller === controller) entry.controller = undefined
    entry.loading.value = false
  }
}

function acquire(place: WeatherPlace): Entry {
  const key = placeKey(place)
  let entry = entries.get(key)

  if (!entry) {
    entry = {
      place,
      /*
       * 先用落盘值垫住首屏。
       * 哪怕已过期也立刻渲染——刷新页面后从骨架屏开始，
       * 是「内容跳动」里最刺眼的一种：方块明明有数据，却先闪一下空框。
       */
      view: shallowRef(readCache(key)),
      error: ref(undefined),
      loading: ref(false),
      consumers: 0,
      timer: 0,
      failures: 0,
      controller: undefined,
    }
    entries.set(key, entry)
  }

  entry.consumers++
  if (entry.consumers === 1) {
    if (entries.size === 1) document.addEventListener('visibilitychange', onVisibilityChange)
    const cached = entry.view.value
    if (!cached || isStale(cached)) void refresh(entry)
    else schedule(entry, TTL_MS - (Date.now() - cached.fetchedAt))
  }

  return entry
}

/**
 * 退订。
 *
 * 归零后只停定时器、取消在飞的请求，**不删 Map 里的条目**：
 * 拖拽结束时组件销毁重建，立刻删掉会丢掉内存里的值、造成一次多余请求。
 * 条目本身只占几百字节，且键的数量受用户配的地点数约束。
 */
function release(entry: Entry) {
  entry.consumers--
  if (entry.consumers > 0) return
  clearTimeout(entry.timer)
  entry.timer = 0
  entry.controller?.abort()
  entry.controller = undefined

  let active = 0
  for (const item of entries.values()) active += item.consumers
  if (active === 0) document.removeEventListener('visibilitychange', onVisibilityChange)
}

/**
 * 回到前台时补齐。
 *
 * 后台标签页的定时器被节流甚至完全停摆，不补的话用户切回来看到的是
 * 半小时前的温度。只刷新过期的条目，新鲜的不动。
 */
function onVisibilityChange() {
  if (document.visibilityState !== 'visible') return
  for (const entry of entries.values()) {
    if (entry.consumers <= 0) continue
    const view = entry.view.value
    if (!view || isStale(view)) void refresh(entry)
    else schedule(entry, TTL_MS - (Date.now() - view.fetchedAt))
  }
}

/**
 * 订阅一个地点的天气。
 *
 * 地点是 ref：编辑面板里改地点、预览联动都会让它变，
 * 变化时退订旧条目、订阅新条目，而不是重建整个组件。
 */
export function useWeather(place: Ref<WeatherPlace | undefined>): WeatherState {
  const entry = shallowRef<Entry | undefined>()

  watch(
    // 按 key 而非对象身份触发：坐标相同的新对象不该引起一次退订 + 重订
    () => (place.value ? placeKey(place.value) : ''),
    () => {
      if (entry.value) release(entry.value)
      entry.value = place.value ? acquire(place.value) : undefined
    },
    { immediate: true },
  )

  /*
   * onScopeDispose 而非 onBeforeUnmount：本函数除了组件的 setup，
   * 也会在纯 effectScope 里被调用（取数层的独立验证），
   * 后者没有组件实例，onBeforeUnmount 只会打一条警告然后什么都不做——
   * 那正是「退订静默失效、请求越积越多」这类问题的来源。
   * 组件的 setup 本身就在一个 scope 里，所以这一处对组件的行为完全相同。
   */
  onScopeDispose(() => {
    if (entry.value) release(entry.value)
    entry.value = undefined
  })

  const view = computed(() => entry.value?.view.value)
  const error = computed(() => entry.value?.error.value)

  const status = computed<WeatherStatus>(() => {
    if (!entry.value) return 'unset'
    if (entry.value.view.value) return 'ready'
    return entry.value.error.value ? 'error' : 'loading'
  })

  /*
   * loading 也读进来：它在每次尝试的首尾各翻一次，
   * 使这个 computed 在「拉取失败、陈旧值继续显示」时也能重算。
   * 否则 fetchedAt 是普通数字，过了 TTL 也不会有任何东西通知它。
   */
  const stale = computed(() => {
    const current = entry.value
    if (!current) return false
    void current.loading.value
    const value = current.view.value
    return value ? isStale(value) : false
  })

  return { view, status, error, stale }
}

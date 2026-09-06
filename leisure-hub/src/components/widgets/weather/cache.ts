import type { WeatherPlace, WeatherView } from './types'
import { ensureStorageMigrated, STORAGE_NAMESPACE } from '@/utils/storageNamespace'

const STORAGE_PREFIX = `${STORAGE_NAMESPACE}:weather:`

/**
 * 新鲜期 15 分钟。
 *
 * Open-Meteo 的 `current` 本身 15 分钟一档（响应里的 `interval: 900`），
 * 比这更勤地拉只会拿到同一份数据。
 */
export const TTL_MS = 15 * 60 * 1000

/**
 * 落盘上限 6 小时。
 *
 * 超过就不再渲染陈旧值：一份半天前的温度比「取不到」更容易误导——
 * 它看起来是正常数据，用户不会察觉自己在读昨夜的天气。
 */
const STALE_MAX_MS = 6 * 60 * 60 * 1000

/**
 * 地点 → 缓存键。
 *
 * 坐标保留 2 位小数（约 1km）。这不只是为了键短：地名搜索给的是
 * 39.9075，手填可能是 39.91，`navigator.geolocation` 会给 39.90748...，
 * 三者是同一个地点却会各占一条缓存、各打一次请求。
 * 与 useWeather 的共享 key 必须用同一个函数，否则「共享一次请求」这条会静默失效。
 */
export function placeKey(place: WeatherPlace): string {
  return `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`
}

/**
 * 读缓存。
 *
 * 过期不删也不返回 undefined：调用方要靠 `fetchedAt` 自行判断新鲜与陈旧，
 * 首屏正是「先渲染过期值再后台刷新」。只有超过 STALE_MAX_MS 才当作没有。
 *
 * 解析失败一律返回 undefined 并清掉该条：localStorage 可被随意改写，
 * 一条坏数据不该让方块永久停在失败态。
 */
export function readCache(key: string): WeatherView | undefined {
  ensureStorageMigrated()
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    if (!raw) return undefined

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return undefined

    const view = parsed as WeatherView
    /*
     * 只校验 fetchedAt 与 temp 两项，不逐字段重验。
     * 写入方是 parseForecast，它的输出结构已经过一次完整校验；
     * 这里要挡的是「不是本项目写的 JSON」与「时间戳异常」，两项足够。
     */
    if (typeof view.fetchedAt !== 'number' || !Number.isFinite(view.fetchedAt)) return undefined
    if (typeof view.temp !== 'number') return undefined

    const age = Date.now() - view.fetchedAt
    // age < 0 是系统时间被回拨：当作可用，下一次 TTL 判定自会把它算成过期
    if (age > STALE_MAX_MS) {
      localStorage.removeItem(STORAGE_PREFIX + key)
      return undefined
    }
    return view
  } catch {
    try {
      localStorage.removeItem(STORAGE_PREFIX + key)
    } catch {
      // 无痕模式下 removeItem 也会抛，忽略即可
    }
    return undefined
  }
}

/**
 * 写缓存。
 *
 * 失败静默：配额满或无痕模式下写不进去，但内存里的值仍然可用，
 * 抛出去只会让一次成功的取数看起来像失败了。
 */
export function writeCache(key: string, view: WeatherView): void {
  ensureStorageMigrated()
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(view))
  } catch {
    // 忽略
  }
}

/** 数据是否已过新鲜期，需要后台刷新 */
export function isStale(view: WeatherView, now = Date.now()): boolean {
  return now - view.fetchedAt >= TTL_MS
}

/**
 * 清掉全部地点的缓存，供设置里的「重置为默认」调用。
 *
 * 缓存不是用户数据，本可以不管（TTL 一到自会刷新）。但重置会把方块换回默认那一个
 * 地点，用户之前配过的城市从此再无入口，它们的缓存就成了永久孤儿——与
 * settings.reset 里连 IndexedDB 的图片字节一起删是同一条纪律。
 *
 * 先收集再删：直接在遍历里 removeItem 会让后续下标整体前移，漏掉相邻的键。
 */
export function clearWeatherCache(): void {
  ensureStorageMigrated()
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key)
    }
    for (const key of keys) localStorage.removeItem(key)
  } catch {
    // 无痕模式下这些 API 会抛；缓存留着也只是多一次过期判定
  }
}

import type {
  GeoResult,
  WeatherDay,
  WeatherHour,
  WeatherIconName,
  WeatherPlace,
  WeatherView,
} from './types'

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'

/**
 * 逐时取 36 小时、每 3 小时一格，共 12 格。
 *
 * 请求整 36 小时而不是只请求需要的 12 个点：Open-Meteo 没有「按步长采样」的参数，
 * 抽稀只能在客户端做，而 36 个浮点数与 12 个的传输差异可以忽略。
 */
const FORECAST_HOURS = 36
const HOUR_STEP = 3
const HOUR_COUNT = 12

/**
 * 取 8 天而非 7 天。
 *
 * 逐日列表一律从明天起（今天的高低温已由 L2 那一行单独占着，重复列一遍是空转），
 * 而 full 一档要放 7 行，所以要 1 + 7 天。
 */
const FORECAST_DAYS = 8

const CURRENT_VARS = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'is_day',
  'weather_code',
  'wind_speed_10m',
  'wind_direction_10m',
] as const

const HOURLY_VARS = ['temperature_2m'] as const

const DAILY_VARS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_probability_max',
  'sunrise',
  'sunset',
] as const

/**
 * WMO 天气代码 → 中文词 + 图标类。
 *
 * 28 个代码归成 9 类。天气词一律 ≤3 字：§6 的像素账按「雷阵雨」这个最长态算的，
 * 加进第四个字会让 strip 2×1 的第一行溢出。
 *
 * 晴与多云的图标带昼夜两态，由 is_day 在 pickIcon 里选，所以这张表里
 * 记的是白天那一支，夜间在读表之后替换。
 */
const WMO: Record<number, { text: string; icon: WeatherIconName }> = {
  0: { text: '晴', icon: 'clearDay' },
  1: { text: '少云', icon: 'clearDay' },
  2: { text: '多云', icon: 'cloudyDay' },
  3: { text: '阴', icon: 'overcast' },
  45: { text: '雾', icon: 'fog' },
  48: { text: '雾凇', icon: 'fog' },
  51: { text: '细雨', icon: 'rain' },
  53: { text: '细雨', icon: 'rain' },
  55: { text: '细雨', icon: 'rain' },
  56: { text: '冻雨', icon: 'freezing' },
  57: { text: '冻雨', icon: 'freezing' },
  61: { text: '小雨', icon: 'rain' },
  63: { text: '中雨', icon: 'rain' },
  65: { text: '大雨', icon: 'rain' },
  66: { text: '冻雨', icon: 'freezing' },
  67: { text: '冻雨', icon: 'freezing' },
  71: { text: '小雪', icon: 'snow' },
  73: { text: '中雪', icon: 'snow' },
  75: { text: '大雪', icon: 'snow' },
  77: { text: '雪粒', icon: 'snow' },
  80: { text: '阵雨', icon: 'shower' },
  81: { text: '阵雨', icon: 'shower' },
  82: { text: '暴雨', icon: 'shower' },
  85: { text: '阵雪', icon: 'snow' },
  86: { text: '阵雪', icon: 'snow' },
  95: { text: '雷阵雨', icon: 'thunder' },
  96: { text: '雷雨', icon: 'thunder' },
  99: { text: '雷雨', icon: 'thunder' },
}

/** 未知代码的兜底：接口新增代码时显示「未知」而不是空白 */
const UNKNOWN = { text: '未知', icon: 'overcast' as WeatherIconName }

function wmo(code: unknown) {
  return (typeof code === 'number' && WMO[code]) || UNKNOWN
}

/** 夜间把晴 / 多云换成对应的夜态字形，其余天气昼夜同形 */
function nightIcon(icon: WeatherIconName): WeatherIconName {
  if (icon === 'clearDay') return 'clearNight'
  if (icon === 'cloudyDay') return 'cloudyNight'
  return icon
}

/**
 * 蒲福风级。
 *
 * 显示风级而非「2.3 km/h」：风速的绝对值对多数人没有直觉，
 * 而「3 级」是中文天气预报的通用表述。上界即各级的 km/h 下限。
 */
const BEAUFORT = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118]

function windLevel(kmh: unknown): number {
  if (typeof kmh !== 'number' || !Number.isFinite(kmh)) return 0
  let level = 0
  while (level < BEAUFORT.length && kmh >= BEAUFORT[level]) level++
  return level
}

/** 八方位。16 方位在 60px 宽的格子里写不下（「东北偏北风」5 字） */
const DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']

function windText(deg: unknown): string {
  if (typeof deg !== 'number' || !Number.isFinite(deg)) return '微风'
  // 四舍五入即以每个方位的正中为界；% 8 把 360° 折回「北」
  const index = Math.round((((deg % 360) + 360) % 360) / 45) % 8
  return `${DIRS[index]}风`
}

/** 「2026-08-29T05:39」→「05:39」；格式不符时返回空串，由版式自行省略该行 */
function clockOf(iso: unknown): string {
  if (typeof iso !== 'string') return ''
  const at = iso.indexOf('T')
  return at < 0 ? '' : iso.slice(at + 1, at + 6)
}

/** 「2026-08-29T14:00」→ 14；解析不出返回 -1，调用方据此跳过该点 */
function hourOf(iso: unknown): number {
  const clock = clockOf(iso)
  if (!clock) return -1
  const hour = Number(clock.slice(0, 2))
  return Number.isInteger(hour) ? hour : -1
}

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']

/**
 * 逐日的单字标签：今天与明天用相对词，其后用星期。
 *
 * 「今」「明」而非「周五」「周六」：7 天里最近两天是用户真正会读的两项，
 * 相对词比让人自己数星期快；第三天起相对词（「后」「三天后」）反而更费解。
 */
function dayLabel(iso: unknown, index: number): string {
  if (index === 0) return '今'
  if (index === 1) return '明'
  if (typeof iso !== 'string') return '—'
  const date = new Date(`${iso}T00:00`)
  const wd = date.getDay()
  return Number.isNaN(wd) ? '—' : WEEKDAY[wd]
}

/** 温度一律取整：°C 的小数位在 20px 字号下读不出，还会把宽度撑到 5 个字形 */
function round(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * 抽出逐时序列。
 *
 * 从「不早于当前整点」的那一格起，每 3 小时取一个，最多 12 个。
 * 不直接从下标 0 开始：`forecast_hours` 返回的首格是当前小时，
 * 但页面可能是用缓存渲染的（最长 15 分钟前取的数），跨过整点后首格就成了过去。
 */
function pickHours(hourly: Record<string, unknown> | undefined, now: Date): WeatherHour[] {
  if (!hourly) return []
  const times = asArray(hourly.time)
  const temps = asArray(hourly.temperature_2m)
  const out: WeatherHour[] = []

  let start = 0
  const nowMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).getTime()
  for (let i = 0; i < times.length; i++) {
    const iso = times[i]
    if (typeof iso !== 'string') continue
    if (new Date(iso).getTime() >= nowMs) {
      start = i
      break
    }
  }

  for (let i = start; i < times.length && out.length < HOUR_COUNT; i += HOUR_STEP) {
    const hour = hourOf(times[i])
    const temp = temps[i]
    if (hour < 0 || typeof temp !== 'number' || !Number.isFinite(temp)) continue
    out.push({ hour, temp: Math.round(temp) })
  }
  return out
}

function pickDays(daily: Record<string, unknown> | undefined): WeatherDay[] {
  if (!daily) return []
  const times = asArray(daily.time)
  const codes = asArray(daily.weather_code)
  const highs = asArray(daily.temperature_2m_max)
  const lows = asArray(daily.temperature_2m_min)
  const pops = asArray(daily.precipitation_probability_max)

  const out: WeatherDay[] = []
  for (let i = 0; i < times.length && out.length < FORECAST_DAYS; i++) {
    out.push({
      label: dayLabel(times[i], i),
      icon: wmo(codes[i]).icon,
      high: round(highs[i]),
      low: round(lows[i]),
      pop: Math.min(100, Math.max(0, round(pops[i]))),
    })
  }
  return out
}

/**
 * 把响应解析成 WeatherView。
 *
 * 每个字段都做存在性检查、缺失时落到中性默认值，而不是断言结构。
 * 这是整个项目里唯一一处数据不由本项目产生的地方：Open-Meteo 改一个字段名，
 * 乐观解析就会在 `.map()` 上抛 TypeError 而让整个网格白屏。
 *
 * 解析失败（连当前温度都取不到）抛错，由 useWeather 转成失败态。
 */
export function parseForecast(raw: unknown, now = new Date()): WeatherView {
  if (!raw || typeof raw !== 'object') throw new Error('响应不是对象')
  const root = raw as Record<string, unknown>

  const current = (root.current ?? undefined) as Record<string, unknown> | undefined
  if (!current || typeof current.temperature_2m !== 'number') {
    throw new Error('响应缺少当前温度')
  }

  const hourly = (root.hourly ?? undefined) as Record<string, unknown> | undefined
  const daily = (root.daily ?? undefined) as Record<string, unknown> | undefined

  const meta = wmo(current.weather_code)
  const isDay = current.is_day !== 0
  const days = pickDays(daily)

  /*
   * 今日高低温取自 daily[0]，而不是 current 的瞬时值。
   * daily 缺失时退回当前温度：显示「27/27」虽不准，但比空白或 0/0 可解释。
   */
  const today = days[0]

  return {
    temp: round(current.temperature_2m),
    icon: isDay ? meta.icon : nightIcon(meta.icon),
    text: meta.text,
    high: today ? today.high : round(current.temperature_2m),
    low: today ? today.low : round(current.temperature_2m),
    apparent: round(current.apparent_temperature, round(current.temperature_2m)),
    humidity: Math.min(100, Math.max(0, round(current.relative_humidity_2m))),
    windLevel: windLevel(current.wind_speed_10m),
    windText: windText(current.wind_direction_10m),
    hours: pickHours(hourly, now),
    days,
    sunrise: clockOf(asArray(daily?.sunrise)[0]),
    sunset: clockOf(asArray(daily?.sunset)[0]),
    fetchedAt: Date.now(),
  }
}

/**
 * 拉一次预报。
 *
 * `timezone=auto` 让接口按坐标返回本地时刻，逐时的「12 15 18」才是当地钟点；
 * 用 UTC 再自行换算需要 tz 数据库，而本项目零运行时依赖。
 */
export async function fetchForecast(
  place: WeatherPlace,
  signal?: AbortSignal,
): Promise<WeatherView> {
  const params = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    current: CURRENT_VARS.join(','),
    hourly: HOURLY_VARS.join(','),
    daily: DAILY_VARS.join(','),
    timezone: 'auto',
    forecast_days: String(FORECAST_DAYS),
    forecast_hours: String(FORECAST_HOURS),
  })

  const res = await fetch(`${FORECAST_URL}?${params}`, { signal })
  if (!res.ok) throw new Error(`天气接口返回 ${res.status}`)
  return parseForecast(await res.json())
}

/**
 * 地名搜索。
 *
 * `language=zh` 让候选名与 admin1 都是中文；接口对无结果返回不带 results 的对象
 * 而非空数组，所以这里统一成空数组，调用方只需判长度。
 */
export async function searchPlace(name: string, signal?: AbortSignal): Promise<GeoResult[]> {
  const params = new URLSearchParams({
    name,
    count: '5',
    language: 'zh',
    format: 'json',
  })

  const res = await fetch(`${GEOCODE_URL}?${params}`, { signal })
  if (!res.ok) throw new Error(`地名接口返回 ${res.status}`)
  const raw: unknown = await res.json()
  const list = asArray((raw as Record<string, unknown> | null)?.results)

  const out: GeoResult[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.name !== 'string') continue
    if (typeof row.latitude !== 'number' || typeof row.longitude !== 'number') continue
    // 省 + 国用于同名消歧：搜「北京」会同时命中北京市与重庆下的同名镇
    const region = [row.admin1, row.country].filter((v) => typeof v === 'string').join(' · ')
    out.push({
      id: typeof row.id === 'number' ? row.id : out.length,
      name: row.name,
      lat: row.latitude,
      lon: row.longitude,
      region,
    })
  }
  return out
}

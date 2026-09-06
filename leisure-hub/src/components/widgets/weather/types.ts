/**
 * 图标名。9 类天气，晴与多云各分昼夜，共 11 个字形。
 *
 * 写成字符串联合而非 enum：tsconfig 开了 erasableSyntaxOnly，enum 会编译失败。
 */
export type WeatherIconName =
  | 'clearDay'
  | 'clearNight'
  | 'cloudyDay'
  | 'cloudyNight'
  | 'overcast'
  | 'fog'
  | 'rain'
  | 'thunder'
  | 'snow'
  | 'freezing'
  | 'shower'

/** 逐时一项 */
export interface WeatherHour {
  /** 0..23，本地时 */
  hour: number
  /** 摄氏度，已四舍五入到整数 */
  temp: number
}

/** 逐日一项 */
export interface WeatherDay {
  /** 「今」「明」「三」…… 单字，横排竖排都放得下 */
  label: string
  icon: WeatherIconName
  high: number
  low: number
  /** 降水概率 0..100 */
  pop: number
}

/**
 * 组件消费的扁平结构。
 *
 * 刻意不把 Open-Meteo 的响应原样传给版式组件：那份结构是按「变量 × 时间序列」
 * 组织的（`hourly.temperature_2m[i]` 与 `hourly.time[i]` 分两个数组对位），
 * 每个版式各自去对位下标会把解析逻辑复制八份。
 * 所有单位换算、取整、中文化都在 api.ts 里做完，这里之后只有读取。
 */
export interface WeatherView {
  /** 当前温度，整数 */
  temp: number
  icon: WeatherIconName
  /** 天气词，最长 3 字（「雷阵雨」） */
  text: string
  /** 今日高低温 */
  high: number
  low: number
  /** 体感温度 */
  apparent: number
  /** 相对湿度 0..100 */
  humidity: number
  /** 蒲福风级 0..12 */
  windLevel: number
  /** 风向，如「东南风」 */
  windText: string
  /** 逐时，最多 12 项，间隔 3 小时 */
  hours: WeatherHour[]
  /**
   * 逐日，最多 8 项。
   *
   * 第 0 项是今天，只用来取 high / low 那一行；列表一律从第 1 项（明天）起渲染，
   * 所以 full 一档要 1 + 7 项。
   */
  days: WeatherDay[]
  /** 「05:42」 */
  sunrise: string
  /** 「19:08」 */
  sunset: string
  /** 取到这份数据的时刻（epoch ms），用于判断陈旧 */
  fetchedAt: number
}

/** 地点：经纬度是取数的唯一依据，名字只用于显示 */
export interface WeatherPlace {
  lat: number
  lon: number
  /** 用户配的地点名；可缺省（手填经纬度时） */
  name?: string
}

/** geocoding 的一条候选 */
export interface GeoResult {
  /** Open-Meteo 的 id，仅作列表 key */
  id: number
  name: string
  lat: number
  lon: number
  /** 「北京市 · 中国」，用于同名消歧 */
  region: string
}

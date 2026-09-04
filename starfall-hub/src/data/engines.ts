import { CALLBACK_TOKEN, QUERY_TOKEN } from '@/types/search'

/**
 * 一个建议端点。
 *
 * url 里同时含 {q} 与 {cb}：前者填查询词，后者填本次请求的回调名。
 * parse 只做「把这一家的返回结构挑成字符串数组」，不做去重与截断——那是 useSuggest
 * 的职责，各家共用一份。
 *
 * 注意 parse 的入参是**第三方脚本传进来的任意值**，所以逐层做存在性检查、
 * 不断言结构。这与 weather/api.ts 里 parseForecast 的理由相同，
 * 只是这里的数据来源比那里更不可控（JSONP 等于执行第三方 JS）。
 */
export interface SuggestSource {
  url: string
  parse: (payload: unknown) => string[]
}

/** 一个搜索引擎的注册信息；形状对齐 data/widgets.ts 的「稳定 id + 展示名 + 实现」 */
export interface EngineDef {
  /** 持久化在 settings.engineId 里的稳定 key，改名会让用户已选的引擎失效 */
  id: string
  name: string
  /** 结果页地址，{q} 处填入 encodeURIComponent(query) */
  url: string
  /**
   * 引擎图标：内置字形名，或一段 favicon 地址。
   *
   * 字形（bing / google / custom）是本站内联的单色线性 SVG，无色相；
   * favicon（baidu / zhihu 的站点图标）是彩色位图，渲染成 `<img>`。
   * 判定在 EngineIcon.vue，与 TileIcon 处理「URL 还是文字」同一条逻辑。
   * favicon 只选本就在全县 UI 都会出现的两家，其余仍用字形。
   */
  icon: string
  /** 建议端点；缺省即该引擎不提供建议 */
  suggest?: SuggestSource
}

/**
 * 引擎图标：本站内置字形名，或站点 favicon 地址。
 *
 * 字形集合固定为 bing / google / custom，对应 EngineIcon.vue 的线性 SVG；
 * 交给 favicon 的两家（baidu / zhihu）把这个字段填成各自的图标 URL，
 * EngineIcon 按「是否 URL」分派 `<svg>` 与 `<img>`。
 */
export type EngineIcon = string

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

/** 只留非空字符串，其余一律丢弃 */
function pickStrings(list: unknown[]): string[] {
  const out: string[] = []
  for (const item of list) {
    if (typeof item === 'string' && item.trim()) out.push(item)
  }
  return out
}

/**
 * 内置引擎注册表。
 *
 * 单一数据源：引擎菜单、h=2 的快捷行、设置里的分段控件都读这里。
 *
 * 只有前两家带 suggest。360 与知乎的建议接口返回纯 JSON 且同样不发
 * Access-Control-Allow-Origin，没有 JSONP 回调参数可用，因此无法在纯静态站点里取到；
 * Google 的端点未实测，不凭印象填。缺 suggest 的引擎只是不出建议，搜索照常。
 */
export const ENGINES: EngineDef[] = [
  {
    id: 'baidu',
    name: '百度',
    url: `https://www.baidu.com/s?wd=${QUERY_TOKEN}`,
    icon: 'https://www.baidu.com/favicon.ico',
    suggest: {
      /*
       * ie=utf-8 不可省：默认返回 GBK，不带就是一串乱码。
       * 实测带上后响应头变为 charset=UTF-8，中文正常。
       */
      url: `https://suggestion.baidu.com/su?wd=${QUERY_TOKEN}&cb=${CALLBACK_TOKEN}&ie=utf-8`,
      // { q: '…', p: false, s: ['…', '…'] }
      parse: (payload) => pickStrings(asArray(asRecord(payload)?.s)),
    },
  },
  {
    id: 'bing',
    name: 'Bing',
    url: `https://www.bing.com/search?q=${QUERY_TOKEN}`,
    icon: 'bing',
    suggest: {
      url: `https://api.bing.com/qsonhs.aspx?type=cb&q=${QUERY_TOKEN}&cb=${CALLBACK_TOKEN}`,
      // { AS: { Results: [{ Suggests: [{ Txt: '…' }] }] } }
      parse: (payload) => {
        const results = asArray(asRecord(asRecord(payload)?.AS)?.Results)
        const out: string[] = []
        for (const group of results) {
          for (const item of asArray(asRecord(group)?.Suggests)) {
            const txt = asRecord(item)?.Txt
            if (typeof txt === 'string' && txt.trim()) out.push(txt)
          }
        }
        return out
      },
    },
  },
  {
    id: 'google',
    name: 'Google',
    url: `https://www.google.com/search?q=${QUERY_TOKEN}`,
    icon: 'google',
  },
  {
    id: 'zhihu',
    name: '知乎',
    url: `https://www.zhihu.com/search?type=content&q=${QUERY_TOKEN}`,
    icon: 'https://static.zhihu.com/heifetz/favicon.ico',
  },
]

export const DEFAULT_ENGINE_ID = ENGINES[0].id

const BY_ID = new Map(ENGINES.map((engine) => [engine.id, engine]))

export function getBuiltinEngine(id: string): EngineDef | undefined {
  return BY_ID.get(id)
}

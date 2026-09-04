/**
 * 搜索方块的占格范围。
 *
 * 与其余方块（1..SPAN_MAX，即 1..4）刻意不同：宽下限与高度上下限是常数，
 * 宽上限跟随当前网格列数，各有理由——
 *
 * - **宽下限 2**（170px）。1 格是 75px，引擎按钮与输入框并排后输入框只剩 20px，
 *   放不下两个字符；退化成「只有输入框」也仍然是个连提示语都写不下的窄条。
 *   与其保留一个不可用的档位，不如让它进不去。2 格本身也已经是引擎 chips 要
 *   收成只有图标的宽度（见 SearchWidget 的 chipsIconOnly，实测差 74px）。
 * - **宽上限跟随当前网格列数**（tile.ts 的 gridCols，grid store 在 load /
 *   resize 时同步）。搜索框是「宽度即可用性」的方块，能占多宽由桌面有多少列
 *   决定——缺省网格是 15 列，窄屏上 autoFit 会解出更少列，静态常数给不出正确
 *   的答案，上限就是网格本身。可读行长的顾虑仍在——超过 6 格（550px）后，
 *   光标与文字起点的距离已超出视觉扫视范围——但那是版式偏好，编辑框把档位
 *   摊开了，选多宽交给用的人自己掂量。下面 wMax 的 15 只是缺省网格下的初值，
 *   运行时以 tile.ts 的 capWidthToGrid 覆写为准；它刻意写成字面量而不是
 *   import DEFAULT_GRID_COLS——tile.ts 正 import 本文件，反向引用会成环。
 * - **高上限 2**（196px）。输入框恒定不到 40px 高，两档已经把多出来的空间用尽：
 *   h=1 是「输入行 + 一行紧凑 chips」（75px 里排到 68px，见 SearchWidget 的账），
 *   h=2 再加一块「最近搜索」。再高只是留白，而一个 317px 高的搜索框不是任何人
 *   想要的东西。
 *
 * 这些常数**不通过提高 SPAN_MAX 来实现**。那样会连带三处后果：TabCustom 的链接
 * 尺寸控件从 4 档变 6 档（8 列网格里 5×5、6×6 的方块几乎没有意义）；
 * calendar/variant.ts 与 weather/variant.ts 那两张「八个分支对 16 种形状完备且
 * 互斥」的判定表失效，要按 36 种形状重推；grid.ts 的推挤在超大方块下更容易走到
 * reflow 兜底。所以改成「按 widgetId 给一组独立上下限」，见 types/tile.ts。
 */
export const SEARCH_SPAN_LIMITS = { wMin: 2, wMax: 15, hMin: 1, hMax: 2 } as const

/** 结果页地址里的查询占位符 */
export const QUERY_TOKEN = '{q}'
/** 建议端点里的 JSONP 回调占位符 */
export const CALLBACK_TOKEN = '{cb}'

/** 用户自定义的搜索引擎 */
export interface CustomEngine {
  /** nanoid，持久化在 settings 里，与内置引擎的稳定 id 同一个命名空间 */
  id: string
  name: string
  /** 结果页地址，必须含 {q} */
  url: string
}

/** 名称软上限：分段控件与 chip 上都是单行显示 */
export const ENGINE_NAME_MAX = 12

/**
 * 校验地址模板，合法时返回去空白后的原文（**不是**归一化后的 href）。
 *
 * 协议白名单沿用 settings.ts 里 resolveImageUrl 的同一套写法：先要求形如绝对
 * 地址 → new URL() 归一化 → 只放行 http/https。理由与那里完全相同：
 * `javascript:` 一类必须在写入前就被拒掉，而不是等打开时才发现。
 *
 * 返回原文而不是 url.href 是关键：href 会把 `{q}` 编码成 `%7Bq%7D`，
 * 之后就再也替换不出查询词了。所以校验在「把占位符换成一个普通词」的副本上做。
 */
export function resolveEngineUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  // 没有占位符就无处填查询词，这种地址收下来只会打开一个固定页面
  if (!trimmed.includes(QUERY_TOKEN)) return null
  if (!/^https?:\/\//i.test(trimmed)) return null

  let url: URL
  try {
    url = new URL(trimmed.split(QUERY_TOKEN).join('starfallprobe'))
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return trimmed
}

export function isSafeEngineUrl(value: string): boolean {
  return resolveEngineUrl(value) !== null
}

/**
 * 把查询词填进地址模板；模板不合法或查询为空时返回 null。
 *
 * 打开前再验一次协议：模板来自 localStorage，用户可能手改过存档。
 * encodeURIComponent 之后再过一次 URL 构造器不会二次编码（%XX 原样保留），
 * 所以 `&` `#` 空格 中文都能安全落进查询串。
 */
export function buildSearchUrl(template: string, query: string): string | null {
  const safe = resolveEngineUrl(template)
  const trimmed = query.trim()
  if (!safe || !trimmed) return null

  const filled = safe.split(QUERY_TOKEN).join(encodeURIComponent(trimmed))
  try {
    const url = new URL(filled)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href
  } catch {
    return null
  }
}

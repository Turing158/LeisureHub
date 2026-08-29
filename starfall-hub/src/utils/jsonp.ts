import { CALLBACK_TOKEN, QUERY_TOKEN } from '@/types/search'

/**
 * JSONP 取数。
 *
 * **为什么只能用 JSONP。** 主流搜索建议接口全都不发 Access-Control-Allow-Origin
 * （已带 Origin 复测：百度 su / sugrec、Bing qsonhs、360 suggest、知乎 suggest 均无此头），
 * 所以 fetch / XHR 一律被浏览器拦掉。这不是实现偏好，是接口方定的。
 * Vite 的 dev proxy 解决不了——它只在 npm run dev 下有效，build 出来的静态站点
 * 没有服务端，线上照样撞 CORS，属于「开发时通了、部署后不通」的返工。
 *
 * 代价是真实的：**JSONP 等于执行第三方 JS**。所以：
 * - 只对内置引擎开放（自定义引擎不给建议，见 stores/settings 的 allEngines）
 * - 回调名带随机后缀，挂在一个独立命名空间下，用完立即删除并移除 script 节点
 * - onerror 与超时都要清理，否则失败的请求会在 window 上留一堆残留回调
 */

/** 独立命名空间，不往 window 顶层撒回调名 */
const NAMESPACE = '__starfallJsonp'

/** 端点无响应时的放弃时限；超过它用户早已继续打字了 */
const TIMEOUT_MS = 6000

type CallbackBag = Record<string, (payload: unknown) => void>

function bag(): CallbackBag {
  const scope = window as unknown as Record<string, CallbackBag | undefined>
  let existing = scope[NAMESPACE]
  if (!existing) {
    existing = {}
    scope[NAMESPACE] = existing
  }
  return existing
}

let seq = 0

/**
 * 发一次 JSONP 请求。
 *
 * 失败（网络错误 / 超时 / 端点返回的不是回调调用）一律 resolve 成 null 而不是
 * reject：调用方对这两种情况的处理完全相同（不出列表），而 reject 会要求每个
 * 调用点都写一遍 catch。
 *
 * template 里的 {q} 与 {cb} 由这里填：把「拼地址」留在同一处，
 * 各引擎的注册项只需声明模板。
 */
export function jsonp(template: string, query: string): Promise<unknown> {
  return new Promise((resolve) => {
    seq += 1
    const name = `cb${seq}_${Math.random().toString(36).slice(2, 8)}`
    const path = `${NAMESPACE}.${name}`

    const url = template
      .split(QUERY_TOKEN)
      .join(encodeURIComponent(query))
      .split(CALLBACK_TOKEN)
      .join(path)

    const script = document.createElement('script')
    let timer = 0

    /*
     * 幂等清理。
     *
     * 三条路径（成功 / onerror / 超时）都要走它，且可能重入：
     * 端点先回调再触发 load、或超时后响应才到，都会二次进来。
     */
    const cleanup = () => {
      if (timer) {
        clearTimeout(timer)
        timer = 0
      }
      delete bag()[name]
      script.remove()
    }

    bag()[name] = (payload: unknown) => {
      cleanup()
      resolve(payload)
    }

    script.onerror = () => {
      cleanup()
      resolve(null)
    }

    /*
     * load 之后回调仍没被调用，说明返回的不是一次回调调用（可能是纯 JSON、
     * 也可能是一段与约定不符的脚本）。此时不能立刻判失败——回调是同步执行的，
     * 但把判定推到下一个宏任务更稳妥，也顺便覆盖了「脚本里有 setTimeout」这类写法。
     */
    script.onload = () => {
      window.setTimeout(() => {
        if (!bag()[name]) return
        cleanup()
        resolve(null)
      }, 0)
    }

    timer = window.setTimeout(() => {
      cleanup()
      resolve(null)
    }, TIMEOUT_MS)

    script.src = url
    // referrerPolicy 收紧到只发源：建议端点不需要知道用户在看哪个页面
    script.referrerPolicy = 'origin'
    document.head.appendChild(script)
  })
}

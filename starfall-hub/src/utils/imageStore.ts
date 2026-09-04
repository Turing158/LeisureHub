/**
 * 本地背景图的二进制仓库（IndexedDB）。
 *
 * **为什么不继续用 localStorage 存 data URL**：改成「多张本地图」之后，原来那条
 * 「一张图 base64 塞进 settings 存档」的路走不通了——base64 把体积撑大约 1.33 倍，
 * 而 localStorage 全域只有 5MB 左右，还要和天气缓存、搜索记录、方格数据共享。
 * 三张 1.5MB 的照片就会让整份 settings 写不进去，表现为「加完图刷新就没了」。
 *
 * IndexedDB 存的是原始 Blob：没有编码膨胀，配额是按磁盘可用空间给的（通常几百 MB
 * 起），一组壁纸完全放得下。settings 里只留 { id, name } 这样的轻量索引，
 * 真正的字节按 id 存在这里，两边靠 id 对齐。
 *
 * 所有函数都不抛错：IndexedDB 在隐私模式 / 被策略禁用时会直接开不了库，
 * 那种情况下背景功能应当降级（本次会话内仍可用 objectURL，刷新后丢失），
 * 而不是让整个设置面板炸掉。
 */

const DB_NAME = 'starfall-hub'
const DB_VERSION = 1
const STORE = 'bg-images'

/** 单张图的字节上限。IDB 不像 localStorage 那样紧，但仍要挡住「误选一个 200MB 的 RAW」 */
export const LOCAL_IMAGE_MAX_BYTES = 8 * 1024 * 1024

let dbPromise: Promise<IDBDatabase | null> | null = null

/**
 * 打开（或首次建立）数据库；不可用时返回 null。
 *
 * 结果缓存在模块级：一次会话内只握一个连接，后续调用直接复用同一个 Promise。
 */
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }

    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      // Firefox 的隐私窗口里 open() 本身就会抛
      resolve(null)
      return
    }

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        // 主键就是 settings 里那个 id，不需要额外索引
        db.createObjectStore(STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    // 另一个标签页正在升级同一个库时会卡在 blocked，别无限等
    request.onblocked = () => resolve(null)
  })

  return dbPromise
}

/** 把一次事务包成 Promise；失败一律落到 reject 由调用方兜 */
function runTx<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null)
          return
        }
        try {
          const tx = db.transaction(STORE, mode)
          const request = body(tx.objectStore(STORE))
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve(null)
          tx.onabort = () => resolve(null)
        } catch {
          resolve(null)
        }
      }),
  )
}

/** 是否可用；UI 用它决定要不要提示「本次会话有效，刷新后丢失」 */
export async function isImageStoreReady(): Promise<boolean> {
  return (await openDb()) !== null
}

/** 写入一张图，返回是否成功 */
export async function putImage(id: string, blob: Blob): Promise<boolean> {
  const result = await runTx('readwrite', (store) => store.put(blob, id))
  // put 成功时 result 是主键（字符串），失败时是 null
  return result !== null
}

/** 读一张图；不存在或不可用时为 null */
export async function getImage(id: string): Promise<Blob | null> {
  const value = await runTx<Blob>('readonly', (store) => store.get(id) as IDBRequest<Blob>)
  return value instanceof Blob ? value : null
}

export async function deleteImage(id: string): Promise<void> {
  await runTx('readwrite', (store) => store.delete(id) as unknown as IDBRequest<undefined>)
}

/** 库里现存的全部 id，用于清理「settings 已删掉但字节还留着」的孤儿 */
export async function listImageIds(): Promise<string[]> {
  const keys = await runTx<IDBValidKey[]>(
    'readonly',
    (store) => store.getAllKeys() as IDBRequest<IDBValidKey[]>,
  )
  return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : []
}

/**
 * 把旧存档里的 data URL 转成 Blob。
 *
 * 走 fetch(dataURL) 而不是手写 atob：data URL 是合法的 fetch 输入，
 * base64 解码、MIME 解析、非 base64 的百分号编码变体全都由平台处理。
 */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob | null> {
  try {
    const response = await fetch(dataUrl)
    const blob = await response.blob()
    return blob.size > 0 ? blob : null
  } catch {
    return null
  }
}

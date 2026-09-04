import { ref } from 'vue'

import { useTodos, type TodoEntry } from './useTodos'

/**
 * 待办的写操作 + 撤销 / 提示浮条。
 *
 * 从 TodoWidget 原地抽出来的，因为 TodoDialog 要的是**同一套**行为：勾选不撤销、
 * 删一条与清空已完成都要撤销、写盘失败必须说出来。抄第二份的代价不是多几十行，
 * 而是这些取舍会各自漂移——比如某天有人只在方块里修了「提示与撤销互斥」，
 * 对话框里就仍然会两条浮条叠在一起。
 *
 * **每次调用返回独立的 undo / notice ref**（数据本身仍是 useTodos 的模块级共享）：
 * 方块与对话框可能同时在场，两者各自弹自己的浮条；共享一份会让在对话框里删一条
 * 顺带在方块那边也弹出一条。
 *
 * `live` 是取值函数而非布尔：预览态（Dialog 的实时预览、卡片列表）要照常渲染真实
 * 清单但禁掉一切写入，而那个标记是 prop、会变。收 getter 才能一直读到当下的值。
 */
export function useTodoActions(live: () => boolean = () => true) {
  const todos = useTodos()

  /**
   * 撤销浮条。
   *
   * 一条 entries 数组既装「删一条」也装「清空已完成」：restore 收数组
   * （单条只是长度为 1 的特例，理由见 useTodos.restore）。
   *
   * **后来的替换先来的**——两条撤销机会同时在场本身就是罕见状态，
   * 让它退化成「只能撤销最近一次」符合直觉，也避免两条浮条叠在一起。
   */
  const undo = ref<{ entries: TodoEntry[]; message: string } | null>(null)

  /** 新建被拒时的一句话提示。与撤销浮条共用浮层，但不带撤销按钮 */
  const notice = ref('')

  /**
   * 提示与撤销**互斥**：一条提示出现时把撤销机会收掉，反之亦然。
   * 同时挂两条会重合（UndoToast 是 position: fixed 的居中浮条）。
   */
  function say(message: string) {
    undo.value = null
    notice.value = message
  }

  /** 写盘失败必须说出来：它意味着「我打进去的东西下次打开就没了」 */
  function reportPersist() {
    if (!todos.persistError.value) return
    say('保存失败，浏览器存储可能已满')
    todos.clearPersistError()
  }

  function add(text: string, group: string | undefined) {
    if (!live()) return
    const result = todos.add(text, group)
    if (result === 'full') {
      say(`最多 ${todos.items.value.length} 条，先清理一些再加`)
      return
    }
    if (result === 'ok') reportPersist()
  }

  /** 勾选不需要撤销：它是可逆的，再点一下就回来了，条目还在原地 */
  function toggle(id: string) {
    if (!live()) return
    todos.toggle(id)
    reportPersist()
  }

  /**
   * 删一条 → 撤销浮条。
   *
   * 与 RecentSearches 的「删一条不确认」刻意不同：搜索记录可再生（再搜一次就有了），
   * 一条手打的「周五前把报销交了」删掉就没了，它和删掉一个方块同级。
   */
  function remove(id: string) {
    if (!live()) return
    const entry = todos.remove(id)
    // null = 同一条已被另一个方块（或对话框）删掉；此时没有可撤销的东西
    if (!entry) return
    notice.value = ''
    undo.value = { entries: [entry], message: `已删除「${entry.item.text}」` }
  }

  /** 清空已完成 → 同样走撤销：它一次删掉一批不可再生的数据 */
  function clearCompleted() {
    if (!live()) return
    const removed = todos.clearCompleted()
    if (removed.length === 0) return
    notice.value = ''
    undo.value = { entries: removed, message: `已清空 ${removed.length} 项已完成` }
  }

  function undoLast() {
    const pending = undo.value
    undo.value = null
    if (pending) todos.restore(pending.entries)
  }

  return { todos, undo, notice, add, toggle, remove, clearCompleted, undoLast }
}

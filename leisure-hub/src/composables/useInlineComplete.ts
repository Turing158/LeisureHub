import { ref } from 'vue'

/**
 * 内联补全（浏览器地址栏那种「打 vu → 补出 vue 且 e 为选中态」）。
 *
 * 做法本身只有两行：
 *
 *   input.value = suggestion
 *   input.setSelectionRange(typed.length, suggestion.length)
 *
 * 被选中的那截下一次按键会被直接覆盖，所以用户继续打字不受影响，按 → 或 End
 * 即接受补全（选区被取消就是接受，无需额外代码）。
 *
 * 真正的难点全在「什么时候**不能**做」，四道门禁缺一不可，逐条见下。
 * 独立成文件是为了能整体摘掉：它默认关闭，且是唯一一处与输入法正面接触的逻辑。
 */
export function useInlineComplete() {
  /** 输入法合成中 */
  const composing = ref(false)
  /** 最近一次 input 事件的 inputType，门禁二用 */
  let lastInputType = ''
  /** compositionend 之后的那一次 input 才允许补全，门禁一用 */
  let justComposed = false

  function onCompositionStart() {
    composing.value = true
  }

  function onCompositionEnd() {
    composing.value = false
    justComposed = true
  }

  /** 组件的 input 处理里调一次，把 inputType 记下来 */
  function noteInput(event: Event) {
    lastInputType = (event as InputEvent).inputType ?? ''
  }

  /**
   * 试着补全，返回是否真的补了。
   *
   * typed 是用户实际敲进去的内容（不含上一次补出来的部分），
   * 由调用方持有——本 composable 刻意不记它，那份状态与「↑↓ 预览后要还原的原文」
   * 是同一份，两处各存一份必然分叉。
   */
  function complete(el: HTMLInputElement | null, typed: string, suggestion: string): boolean {
    if (!el) return false

    /*
     * 门禁一：输入法合成期间绝对不能碰 value 或选区。
     *
     * 中文用户搜索时，整条查询几乎全程处于合成态（拼音还没上屏）。合成期间改
     * value 或调 setSelectionRange，各家输入法的反应不一致：候选框错位、
     * 已输入的拼音被吞、或者合成直接被强制提交。这不是优化，是中文场景下
     * 内联补全能否成立的前提。
     */
    if (composing.value) return false

    /*
     * 门禁二：只在「新增字符」后补全，删除后一律不补。
     *
     * 否则会撞上这个死循环：输入 vu → 补成 vue → 按退格删掉 e → 又补成 vue →
     * 用户永远删不掉最后一个字符。
     *
     * 判据取 InputEvent.inputType 而**不是**「新值比旧值长」——用户选中一段文字
     * 再粘贴更长的内容同样变长，但那不是逐字输入。
     *
     * insertCompositionText 是拼音上屏那一下；justComposed 让 compositionend 之后
     * 紧跟的那次 input（部分浏览器的 inputType 为空）也算进来，之后即失效。
     */
    const inserted =
      lastInputType === 'insertText' ||
      lastInputType === 'insertCompositionText' ||
      lastInputType === 'insertFromPaste' ||
      justComposed
    justComposed = false
    if (!inserted) return false

    /*
     * 门禁三：只在建议以已输入内容开头时补全（大小写不敏感）。
     *
     * 建议接口不保证返回前缀扩展。`vue` 可能返回「尚硅谷 vue 教程」——把它整条
     * 写进输入框，用户看到自己打的字被挪到了中间，光标不知在哪。
     * 不是前缀就只进列表，不进输入框。
     */
    if (!typed || suggestion.length <= typed.length) return false
    if (!suggestion.toLowerCase().startsWith(typed.toLowerCase())) return false

    /*
     * 门禁四：光标必须在末尾。
     *
     * 用户回头修改中间某个字时不能补全，否则补出来的那截会插在光标后面，
     * 把后半段文字顶掉。也要求当前没有选区（start === end）。
     */
    if (el.selectionStart !== typed.length || el.selectionEnd !== typed.length) return false
    // 值已经被别处改过（例如 ↑↓ 预览）时不补：此刻 typed 不再是框里的内容
    if (el.value !== typed) return false

    /*
     * 保留用户实际敲的那几个字形，只把补出来的部分接在后面。
     *
     * 不直接写 suggestion：大小写不敏感的前缀匹配下，「VU」可能匹配到「vue」，
     * 整条写进去会把用户敲的大写改成小写。
     */
    el.value = typed + suggestion.slice(typed.length)
    el.setSelectionRange(typed.length, el.value.length)
    return true
  }

  return { composing, onCompositionStart, onCompositionEnd, noteInput, complete }
}

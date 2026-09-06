<script setup lang="ts">
/**
 * 搜索方块。
 *
 * 与日历 / 天气同一套 widget 契约：占格形状决定版式（见 search/variant.ts），
 * 配置存在 WidgetTile.props 里，由右键「编辑」进 Dialog 修改。
 * 所以桌面上可以放多个，各自用不同引擎。
 *
 * **它是唯一一个要和拖拽状态机谈条件的 widget。** 输入框需要 pointerdown 来定位
 * 光标与选中文本——选字本身就是一次按下-拖动，不可能与「拖走方块」共用同一条
 * 手势。分工由 TileCell 判定（isInteractive 认 widgetId === 'search'）：
 * 输入框上的按下整体让给浏览器；方块其余部分照常发起拖拽，但走「软启动」
 * ——按下不立即 setPointerCapture，越过阈值才接管，否则引擎按钮与 chips 的
 * 原生 click 会被捕获吃掉（机制见 useDragSort 的 StartContext.deferCapture）。
 *
 * 右键同样要分开：输入框上放行浏览器原生菜单（复制 / 粘贴 / 全选比自绘的
 * 「编辑 / 删除」有用得多），方块其余部分仍出自绘菜单。分界靠输入框上的
 * `data-native-menu`。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import EngineChips from './search/EngineChips.vue'
import EngineIcon from './search/EngineIcon.vue'
import EngineMenu from './search/EngineMenu.vue'
import RecentSearches from './search/RecentSearches.vue'
import SuggestList from './search/SuggestList.vue'
import OverlayLayer from '../OverlayLayer.vue'
import { searchVariant, showsEngineToggle, showsHistory } from './search/variant'
import { useInlineComplete } from '@/composables/useInlineComplete'
import { useSearchHistory } from '@/composables/useSearchHistory'
import { useSuggest } from '@/composables/useSuggest'
import { useSettingsStore } from '@/stores/settings'
import { buildSearchUrl, SEARCH_SPAN_LIMITS as LIMITS } from '@/types/search'
import { clampSpan } from '@/types/tile'
import { isHexColor } from '@/utils/color'

const props = defineProps<{
  /**
   * 引擎 id，由 sanitizeWidgetProps 只验形状不验存在性。
   * 悬空（自定义引擎被删）时 resolveEngine 回退到默认引擎，方块仍可搜。
   */
  engineId?: string
  /**
   * 占格宽 / 高，由 TileWidget 透传。
   * 缺省按 1×1 处理，因此只覆写了 --content-size 的调用方也能渲染出 micro。
   */
  spanW?: number
  spanH?: number
  /**
   * 预览模式：Dialog 里的实时预览与卡片列表用。
   *
   * 预览里输入框只是个样子——真去搜索会在用户还在配置时打开新标签页，
   * 建议请求也会在每次改引擎时白发一轮。所以预览态禁用提交与取数，
   * 但**照常渲染**，用户看到的仍是落格后的版式与引擎图标。
   */
  preview?: boolean
  /** 方格底色；缺省沿用方格自身的玻璃底 */
  bgColor?: string
  /** 次要块面：上面一排引擎 chips、引擎键与清除钮的悬停底 */
  subBgColor?: string
  /** 主要文字：输入的内容、引擎键与清除钮的图标 */
  textColor?: string
  /** 次要文字：占位符、chips 名称、引擎 / 清除钮的次级文字 */
  subTextColor?: string
  /**
   * 建议列表面板底色。
   *
   * 与方块本身的四个色档刻意分开：建议列表是 Teleport 到 body 的独立浮层
   * （见 SuggestList 文件头），浮在桌面之上，跟方块的「主/次背景」不是同一面。
   * 缺省沿用主题的搜索面板令牌（--bg-search）。其余两个是 it 的文字与高亮底色。
   */
  suggestBgColor?: string
  /** 建议列表里的主要文字（建议词与搜索图标） */
  suggestTextColor?: string
  /** 建议列表里当前高亮那一项的底色 */
  suggestActiveColor?: string
}>()

const settings = useSettingsStore()

/** 版式只由占格高度决定（宽度的影响交给 flex），像素换算仍全在 CSS 里 */
const variant = computed(() => searchVariant(props.spanH))
/**
 * 引擎按钮**两档都画**：它是输入框左侧那个可点的引擎锚点，点开出完整列表。
 *
 * 曾只在 h=1 画、h=2 退成不可点的图标（理由详见 variant.ts 的 showsEngineToggle，
 * 那里已翻案）。两档手势一致更省心——用户把方块拉高后，点左侧图标依然能动引擎。
 */
const engineToggle = computed(() => showsEngineToggle(variant.value))
/** h=2 多出来的那八十来像素给「最近搜索」 */
const historyVisible = computed(() => showsHistory(variant.value))

/**
 * h=1 且只有 2 格宽时，chips 收成只有图标的一排。
 *
 * **这是唯一一处由宽度决定的取舍**，所以它不进 variant（那一层刻意只看高度，
 * 见 variant.ts）。理由是一笔量出来的账：2 格宽的 chips 只有 152px 可用，
 * 而四颗带名称的紧凑 chip 要 241px——后两颗被推到方格外面，而方格
 * `overflow: hidden`，「Google / 知乎」就此消失。去掉名称后四颗约 100px，全部落在内。
 *
 * 3 格起（249px 可用）四个名称装得下，那里就显示名称：名字比图标好认。
 * 用户加了自定义引擎后仍可能超出，那时靠横向滚动与引擎按钮兜住，
 * 与「内置四家都看不见」不是一个量级的问题。
 */
const chipsIconOnly = computed(
  () => variant.value === 'bar' && clampSpan(props.spanW, LIMITS.wMin, LIMITS.wMax) < 3,
)

const engine = computed(() => settings.resolveEngine(props.engineId))

/**
 * 颜色写成内联的 CSS 变量而非直接的 color / background，与日历 / 天气同构。
 *
 * 变量没被设上时，样式里的 `var(--sw-bg, <令牌>)` 自动回落到主题令牌，
 * 「未配置」与「配成当前主题色」因此是两种状态——前者跟着主题走。
 *
 * 仍要过一遍 isHexColor：这些值来自持久化数据，store 已校验过，这里是第二道。
 */
const colorStyle = computed(() => {
  const vars: Record<string, string> = {}
  const set = (name: string, value: string | undefined) => {
    if (isHexColor(value)) vars[name] = value
  }
  set('--sw-bg', props.bgColor)
  set('--sw-sub-bg', props.subBgColor)
  set('--sw-text', props.textColor)
  set('--sw-sub-text', props.subTextColor)
  return vars
})

/**
 * 建议列表面板的颜色变量，与 colorStyle 同一条校验约定。
 *
 * 独立成一组而不是并进 colorStyle：两组变量落在不同的元素上——
 * colorStyle 挂在方块的 .sw 上，建议列表是 Teleport 出去的浮层，只能由
 * SuggestList 自己承接。单独挂也能让「方块色」与「列表色」在脑子里分开，
 * 不把两套语义挤进同一个变量表。
 *
 * 以具名 prop 传给 SuggestList（见模板），SuggestList 把它和定位 rect 合并进
 * 同一个 :style——不做 fallthrough 隐式继承，那样依赖 Vue 的根属性合并，
 * 变量与定位中的坐标混在一起，后来人看不出哪份是哪份。
 */
const suggestStyle = computed(() => {
  const vars: Record<string, string> = {}
  const set = (name: string, value: string | undefined) => {
    if (isHexColor(value)) vars[name] = value
  }
  set('--suggest-bg', props.suggestBgColor)
  set('--suggest-text', props.suggestTextColor)
  set('--suggest-active', props.suggestActiveColor)
  return vars
})

/**
 * placeholder。
 *
 * 一律带上引擎名（`用百度搜索`）：那是这个方块与旁边那个搜索方块唯一的区别，
 * 值得占这几个字。最窄的一档是 2 格（170px），输入框约 110px，
 * 五个字在 12.75px 字号下约 64px，装得下。
 *
 * 曾经有一档只写「搜索」两个字，那是 w=1（52px 输入框）时的取舍；
 * 宽下限提到 2 之后那种形状不再可达。
 */
const placeholder = computed(() => `用${engine.value.name}搜索`)

const frameEl = ref<HTMLElement | null>(null)
const rowEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLInputElement | null>(null)
const toggleEl = ref<HTMLElement | null>(null)

/**
 * 用户实际敲进去的内容。
 *
 * 与输入框里此刻显示的内容**刻意分开**：`↑↓` 预览会把某条建议写进输入框，
 * 内联补全会在后面接一段选中的文字，两者都不改这一份。
 * 不存原文的话，用户按两下 ↓ 再想改回自己打的字，那段文字已经没了。
 */
const typed = ref('')

/**
 * 输入框此刻有没有内容，清除按钮的显隐跟着它走。
 *
 * input 的 value 不是响应式状态，总得有个东西替模板盯着。同步点只有两个：
 * writeInput 收口所有程序写入（↑↓ 预览、选中项回填、Esc 还原都经它），
 * onInput 收口所有用户编辑（含输入法上屏）。刻意不从 typed 派生：typed 是
 * 「用户敲进去的原文」，与框里**显示**的内容是两份状态——预览与补全会多出
 * 一截，按钮清的是显示出来的东西，就该跟着显示走。
 */
const hasContent = ref(false)

/** 建议列表高亮项；-1 是「无选中」态，它必须存在于循环里（见 onKeydown） */
const activeIndex = ref(-1)
const listOpen = ref(false)
const menuOpen = ref(false)
const menuRef = ref<InstanceType<typeof EngineMenu> | null>(null)

const suggest = useSuggest()
const inline = useInlineComplete()
/**
 * 搜索记录。
 *
 * **模块级共享**（见 useSearchHistory），所以桌面上几个搜索方块看到的是同一份。
 * 这里拿到的 items 是全量；渲染侧只在 h=2 那一档展示。
 */
const history = useSearchHistory()

/** 预览态不发请求、不打开结果页 */
const live = computed(() => props.preview !== true)

/** 内联补全依赖建议数据，建议关着时它无从发生 */
const inlineEnabled = computed(
  () => live.value && settings.suggestEnabled && settings.inlineCompleteEnabled,
)

const items = computed(() =>
  live.value && settings.suggestEnabled ? suggest.items.value : [],
)
const listVisible = computed(() => listOpen.value && items.value.length > 0)

/**
 * 展示用的记录列表。
 *
 * 关掉开关时给空数组而不是原样传下去：RecentSearches 那一档只渲染一句「已关闭」，
 * 但把真实内容仍传进组件意味着它躺在 DOM 之外的 props 里——关掉的意思是不显示，
 * 让数据到不了渲染层比依赖模板里的 v-if 更难出错。
 */
const historyItems = computed(() =>
  settings.searchHistoryEnabled ? history.items.value : [],
)

/**
 * 弹层的 id 前缀按方块实例区分。
 *
 * 桌面上可以有多个搜索方块，写死 'search-suggest' 会让多个 listbox 撞 id，
 * 于是 aria-activedescendant 指向的是第一个方块里的项。
 */
let seq = 0
const uid = `search-${(seq = Date.now() % 100000) + Math.floor(Math.random() * 1000)}`
const LIST_ID = `${uid}-list`
const OPTION_PREFIX = `${uid}-opt`

/* ── 弹层定位 ────────────────────────────────────────── */

/**
 * 建议列表的锚，就锚在**输入行**上，而不是整个方块。
 *
 * 建议是「输入框的下拉」，它该贴着输入行底缘展开；方块在 stack（h=2）档下面还有
 * 一排「最近搜索」，若锚到整块外框，列表会落到记录区下方，像与输入失去关联。
 * 所以这里测的是 .sw__row 的实测矩形——弹层跟着它走，宽也硬绑它的 width。
 *
 * 单测输入行还有一层好处：列表所在的面与输入行同宽，不会因为占格宽度不同而错位。
 * 行宽随颗数（方块 2..4 格）与拖拽浮层缩放变化，写死任何数字都会在别的场景下错位。
 */
const rect = ref({ left: 0, top: 0, bottom: 0, width: 0 })

function measure() {
  const el = rowEl.value
  if (!el) return
  const box = el.getBoundingClientRect()
  rect.value = { left: box.left, top: box.top, bottom: box.bottom, width: box.width }
}

let observer: ResizeObserver | null = null

onMounted(() => {
  measure()
  const el = rowEl.value
  if (el) {
    observer = new ResizeObserver(measure)
    observer.observe(el)
  }
  /*
   * 网格滚动或窗口变化都会让方块移位，弹层必须跟着走。
   * scroll 用捕获阶段：真正滚动的是 .grid-scroll，事件不冒泡到 window。
   */
  window.addEventListener('resize', measure)
  window.addEventListener('scroll', measure, true)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  window.removeEventListener('resize', measure)
  window.removeEventListener('scroll', measure, true)
})

/** 引擎菜单的锚点矩形：按钮自身，而不是整个方块 */
const anchor = ref({ left: 0, top: 0, bottom: 0 })

function openMenu() {
  const el = toggleEl.value
  if (!el) return
  const box = el.getBoundingClientRect()
  anchor.value = { left: box.left, top: box.top, bottom: box.bottom }
  menuOpen.value = true
}

/**
 * 关掉菜单，并先摘掉它的全局监听。
 *
 * 只置 menuOpen = false 不够：退场过渡期间组件还挂着，它捕获阶段的 pointerdown
 * 会把用户紧接着的一次点击吞掉。这与 ContextMenu 里 requestClose 先 detach
 * 再 emit 是同一个理由，只是那边由自己触发、这边由父组件触发。
 */
function closeMenu() {
  menuRef.value?.detach()
  menuOpen.value = false
}

function toggleMenu() {
  if (menuOpen.value) closeMenu()
  else openMenu()
}

/* ── 搜索 ────────────────────────────────────────────── */

function currentValue(): string {
  return inputEl.value?.value ?? typed.value
}

/**
 * 打开结果页。
 *
 * noopener,noreferrer 与 TileGrid.activate() 打开链接的写法一致：
 * 前者切断 window.opener（否则目标页能反向操作本页），后者不泄漏来源地址。
 */
function submit(query: string) {
  if (!live.value) return
  const url = buildSearchUrl(engine.value.url, query)
  // 空输入 / 纯空格 / 引擎地址不合法：什么都不做，不弹提示
  if (!url) return
  /*
   * 记录只在**真的搜出去了**之后写，而不是在按下回车时。
   *
   * 上面那个 `!url` 分支会拦掉空输入与不合法的引擎地址，那两种情况没有发生过搜索，
   * 记下来只会在下方的「最近搜索」里留一条点了也没用的词。
   *
   * 关掉记录开关时不写：那条开关的意思是「不要在桌面上留下我搜过什么」，
   * 只是不显示而照旧存进 localStorage 的话，那不是关闭，是隐藏。
   */
  if (settings.searchHistoryEnabled) history.push(query)
  closeList()
  window.open(url, '_blank', 'noopener,noreferrer')
}

/* ── 列表状态 ────────────────────────────────────────── */

function closeList() {
  listOpen.value = false
  activeIndex.value = -1
}

/** 把输入框内容写回某个值，同时把光标收到末尾 */
function writeInput(value: string) {
  const el = inputEl.value
  if (!el) return
  el.value = value
  el.setSelectionRange(value.length, value.length)
  hasContent.value = value.length > 0
}

/**
 * 移动高亮，并把选中那条**写进输入框**。
 *
 * 循环里必须经过「无选中」态（-1），不能让 ↓ 在首末项之间打转：
 * 用户按 ↑ 想回到自己打的字时，需要一个能回去的位置。
 * 这与 ContextMenu.move() 的纯模运算不同——那里没有输入框要回退。
 */
function move(delta: number) {
  const list = items.value
  if (list.length === 0) return

  const count = list.length
  const from = activeIndex.value
  // -1 .. count-1 共 count+1 个位置，模 count+1 后减一即回到含 -1 的区间
  const next = ((from + 1 + delta + count + 1) % (count + 1)) - 1

  activeIndex.value = next
  writeInput(next < 0 ? typed.value : list[next])
}

/**
 * 离开预览态：把用户原文写回输入框，回到「无选中」。
 *
 * 用户在 ↑↓ 选中某条之后继续打字，应当**以自己打的字为基础续打**，
 * 而不是在那条建议后面接着写——预览只是「按回车会搜什么」的展示。
 * 不还原的话，`vu` → ↓（显示 vue）→ 打 `x` 会得到 `vuex`，而用户以为在打 `vux`。
 *
 * 还原后不阻止本次输入：光标已被 writeInput 收到原文末尾，
 * 浏览器紧接着把这一次的字符插在那里，正好是「续打」。
 */
function leavePreview(): boolean {
  if (activeIndex.value < 0) return false
  activeIndex.value = -1
  writeInput(typed.value)
  return true
}

/**
 * 一键清除。
 *
 * 与 Esc 的「清空输入」分支同一套动作（typed、输入框、建议一起清），外加
 * 收起列表：点击那一刻焦点还在输入框，列表可能正摊着。清完把焦点还回输入框
 * ——清空几乎总是为了重新输入，与 chooseEngine 的处理一致。
 * 预览态不必另设门禁：submit 与取数本来就被 live 挡住，清的只是个样子。
 */
function clearQuery() {
  typed.value = ''
  writeInput('')
  suggest.clear()
  closeList()
  inputEl.value?.focus()
}

/* ── 事件 ────────────────────────────────────────────── */

/**
 * beforeinput 是唯一能在「值被改动之前」介入的时机。
 *
 * 不放在 keydown 里判断可打印键：那要自己枚举一堆按键，且漏掉粘贴、
 * 拖入文本、以及输入法把候选提交进来的路径。
 *
 * insertCompositionText 交给 compositionstart 处理——合成已经开始之后再改 value
 * 正是 useInlineComplete 门禁一列出的那件不能做的事。
 */
function onBeforeInput(event: InputEvent) {
  if (event.inputType === 'insertCompositionText') return
  leavePreview()
}

function onInput(event: Event) {
  inline.noteInput(event)
  const el = event.target as HTMLInputElement
  typed.value = el.value
  hasContent.value = el.value.length > 0
  // 兜一道：beforeinput 已经把预览态退掉了，这里只保证状态一致
  activeIndex.value = -1

  if (!live.value || !settings.suggestEnabled) {
    listOpen.value = false
    return
  }

  // 清空立刻收起，不等请求回来
  if (!el.value.trim()) {
    listOpen.value = false
    suggest.clear()
    return
  }

  listOpen.value = true
  suggest.schedule(engine.value, el.value)
}

/**
 * 新建议到达时试一次内联补全。
 *
 * 挂在 items 上而不是塞进 useSuggest 的回调里：补全的四道门禁要读输入框的
 * 实时状态（选区、value、合成态），那是组件的事，composable 不该持有 DOM。
 */
watch(items, (list) => {
  if (!inlineEnabled.value || !listOpen.value) return
  if (activeIndex.value >= 0) return
  const first = list[0]
  if (!first) return
  inline.complete(inputEl.value, typed.value, first)
})

/**
 * 输入法开始合成。
 *
 * 先退出预览态再交给 useInlineComplete：合成一旦开始就不能再改 value
 * （门禁一），所以还原原文必须发生在这一刻，不能等到 input。
 */
function onCompositionStart() {
  leavePreview()
  inline.onCompositionStart()
}

function onKeydown(event: KeyboardEvent) {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      // 列表已有内容但被收起过（Esc 之后）：先展开，不要求重打一遍
      if (!listOpen.value && items.value.length > 0) {
        listOpen.value = true
        activeIndex.value = -1
      }
      move(1)
      break

    case 'ArrowUp':
      event.preventDefault()
      if (!listOpen.value && items.value.length > 0) {
        listOpen.value = true
        activeIndex.value = -1
      }
      move(-1)
      break

    case 'Enter': {
      event.preventDefault()
      const picked = activeIndex.value >= 0 ? items.value[activeIndex.value] : undefined
      submit(picked ?? currentValue())
      break
    }

    /*
     * Esc 一层层退，且只在真的处理了才 stopPropagation。
     *
     * 现有 ContextMenu / SettingsDrawer / AddTileDialog 的 Esc 处理都在 window 上
     * 并带 stopPropagation。这里不拦的话，用户按 Esc 想关抽屉会先被搜索框吃掉一次；
     * 反过来，无条件拦下则会让「搜索框空着时按 Esc 关抽屉」失效。
     */
    case 'Escape':
      if (listVisible.value) {
        event.stopPropagation()
        closeList()
        writeInput(typed.value)
        return
      }
      if (currentValue()) {
        event.stopPropagation()
        typed.value = ''
        writeInput('')
        suggest.clear()
        return
      }
      break

    // 搜索方块不是模态，Tab 只收列表，焦点正常离开
    case 'Tab':
      closeList()
      break
  }
}

/** 点列表项提交。用 pointerdown 而非 click：click 之前会先发生 blur */
function onPick(index: number) {
  const text = items.value[index]
  if (text === undefined) return
  writeInput(text)
  typed.value = text
  submit(text)
}

/**
 * 悬停只改高亮、不写输入框。
 *
 * 悬停是探索性动作，用户只是移过去看看；把内容写进输入框会让人以为已经选中了它。
 * 与 ContextMenu 的 @mouseenter="activeIndex = i" 一致。
 */
function onHover(index: number) {
  activeIndex.value = index
}

function onFocusOut(event: FocusEvent) {
  // 焦点还在方块内部（点了引擎按钮 / chip / 记录）时不收列表
  const next = event.relatedTarget as Node | null
  if (next && frameEl.value?.contains(next)) return
  closeList()
}

/* ── 最近搜索 ────────────────────────────────────────── */

/**
 * 点一条记录：**直接搜，不只是填进输入框**。
 *
 * 这些词已经被搜过一次，点它的意图几乎总是「再搜一遍」；只填进去还要再按一次回车。
 * 顺带把 typed 同步好——用户若改主意接着改这个词，是以它为基础续打（与 onPick 一致）。
 *
 * submit 里会把它重新 push 一次，于是刚点过的词浮到最前，这正是记录该有的顺序。
 */
function onHistoryPick(text: string) {
  writeInput(text)
  typed.value = text
  activeIndex.value = -1
  submit(text)
}

/**
 * 删一条 / 清空。
 *
 * 都不做确认：记录是可再生的（再搜一次就回来了），而 12 条的量级不值得一个弹窗。
 * 与删方块那条走 UndoToast 的路径不同——方块是用户配出来的东西，丢了要重配。
 */
function onHistoryDrop(text: string) {
  history.remove(text)
}

function onHistoryClear() {
  history.clear()
}

/**
 * 换引擎。
 *
 * 通过 emit 上报而不是直接写 props：引擎存在这个方块的 WidgetTile.props 里，
 * 只有 store 能改。TileGrid 收到后走 updateTile，与右键编辑同一条写入路径。
 */
const emit = defineEmits<{ 'update-engine': [id: string] }>()

function chooseEngine(id: string) {
  closeMenu()
  emit('update-engine', id)
  inputEl.value?.focus()
}

/*
 * 引擎变了就重新取一次建议：旧结果属于上一个引擎。
 * 挂在 engine 上而不是写进 chooseEngine：props 是由外部（store）改的，
 * 这个方块也可能因为「用户删掉了那条自定义引擎」而被动换引擎。
 */
watch(engine, () => {
  if (live.value && settings.suggestEnabled && typed.value.trim()) {
    suggest.schedule(engine.value, typed.value)
  } else {
    suggest.clear()
    closeList()
  }
})

/* 建议被关掉时立刻清干净：残留的列表会在下次聚焦时凭空冒出来 */
watch(
  () => settings.suggestEnabled,
  (enabled) => {
    if (enabled) return
    suggest.clear()
    closeList()
  },
)
</script>

<template>
  <!--
    输入框上的 data-native-menu：useContextMenu 的 resolve 见到它就返回 null，
    放行浏览器原生右键菜单——复制 / 粘贴 / 全选比自绘的「编辑 / 删除」有用得多。
    方块的其余部分（外框留白、引擎图标、chips）不带这个标记，右键仍出编辑菜单。

    拖拽的分工同样由 TileCell 判定（isInteractive 认 widgetId === 'search'）：
    输入框上的按下让给浏览器，其余部分软启动拖拽，这里不需要额外标记。
  -->
  <div ref="frameEl" class="sw" :class="`sw--${variant}`" :style="colorStyle">
    <div ref="rowEl" class="sw__row">
      <button
        v-if="engineToggle"
        ref="toggleEl"
        class="sw__engine"
        type="button"
        data-engine-toggle
        :aria-label="`搜索引擎：${engine.name}`"
        :aria-expanded="menuOpen"
        aria-haspopup="menu"
        @click="toggleMenu"
      >
        <EngineIcon :name="engine.icon" />
      </button>
      <!-- 引擎按钮两档都画（见 engineToggle），这里不剩不可点的图标分支 -->

      <input
        ref="inputEl"
        class="sw__input"
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        data-native-menu
        :placeholder="placeholder"
        :aria-label="`用${engine.name}搜索`"
        :aria-controls="LIST_ID"
        :aria-expanded="listVisible"
        :aria-autocomplete="inlineEnabled ? 'both' : 'list'"
        :aria-activedescendant="activeIndex >= 0 ? `${OPTION_PREFIX}-${activeIndex}` : undefined"
        @input="onInput"
        @beforeinput="onBeforeInput"
        @keydown="onKeydown"
        @compositionstart="onCompositionStart"
        @compositionend="inline.onCompositionEnd"
        @focusout="onFocusOut"
      />

      <!--
        一键清除。只有框里有内容才渲染（显隐见 hasContent）——v-if 而不是
        v-show 加过渡：它跟着打字节奏一闪一灭，退场动画只会让人等。

        手势与引擎按钮同一条分工：按住拖走是软启动拖拽，原地松手是原生 click
        （见文件头）。右键也不带 data-native-menu，与引擎按钮一样出自绘菜单。
      -->
      <button
        v-if="hasContent"
        class="sw__clear"
        type="button"
        aria-label="清空搜索内容"
        @click="clearQuery"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            stroke="currentColor"
            stroke-linecap="round"
            stroke-width="1.8"
            d="M6 6l12 12M18 6L6 18"
          />
        </svg>
      </button>
    </div>

    <!--
      引擎条**两档都出现**。

      h=1 那 75px 里，输入行 32px、chips 22px、上下内边距各 5px、一道 4px 的缝，
      合计 68——四个引擎一直摆在外面，比藏进下拉菜单少一次点击。那一档传
      `wrap: false` 与 `compact`：不换行（换行会被方格的 overflow 裁掉）、
      行高与字号各降一档；2 格宽时再加 `icon-only`，理由见 chipsIconOnly。

      h=2 用默认档：可换行、标准行高，装不下时在内部纵向滚动。
    -->
    <EngineChips
      class="sw__chips"
      :engines="settings.allEngines"
      :current-id="engine.id"
      :wrap="variant !== 'bar'"
      :compact="variant === 'bar'"
      :icon-only="chipsIconOnly"
      @select="chooseEngine"
    />

    <!--
      h=2 下方的第二块内容。

      预览态也照常渲染：用户在配置对话框里要看到的正是「这一档下面会多出什么」。
      它读的是同一份模块级记录，预览里点一条同样会搜——那由 submit 的 live 门禁挡住。
    -->
    <RecentSearches
      v-if="historyVisible"
      class="sw__recent"
      :items="historyItems"
      :enabled="settings.searchHistoryEnabled"
      @pick="onHistoryPick"
      @drop="onHistoryDrop"
      @clear="onHistoryClear"
    />

    <!-- 弹层必须 Teleport 到 body：方格自身 overflow: hidden，留在里面会被裁掉 -->
    <OverlayLayer name="suggest">
      <SuggestList
        v-if="listVisible"
        :items="items"
        :active-index="activeIndex"
        :rect="rect"
        :list-id="LIST_ID"
        :id-prefix="OPTION_PREFIX"
        :suggest-style="suggestStyle"
        @pick="onPick"
        @hover="onHover"
      />
    </OverlayLayer>

    <OverlayLayer name="engine-menu">
      <EngineMenu
        v-if="menuOpen"
        ref="menuRef"
        :anchor="anchor"
        :engines="settings.allEngines"
        :current-id="engine.id"
        @select="chooseEngine"
        @close="menuOpen = false"
      />
    </OverlayLayer>
  </div>
</template>

<style scoped>
/*
 * 尺寸基准与日历 / 天气同一套换算、同一条回落链：
 *   --sw-w / --sw-h  真实宽高，由 TileCell 的 --square-w / --square-h 继承而来。
 *   --sw-size        短边。
 *
 * 注意：拖拽浮层把 --tile-size 设成 min(w, h)，所以一律不得直接读它，
 * 只能读这几个别名，否则浮层里非正方形的方块会变形。
 */
.sw {
  --sw-w: var(--square-w, var(--content-size, var(--tile-size)));
  --sw-h: var(--square-h, var(--content-size, var(--tile-size)));
  --sw-size: var(--content-size, var(--tile-size));
  /* 内边距随短边缩：最窄的 2×1 上 12px 会把输入框挤掉近四分之一 */
  --sw-pad: clamp(6px, calc(var(--sw-size) * 0.14), 12px);

  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  padding: var(--sw-pad);
  gap: var(--sw-pad);
  border-radius: inherit;
  /*
   * 卡片背景走「主要背景」档；未配置时保持透明，透出方格自身的玻璃底——
   * 与日历 / 天气的 --cal-bg / --wx-bg 同一套回落契约。
   */
  background: var(--sw-bg, transparent);
  /*
   * 方块已可整体拖拽，从留白起手的拖动不该顺带选中沿途的文字
   * （chips 名、记录词、标题）。输入框要选字，单独放开。
   */
  user-select: none;
}

/*
 * 输入行。
 *
 * flex: none 且高度由内容决定——输入框绝不随格高拉伸：h=2 有 196px，
 * 一个那么高的单行输入框没有任何合理形态。多出来的高度交给下面两块内容。
 */
.sw__row {
  display: flex;
  min-width: 0;
  flex: none;
  align-items: center;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--r-full);
  /* 输入行是浮在卡片上的次级面板：卡片走主要背景，这一行走次要背景 */
  background: var(--sw-sub-bg, var(--fill));
  transition: border-color var(--dur-fast) var(--ease);
}

/* 聚焦态与 .field__input 的写法一致，不引入第三种输入框语言 */
.sw__row:focus-within {
  border-color: var(--focus);
}

/*
 * 引擎按钮。
 *
 * 悬停底色**铺满左侧整段**，而不只是那颗图标：按钮 stretch 到输入行的满高，
 * 左缘贴输入行，右缘顶到输入框的 border-left 分隔线——hover 时从行的左侧圆角
 * 到分隔线这一整段都是高亮面（圆角由 .sw__row 的 radius + overflow: hidden 裁掉）。
 * 图标仍按宽 clamp 出的短边居中，不进歧义：命中区也随满高变大。
 */
.sw__engine {
  position: relative;
  display: grid;
  align-self: stretch;
  width: clamp(22px, calc(var(--sw-size) * 0.4), 32px);
  flex: none;
  color: var(--sw-text, var(--color-text-dim));
  place-items: center;
  transition:
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.sw__engine svg {
  width: 60%;
  height: 60%;
}

.sw__engine:hover {
  /* hover 高亮面走次要背景：chips、悬停块同属 sub-bg 语义 */
  background: var(--sw-sub-bg, var(--fill-raised));
  color: var(--color-text);
}

.sw__engine:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

/*
 * 输入框。
 *
 * 左边那条竖线画在自己的 border-left 上，而不是插一个空元素：
 * 多一个节点就要给它 aria-hidden，而 border-left 天生不进无障碍树。
 */
.sw__input {
  min-width: 0;
  flex: 1;
  height: clamp(28px, calc(var(--sw-size) * 0.42), 38px);
  padding: 0 var(--sp-2);
  border: none;
  border-left: 1px solid var(--line-subtle);
  background: none;
  color: var(--sw-text, var(--color-text));
  font-size: clamp(11px, calc(var(--sw-size) * 0.17), 15px);
  /* 外框已经给了聚焦描边，输入框自己再来一道会是两层框 */
  outline: none;
  /* 方块整体 user-select: none（见 .sw），选字是输入框的本职，在这里放开 */
  user-select: text;
}

.sw__input::placeholder {
  /* 占位符是次级文字：配了 sub-text 就跟着换，否则回落主题 */
  color: var(--sw-sub-text, var(--color-text-faint));
}

/*
 * 清除按钮。
 *
 * 尺寸、悬停底色、命中区补法照抄引擎按钮——同一行里的两个圆钮该长一个样，
 * 图标比例（60%）也与 .sw__engine svg 对齐。不画分隔线：它是输入框自己的
 * 清除缀（浏览器搜索框里那个 × 的身份），不是与引擎按钮平级的第三个分区；
 * 显隐由 v-if 决定，出现时输入框的 flex: 1 自然让出这一份宽度。
 */
.sw__clear {
  position: relative;
  display: grid;
  width: clamp(22px, calc(var(--sw-size) * 0.4), 32px);
  height: clamp(22px, calc(var(--sw-size) * 0.4), 32px);
  flex: none;
  border-radius: var(--r-full);
  color: var(--sw-text, var(--color-text-dim));
  place-items: center;
  transition:
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.sw__clear svg {
  width: 60%;
  height: 60%;
}

/* 视觉尺寸之外把命中区域补到 44px，与 .sw__engine::after 同一个手法 */
.sw__clear::after {
  position: absolute;
  content: '';
  inset: -6px;
}

.sw__clear:hover {
  background: var(--sw-sub-bg, var(--fill-raised));
  color: var(--color-text);
}

.sw__clear:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

/* ── 各版式的局部取舍 ───────────────────────────────── */

/*
 * bar（h=1）：75px 里塞两条带，每一个像素都得算出来。
 *
 * 账目按最紧的那一种算——**起了名字的方块**，可用高 75（square-h 是 75，
 * square-w 至少 170，--sw-size 取短边得 75）。这一档所有宽度同账，
 * 2×1 与 6×1 的垂直排布逐像素相同：
 *   可用高          75
 *   上下内边距      5 × 2   = 10
 *   一道缝          4
 *   输入行          30 + 上下边框 2 = 32（引擎按钮 clamp 出 30px，与输入框同高）
 *   chips           紧凑档 min-height 22
 *   合计 10 + 4 + 32 + 22 = 68，余 7 由 justify-content: center 分到上下。
 *
 * **没起名字的方块这一档是 101px**：方格长到名称行的位置（见 TileCell 的
 * --label-block），--sw-size 随之变成 101，几个 clamp() 各跳一档——输入框字号
 * 12.75 → 15px、引擎按钮 30 → 32px。但上面那份账的总高不变（输入行高度在这一档
 * 写死 30px，不吃 clamp），余量从 7 涨到 33，仍由 center 分到上下。
 * 两种高度都装得下，无名那一档只是字大一号、留白多一些。
 *
 * 所以内边距与缝**不能沿用 --sw-pad**（有名那一档解析为 10.5px，上下加缝就是 31.5px，
 * 剩 43.5px 装不下 32 + 22）。这一档改用给死的小值。
 *
 * 也因此这一档**不再是「整块方格就是搜索框」**。此前输入行铺满方格、不画自己的面，
 * 理由是「圆角方块里再套一个圆角胶囊」表达的是同一件事；现在下面多了一条 chips，
 * 输入框必须有一条自己的边界才分得清哪里是输入、哪里是引擎——与 stack 同一个理由。
 */
.sw--bar {
  padding: 5px 8px;
  gap: 4px;
  /*
   * 内容总高小于可用高时，余量分到上下两端而不是堆在底部。
   * 与 stack 的置顶刻意不同：这一档只有 7px 余量，居中读作「两条带的留白」，
   * 置顶则会在底部留一条白边，像是没画完。
   */
  justify-content: center;
}

/*
 * 输入行在这一档矮一档。
 *
 * clamp 的中项按有名那一档的 --sw-size（75）算出 31.5px，与上面那份账一致，
 * 这里把它写死：那个 clamp 是给「短边随格宽变化」的档位用的，而这一档的短边只有
 * 75（有名）与 101（无名）两种，写死之后两者的输入行同高——否则无名那一档会
 * clamp 到 38px，与上面那份账不再对得上。
 */
.sw--bar .sw__input {
  height: 30px;
}

/*
 * chips 在这一档**不许收缩**。
 *
 * flex: none 而不是 0 1 auto：可收缩的话，输入行 + chips 一旦超出可用高度，
 * flexbox 会去压 chips（它是唯一可压的），22px 被压到十几像素、文字被裁掉一半。
 * 宁可让它保持 22px——上面那份账已经保证装得下。
 */
.sw--bar .sw__chips {
  flex: none;
}

/*
 * stack（h=2）：整组置顶，余量全部留给下方的「最近搜索」。
 *
 * 与此前的整组居中刻意分道。居中是「只有输入行 + 引擎区」时的取舍：那时余量有
 * 八十来像素，堆在任何一端都是一条刺眼的白边，分到上下两端最不显眼。
 * 现在下方有了真正的内容，余量不再是余量——它是记录区的地方。
 *
 * 顶部间距由 --sw-pad（这一档解析为 12px）给出，不额外加：方块四边的留白应当
 * 是同一个值，单独把上边加厚会让输入行看起来没对齐。
 */
.sw--stack {
  justify-content: flex-start;
}

/*
 * 引擎区在这一档封顶两行（26 × 2 + 4 的缝 = 56），超出部分内部纵向滚动。
 *
 * 不让它按内容自然增高：引擎最多 16 条（内置 4 + 自定义 12），在 2 格宽里能排到
 * 五六行，那会把记录区挤成零高。封顶之后「记录区有多大」只由格高决定，
 * 不随用户加了几条自定义引擎变化。
 */
.sw--stack .sw__chips {
  max-height: 56px;
  flex: none;
}
</style>

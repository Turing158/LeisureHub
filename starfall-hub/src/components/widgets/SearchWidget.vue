<script setup lang="ts">
/**
 * 搜索方块。
 *
 * 与日历 / 天气同一套 widget 契约：占格形状决定版式（见 search/variant.ts），
 * 配置存在 WidgetTile.props 里，由右键「编辑」进 Dialog 修改。
 * 所以桌面上可以放多个，各自用不同引擎。
 *
 * **它是唯一一个内部要吃掉指针的 widget。** 输入框需要 pointerdown 来定位光标与
 * 选中文本，而 TileCell 的 .tile-cell__square 上挂着 useDragSort 的 setPointerCapture。
 * 两者落在同一块区域上必然互斥，所以这个方块整体退出拖拽（判据在 TileCell 的
 * isInteractive），换位靠把别的方块拖过来挤位置、或在右键编辑框里改尺寸。
 *
 * 右键同样要分开：输入框上放行浏览器原生菜单（复制 / 粘贴 / 全选比自绘的
 * 「编辑 / 删除」有用得多），方块其余部分仍出自绘菜单——否则一个退出了拖拽的
 * 方块就再也没有任何配置入口。分界靠输入框上的 `data-native-menu`。
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
}>()

const settings = useSettingsStore()

/** 版式只由占格高度决定（宽度的影响交给 flex），像素换算仍全在 CSS 里 */
const variant = computed(() => searchVariant(props.spanH))
/**
 * 引擎按钮只在 h=1 画。
 *
 * 两档都摊开了 chips，但 h=1 那一档的 chips 不能换行、溢出时靠横向滚动而滚动条
 * 被藏起来，所以按钮留着当完整列表（理由详见 variant.ts 的 showsEngineToggle）。
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
 * 外框的实测矩形。
 *
 * 弹层的宽度硬绑这里的 width：方块可以是 2..4 格宽，而它还会被拖拽浮层、
 * Dialog 预览等场景缩放，写死任何数字都会在别的场景下错位。
 */
const rect = ref({ left: 0, top: 0, bottom: 0, width: 0 })

function measure() {
  const el = frameEl.value
  if (!el) return
  const box = el.getBoundingClientRect()
  rect.value = { left: box.left, top: box.top, bottom: box.bottom, width: box.width }
}

let observer: ResizeObserver | null = null

onMounted(() => {
  measure()
  const el = frameEl.value
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
    方块的其余部分（外框留白、引擎图标、chips）不带这个标记，右键仍出编辑菜单，
    否则一个退出了拖拽的方块就再也没有配置入口了。

    退出拖拽这件事由 TileCell 判定（isInteractive 认 widgetId === 'search'），
    这里不需要额外标记。
  -->
  <div ref="frameEl" class="sw" :class="`sw--${variant}`">
    <div class="sw__row">
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

      <!--
        h=2 不给按钮，只留一个不可点的图标当前缀。
        那一档的 chips 会换行并在内部滚动，全部引擎都够得着，按钮就成了
        同一个选择的第二处入口。h=1 的 chips 不能换行，所以那一档留着按钮。
      -->
      <span v-else class="sw__mark" aria-hidden="true">
        <EngineIcon :name="engine.icon" />
      </span>

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
  background: var(--fill);
  transition: border-color var(--dur-fast) var(--ease);
}

/* 聚焦态与 .field__input 的写法一致，不引入第三种输入框语言 */
.sw__row:focus-within {
  border-color: var(--focus);
}

/*
 * 引擎按钮 / 图标。
 *
 * 尺寸按短边缩，与输入框同高，两者因此在圆角胶囊里居中成一行。
 */
.sw__engine,
.sw__mark {
  display: grid;
  width: clamp(22px, calc(var(--sw-size) * 0.4), 32px);
  height: clamp(22px, calc(var(--sw-size) * 0.4), 32px);
  flex: none;
  border-radius: var(--r-full);
  color: var(--color-text-dim);
  place-items: center;
}

.sw__engine svg,
.sw__mark svg {
  width: 60%;
  height: 60%;
}

.sw__engine {
  position: relative;
  transition:
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

/*
 * 视觉尺寸之外把命中区域补到 44px。
 * 与 SettingsDrawer 的 .close::after 同一个手法（那里是 34px 视觉 + inset: -5px）。
 */
.sw__engine::after {
  position: absolute;
  content: '';
  inset: -6px;
}

.sw__engine:hover {
  background: var(--fill-raised);
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
  font-size: clamp(11px, calc(var(--sw-size) * 0.17), 15px);
  /* 外框已经给了聚焦描边，输入框自己再来一道会是两层框 */
  outline: none;
}

.sw__input::placeholder {
  color: var(--color-text-faint);
}

/* ── 各版式的局部取舍 ───────────────────────────────── */

/*
 * bar（h=1）：75px 里塞两条带，每一个像素都得算出来。
 *
 * 账目。h=1 的 --sw-size 恒为 75（square-h 是 75，square-w 至少 170，取短边），
 * 所以**这一档所有宽度同账**，2×1 与 6×1 的垂直排布逐像素相同：
 *   可用高          75
 *   上下内边距      5 × 2   = 10
 *   一道缝          4
 *   输入行          30 + 上下边框 2 = 32（引擎按钮 clamp 出 30px，与输入框同高）
 *   chips           紧凑档 min-height 22
 *   合计 10 + 4 + 32 + 22 = 68，余 7 由 justify-content: center 分到上下。
 *
 * 所以内边距与缝**不能沿用 --sw-pad**（这一档解析为 10.5px，上下加缝就是 31.5px，
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
 * clamp 的中项按 --sw-size（75）算出 31.5px，与上面那份账一致，这里只把它写死：
 * 那个 clamp 是给「短边随格宽变化」的档位用的，而 h=1 的短边恒定，
 * 留着一个算出来永远是同一个数的公式，只会让下一个人以为它还会变。
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

<script setup lang="ts">
/**
 * 待办方块。
 *
 * 与日历 / 天气 / 搜索同一套 widget 契约：占格形状决定版式（见 todo/variant.ts），
 * 四档颜色存在 WidgetTile.props 里，由右键「编辑」进 Dialog 修改。
 *
 * **但清单数据不在 props 里**，走模块级共享的 useTodos + 独立 storage key
 * （理由见 useTodos 的文件头，最硬的一条是「方块删掉时 props 一起没了」）。
 * 于是桌面上可以放多个待办方块，各是同一份数据的不同切面——一格 1×1 当计数器，
 * 一格 3×4 展开完整清单。
 *
 * 它是 isInteractive 的**第二例**（第一例是搜索）：内容自己吃指针，
 * 所以注册表里写 interactive: true，TileCell 据此走「软启动」拖拽而不是整体退出。
 * 新建输入行上另挂 data-native-menu，右键出浏览器原生菜单（粘贴一条待办比自绘的
 * 「编辑 / 删除」有用得多），方块其余部分仍出自绘菜单。
 */
import { computed, nextTick, ref } from 'vue'

import CompletedSection from './todo/CompletedSection.vue'
import TodoInput from './todo/TodoInput.vue'
import TodoRail from './todo/TodoRail.vue'
import TodoRow from './todo/TodoRow.vue'
import {
  hasGroups,
  hasInput,
  opensOnTileClick,
  railHasHistory,
  todoVariant,
} from './todo/variant'
import OverlayLayer from '../OverlayLayer.vue'
import UndoToast from '../UndoToast.vue'
import { useTodoActions } from '@/composables/useTodoActions'
import { isHexColor } from '@/utils/color'

const props = defineProps<{
  /** 方格底、count 的数字区、grouped 的内容区背景；缺省沿用方格自身的玻璃底 */
  bgColor?: string
  /** 计数条、输入行胶囊、已完成折叠头、latest 的计数徽标 */
  subBgColor?: string
  /** 待办正文、count 的数字、输入的内容 */
  textColor?: string
  /** 计数条文案、分组标题、占位符、已完成项正文、rail 的空心点 */
  subTextColor?: string
  /** 占格宽 / 高，由 TileWidget 透传；缺省按 1×1 处理（拖拽浮层与卡片列表不传） */
  spanW?: number
  spanH?: number
  /**
   * 预览模式：Dialog 的实时预览与卡片列表。
   *
   * 照常渲染真实清单——用户在配置对话框里要看到的正是「这一档会长什么样」，
   * 而占位假数据会让配色预览失真。但**一切写操作在这一档禁用**：
   * 在配置对话框里手滑勾掉一条，改的是真实数据，而那个对话框里没有撤销入口。
   */
  preview?: boolean
}>()

const emit = defineEmits<{
  /**
   * 请求打开完整待办对话框。
   *
   * 只上报意图，对话框由 TileGrid 挂载——浮层的宿主一律是网格那一层
   * （AddTileDialog、右键菜单、名称提示都在那里），方块自己挂一个模态
   * 会让每个待办方块各持一份对话框状态，两个方块就能同时打开两个。
   */
  'open-todos': []
}>()

/**
 * 写操作与撤销浮条走共享的组合式函数。
 *
 * 原先这些函数写在本文件里，现在与 TodoDialog 共用同一份——那边要的是完全一样的
 * 取舍（勾选不撤销、删除与清空要撤销、写盘失败必须说出来），抄第二份的真正代价是
 * 这些取舍会各自漂移。
 *
 * live 传 getter 而不是布尔：preview 是 prop、会变，收取值函数才一直读到当下的值。
 */
const { todos, undo, notice, add, toggle, remove, clearCompleted, undoLast } = useTodoActions(
  () => props.preview !== true,
)

/** 版式由占格形状唯一决定，像素换算仍全在 CSS 里 */
const variant = computed(() => todoVariant(props.spanW, props.spanH))
const showsInput = computed(() => hasInput(variant.value))
const showsGroups = computed(() => hasGroups(variant.value))

/**
 * rail 档底部那块「近七天完成柱」画不画（1×3 / 1×4 画，1×2 不画）。
 *
 * 判据留在 variant.ts 而不是写在 TodoRail 里：那个文件是「占格 → 版式」的唯一
 * 入口，rail 内部再读一次 spanH 就有了第二处按占格分档的地方。
 */
const showsHistory = computed(() => railHasHistory(props.spanW, props.spanH))

/**
 * 整块可点（宽=1 的四档）。
 *
 * 预览态里恒为 false：卡片列表与编辑预览里点一下不该弹出一个模态。
 */
const clickOpens = computed(
  () => props.preview !== true && opensOnTileClick(props.spanW, props.spanH),
)

/*
 * 颜色写成内联的 CSS 变量而非直接的 color / background，与日历 / 天气 / 搜索同构。
 *
 * 变量没被设上时，样式里的 `var(--td-bg, <令牌>)` 自动回落到主题令牌，
 * 「未配置」与「配成当前主题色」因此是两种状态——前者跟着主题走。
 *
 * 仍要过一遍 isHexColor：这些值来自持久化数据，store 已校验过，这里是第二道。
 */
const colorStyle = computed(() => {
  const vars: Record<string, string> = {}
  const set = (name: string, value: string | undefined) => {
    if (isHexColor(value)) vars[name] = value
  }
  set('--td-bg', props.bgColor)
  set('--td-sub-bg', props.subBgColor)
  set('--td-text', props.textColor)
  set('--td-sub-text', props.subTextColor)
  return vars
})

/* ── 计数条与可读文案 ────────────────────────────────── */

/**
 * 计数文案。三个状态各有各的句子，**绝不显示空白**——这是 RecentSearches 那条
 * 「三个状态每个都有文案」的纪律：一片空白看起来像坏了。
 */
const countText = computed(() =>
  todos.activeCount.value === 0 ? '已清空' : `${todos.activeCount.value} 项未完成`,
)

/**
 * 可读名由内容提供，而非外层 aria-label。
 *
 * TileCell 对 widget 刻意不写 aria-label，否则按钮名会盖掉这里的内容，
 * 读屏只听得到「待办」而听不到还剩几件。八个版式各自把装饰性内容标 aria-hidden，
 * 唯一的可读摘要始终是这一句 .sr-only。
 */
const summary = computed(() => {
  const done = todos.completedCount.value
  const base = todos.activeCount.value === 0 ? '待办：已清空' : `待办：${countText.value}`
  return done === 0 ? base : `${base}，已完成 ${done} 项`
})

/* ── 焦点 ────────────────────────────────────────────── */

const rootEl = ref<HTMLElement | null>(null)
const inputRef = ref<InstanceType<typeof TodoInput> | null>(null)

/**
 * 所有可聚焦行（复选框），按 DOM 顺序。
 *
 * **收起的已完成折叠区里那些要排除掉。** 那个面板折叠时仍在 DOM 里，靠 inert 移出
 * 焦点序列（见 CompletedSection 的第三个坑），而 querySelectorAll 照样找得到它们。
 * 不过滤的话，「输入行按 ↑ 回到最后一行」会去 focus() 一个 inert 元素——
 * 那是空操作，焦点留在输入框里，看起来像这个键没接。
 */
function focusables(): HTMLElement[] {
  const root = rootEl.value
  if (!root) return []
  return [...root.querySelectorAll<HTMLElement>('[data-todo-focus]')].filter(
    (el) => el.closest('[inert]') === null,
  )
}

/**
 * ↑ / ↓ 在行间移动焦点。
 *
 * **不做循环**（到底就停）：这个列表可以滚动，循环会让「按到底」变成一次莫名的
 * 跳回顶部。焦点在最后一行按 ↓ 落到输入行，输入行按 ↑ 回到最后一行——
 * 两者是同一条纵向序列。
 */
function onListKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  /*
   * 输入行自己处理这两个键（↑ 回最后一行，↓ 不接），这里必须放它过去。
   *
   * 不放的话会双重处理：TodoInput 的 @keydown.up 已经把焦点移到了最后一行，
   * 同一个事件随即冒泡到这里，此时 activeElement 已经是那一行，于是又往上走一格
   * ——按一次 ↑ 跳两行。判 target 而不是判 activeElement，因为后者此刻已经变了。
   */
  if ((event.target as HTMLElement | null)?.closest('input[type="text"]')) return

  const list = focusables()
  const at = list.indexOf(document.activeElement as HTMLElement)
  if (at < 0) return
  event.preventDefault()

  const next = at + (event.key === 'ArrowDown' ? 1 : -1)
  if (next < 0) return
  if (next >= list.length) {
    // 越过最后一行：落到输入行（没有输入行的档就停在原地）
    inputRef.value?.focus()
    return
  }
  list[next].focus()
}

/** 输入行按 ↑：回到列表最后一行 */
function onInputUp() {
  const list = focusables()
  list[list.length - 1]?.focus()
}

/**
 * Esc 且输入已空：把焦点从输入行摘掉。
 *
 * plan 里写的是「把焦点交还方块」，但可交互方块的方格根节点**没有 tabindex**
 * （TileCell 对 isInteractive 的方块把 role / tabindex 都置为 undefined，
 * 焦点顺序交给内部控件），focus() 到一个不可聚焦的元素是空操作。
 * 所以这里如实地 blur——焦点回到 body，Esc / 方向键随即落到网格那一层，
 * 这正是「交还」想要的结果。
 */
function onInputEscape() {
  const active = document.activeElement
  if (active instanceof HTMLElement) active.blur()
}


/** 新建后让焦点留在输入行：连续录入不用来回点 */
async function onSubmitted(text: string, group: string | undefined) {
  add(text, group)
  await nextTick()
  inputRef.value?.focus()
}

/* ── 打开完整清单 ─────────────────────────────────────── */

/**
 * 整块点击（宽=1 的四档）。
 *
 * 挂 click 而不是 pointerdown：拖拽状态机靠 pointerdown/up 的位移判定点击与拖拽，
 * 在 pointerdown 上开对话框会让「想拖走这个方块」变成「弹出对话框」。原生 click
 * 只在没被 setPointerCapture 重定向时到达这里，而 interactive 方块走的正是
 * deferCapture（越过 5px 阈值才捕获），于是「按下没动就松手」= click、
 * 「按下拖动」= 拖拽，两者天然分开。
 */
function onRootClick() {
  if (!clickOpens.value) return
  emit('open-todos')
}

/**
 * 整块可点那四档补上键盘入口。
 *
 * TileCell 对 interactive 方块把 role / tabindex 都置为 undefined（焦点顺序交给
 * 内部控件），而 count / rail 里**没有任何内部控件**——不补的话这四档从键盘完全
 * 到不了。所以由这里自己挂一个 button 语义的透明层，而不是回头去改 TileCell 的
 * interactive 判据（那会连带影响搜索方块）。
 */
function onOpenKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  emit('open-todos')
}
</script>

<template>
  <!--
    ↑↓ 的处理挂在根节点而不是 .td__body 上：可聚焦的行不止列表里那些，
    已完成折叠区是 .td__body 的**兄弟节点**，挂在 body 上时从折叠区里按 ↓
    事件根本到不了处理函数（实测「最后一行 ↓ 落到输入行」因此不成立）。
    根节点是这条纵向序列唯一的公共祖先。
  -->
  <div
    ref="rootEl"
    class="td"
    :class="[`td--${variant}`, { 'td--clickable': clickOpens }]"
    :style="colorStyle"
    @keydown="onListKeydown"
    @click="onRootClick"
  >
    <!-- 唯一的可读摘要；各版式的装饰内容一律 aria-hidden（理由见 summary 的注释） -->
    <span class="sr-only">{{ summary }}</span>

    <!-- ── count：1×1，只有数字 + 标签 ─────────────── -->
    <template v-if="variant === 'count'">
      <div class="td__big" aria-hidden="true">
        <span class="td__num">{{ todos.activeCount.value }}</span>
        <span class="td__cap">{{ todos.activeCount.value === 0 ? '已清空' : '未完成' }}</span>
      </div>
    </template>

    <!-- ── latest：h=1，最近一条 + 计数徽标，只读 + 可勾选 ─── -->
    <template v-else-if="variant === 'latest'">
      <div class="td__one">
        <!--
          activeCount === 0 时正文位置显示「没有待办」，复选框与徽标都不画：
          三个状态每个都有文案，绝不显示空白。
        -->
        <template v-if="todos.latest.value">
          <input
            class="td__box"
            type="checkbox"
            data-todo-focus
            :aria-label="todos.latest.value.text"
            :checked="false"
            @change="toggle(todos.latest.value!.id)"
          />
          <span class="td__oneText" :title="todos.latest.value.text">{{
            todos.latest.value.text
          }}</span>
          <span class="td__badge" aria-hidden="true">{{ todos.activeCount.value }}</span>
        </template>
        <span v-else class="td__oneText td__oneText--empty">没有待办</span>
      </div>
    </template>

    <!-- ── rail：w=1 且 h≥2，计数 + 点阵（+ h≥3 的完成柱），纯只读 ── -->
    <TodoRail
      v-else-if="variant === 'rail'"
      :active-count="todos.activeCount.value"
      :active="todos.active.value"
      :completed="todos.completed.value"
      :show-history="showsHistory"
      :span-h="props.spanH"
    />

    <!-- ── list / grouped：计数条 + 列表 + 输入行 ───── -->
    <template v-else>
      <div class="td__bar" aria-hidden="true">
        <span class="td__barText">{{ countText }}</span>
        <!-- list 档不放折叠区，只用一句静态文字报数（折叠头要 24px，那一档给不出） -->
        <span v-if="!showsGroups && todos.completedCount.value > 0" class="td__barDone">
          已完成 {{ todos.completedCount.value }}
        </span>
      </div>

      <div class="td__body">
        <!-- 空清单同样有文案，不留白 -->
        <p v-if="todos.activeCount.value === 0" class="td__empty">
          在下面加一条，或用「组名: 内容」分组
        </p>

        <!--
          grouped 档按组分节；全部条目都未分组时**不画任何标题**——
          只有一个组的时候标题是纯噪音（见 §4）。
        -->
        <template v-else-if="showsGroups">
          <section v-for="group in todos.groups.value" :key="group.key" class="td__group">
            <h4 v-if="todos.groups.value.length > 1" class="td__groupHead">{{ group.label }}</h4>
            <TodoRow
              v-for="item in group.items"
              :key="item.id"
              :item="item"
              @toggle="toggle"
              @remove="remove"
            />
          </section>
        </template>

        <!-- list 档是扁平清单；组名不丢，跟在行内的徽标里 -->
        <TodoRow
          v-for="item in todos.active.value"
          v-else
          :key="item.id"
          :item="item"
          show-group
          @toggle="toggle"
          @remove="remove"
        />
      </div>

      <CompletedSection
        v-if="showsGroups && todos.completedCount.value > 0"
        :items="todos.completed.value"
        @toggle="toggle"
        @remove="remove"
        @clear="clearCompleted"
      />

      <TodoInput
        v-if="showsInput"
        ref="inputRef"
        @submit="onSubmitted"
        @up="onInputUp"
        @escape="onInputEscape"
      />
    </template>

    <!--
      打开完整清单的入口，两种形态：

      - clickOpens（宽=1 的四档）：整块已经可点，这里只补一个**键盘可达**的透明按钮。
        那四档没有任何内部控件，而 TileCell 对 interactive 方块不挂 role / tabindex，
        不补的话它们从键盘完全到不了。它绝对定位、不占布局，视觉上不可见。
      - 其余三档：右上角一个看得见的进入图标。那些档整块不可点（会与复选框、
        删除钮、输入行抢），所以入口必须是一个明确的小靶子。

      两者都不进 latest 档的正文流：图标绝对定位在右上角，与徽标错开 4px。
    -->
    <button
      v-if="clickOpens"
      class="td__openKey"
      type="button"
      aria-label="打开完整待办"
      @keydown="onOpenKeydown"
    />
    <button
      v-else-if="preview !== true"
      class="td__enter"
      type="button"
      aria-label="打开完整待办"
      @click.stop="emit('open-todos')"
      @keydown="onOpenKeydown"
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <!-- 「向外展开」的箭头：右上角斜箭头 + 一个缺角的框，与「进入 / 放大」同一个惯例 -->
        <path
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"
        />
      </svg>
    </button>

    <!--
      浮条走 OverlayLayer（Teleport 到 body）而不是留在方块内部：
      方块 overflow: hidden 会把它整条裁掉。
    -->
    <OverlayLayer name="toast">
      <UndoToast
        v-if="undo"
        :message="undo.message"
        action-label="撤销"
        @action="undoLast"
        @close="undo = null"
      />
      <UndoToast v-else-if="notice" :message="notice" @close="notice = ''" />
    </OverlayLayer>
  </div>
</template>

<style scoped>
/*
 * 三个尺寸别名，照日历 / 搜索那套三级回落。
 *
 * **拖拽浮层把 --tile-size 设成 min(w, h)，所以一律不得直接读它**，
 * 只能读这几个别名，否则浮层里非正方形的方块会变形。
 */
.td {
  --td-w: var(--square-w, var(--content-size, var(--tile-size)));
  --td-h: var(--square-h, var(--content-size, var(--tile-size)));
  /*
   * 行高 30px **写死，不按高度算**。
   *
   * 同一个占格形状有两个高度（起名 196 / 没起名 222 在 h=2，差 26px），
   * calc(var(--td-h) * 系数) 在两档上给出的结果差 13%。那 26px 的差额一律交给
   * 「露出几行」去吸收（列表 overflow-y: auto 天然吸收它），而不是让每一行都变高。
   * 于是「2×2 露 3 行」是**保底**而非上限：没起名那一档能露 4 行。
   */
  --td-row: 30px;

  /* .sr-only 是绝对定位的，没有定位祖先时会逃到初始包含块（Dialog 预览里就没有） */
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  /* 未配置时 --td-bg 未定义，透出方格自身的玻璃底 */
  background: var(--td-bg, transparent);
  border-radius: inherit;
  /*
   * user-select 只关掉装饰部分。输入框要能选中文本，那是 isInteractive 的前提，
   * 所以下面单独放开——写在这里而不是给每个装饰元素各写一遍。
   */
  user-select: none;
}

.td :is(input, textarea) {
  user-select: text;
}

/* 整块可点那四档给出指针提示；其余三档整块仍是默认光标 */
.td--clickable {
  cursor: pointer;
}

/* ── 打开完整清单的两个入口 ─────────────────────── */

/*
 * clickOpens 四档的键盘入口：铺满整块但完全不可见。
 *
 * 不用 .sr-only（那是 1px + clip-path，聚焦时焦点环缩成一个点看不见）。
 * 铺满 + opacity 为 0 让焦点环沿方块内边画出来，键盘用户看得见自己在哪。
 * pointer-events: none 是关键——指针点击必须落到 .td 的 @click 上，
 * 否则这一层会把 click 吃掉而 stopPropagation 与右键菜单的判定都要跟着改。
 */
.td__openKey {
  position: absolute;
  border-radius: inherit;
  inset: 0;
  opacity: 0;
  pointer-events: none;
}

/* 焦点环内描：方块 overflow: hidden，贴边的外描会被裁掉 */
.td__openKey:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
  opacity: 1;
}

/*
 * 其余三档右上角的进入图标。
 *
 * 常显而不做 hover 才出现，与 TodoRow 的删除钮同一条理由：触屏上没有 hover 可言，
 * 而它是这些档唯一的对话框入口，藏起来等于打不开。
 *
 * 降到 0.5 不透明度让它退到背景里——它是一个次要入口，不该和正文抢。
 * 图标色留在主题令牌上而不接 --td-* 配色：它是控件不是展示面，配错色不该让入口消失
 * （与复选框的勾、删除钮同一条纪律）。
 *
 * **内缩 10px 而不是 4px：方格圆角会把贴角的按钮切掉一块。**
 * 方格半径是 `min(--content-size * 0.22, 26px)`（TileCell），且 `.is-widget` 上开了
 * overflow: hidden。按钮左上角点距方格角 (t, t) 时落在圆弧之内的条件是
 * `2(R−t)² ≤ R²`，即 `t ≥ R(1 − 1/√2) ≈ 0.293R`；R 取上限 26px 时门槛是 7.6px，
 * 原来的 4px 因此必然被切（越大的方格越明显——半径先随短边长，到 26px 才封顶）。
 * 取 10px 而不是刚好过线的 8px：按钮自身还有 6px 圆角要留余量，而 10px 正好等于
 * list / grouped 两档的内容内边距，图标于是落在内容框的右上角而不是浮在圆弧里。
 */
.td__enter {
  position: absolute;
  z-index: 2;
  top: 10px;
  right: 10px;
  display: grid;
  width: 20px;
  height: 20px;
  border-radius: var(--r-sm);
  color: var(--color-text-faint);
  opacity: 0.5;
  place-items: center;
  transition:
    opacity var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.td__enter svg {
  width: 11px;
  height: 11px;
}

.td__enter:hover {
  background: var(--fill-hover);
  color: var(--color-text);
  opacity: 1;
}

.td__enter:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
  opacity: 1;
}

/*
 * 三档各自把右上角那块让给图标。
 *
 * latest（h=1）的正文行右端有计数徽标；list 的计数条右端有「已完成 n」。
 * grouped 不需要——它的计数条右端是空的，那一档的「已完成」在底部折叠头里。
 *
 * 让位写在**被压的那个元素**上而不是把图标挪走：右上角是这个入口的固定位置，
 * 三档一致才认得出来；而每一档谁在右上本来就不同。
 *
 * 数值随图标内缩到 10px 一起加大 6px（图标左边缘从距方格右沿 24px 移到 30px）：
 * 让位量是按「图标左边缘再往左留一点余量」定的，图标一挪，这些就必须跟着挪，
 * 否则刚修好的重叠会原样回来。
 */
.td--latest .td__one {
  padding-right: 34px;
}

.td--list .td__bar {
  padding-right: 28px;
}

/* 触屏命中区提到 30px，与 TodoRow 的删除钮同步；让位的量跟着放大 */
@media (pointer: coarse) {
  .td__enter {
    width: 30px;
    height: 30px;
  }

  .td--latest .td__one {
    padding-right: 42px;
  }

  .td--list .td__bar {
    padding-right: 38px;
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  border: 0;
  margin: -1px;
  padding: 0;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* ── count（1×1） ──────────────────────────────── */

.td__big {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
}

/*
 * 数字是这一档的绝对主角，吃掉没起名时多出来的那 26px 也没问题
 * （日历的 micro 档同样如此，两档字号不同不构成问题）。
 * clamp 的两端按短边收敛，上界 34px 在 101px 高里不会顶到标签。
 */
.td__num {
  color: var(--td-text, var(--color-text));
  font-size: clamp(22px, calc(var(--td-h) * 0.34), 34px);
  font-variant-numeric: tabular-nums;
  font-weight: 300;
  line-height: 1;
}

/* 标签固定 11px，不跟着高度变：它只是数字的单位说明 */
.td__cap {
  color: var(--td-sub-text, var(--color-text-faint));
  font-size: 11px;
  line-height: 1;
}

/* ── latest（h=1，w≥2） ────────────────────────── */

/*
 * 横向账（w=2，170px）：
 *   padding 8 + 复选框 14 + gap 8 + 正文 flex + gap 8 + 徽标 ~24 + padding 8
 * 纵向不放输入行：h=1 那 75px 装完这一行已无余量（SearchWidget 的 .sw--bar
 * 已经证明这一档有多紧）。所以 latest 是**只读 + 可勾选**，它不需要键盘。
 */
.td__one {
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  padding: 0 8px;
  gap: 8px;
}

.td__oneText {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--td-text, var(--color-text));
  font-size: var(--fs-sm);
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.td__oneText--empty {
  color: var(--td-sub-text, var(--color-text-disabled));
}

/* 计数徽标走次要背景 + 次要文字，与计数条同一档 */
.td__badge {
  flex: none;
  padding: 2px 7px;
  border-radius: var(--r-full);
  background: var(--td-sub-bg, var(--fill));
  color: var(--td-sub-text, var(--color-text-faint));
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
}

/* latest 的复选框与 TodoRow 里那个同形；样式重复一小段换取两处互不牵连 */
.td__box {
  width: 14px;
  height: 14px;
  flex: none;
  appearance: none;
  border: 1.5px solid var(--line-strong);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}

.td__box:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

@media (pointer: coarse) {
  .td__box {
    width: 18px;
    height: 18px;
  }
}

/* ── list / grouped ───────────────────────────── */

.td--list,
.td--grouped {
  /* 四边留白同一个值，与 SearchWidget 的 --sw-pad 同一条纪律 */
  padding: 10px;
  gap: 6px;
}

/* 计数条 18px，是纵向账里的固定占用 */
.td__bar {
  display: flex;
  height: 18px;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
}

.td__barText,
.td__barDone {
  overflow: hidden;
  color: var(--td-sub-text, var(--color-text-faint));
  font-size: var(--fs-xs);
  letter-spacing: 0.03em;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * 内容区吃掉固定占用之外的全部余量，内部滚动。
 *
 * flex: 1 + min-height: 0 而不是 flex: none：条目一多时必须是内部滚动，
 * **方块外部尺寸不变**——给 none 的话列表会把输入行顶出方格。
 */
.td__body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow-y: auto;
  scrollbar-color: rgb(255 255 255 / 0.18) transparent;
  scrollbar-width: thin;
}

.td__empty {
  margin: 0;
  color: var(--td-sub-text, var(--color-text-disabled));
  font-size: var(--fs-xs);
  line-height: 1.5;
}

.td__group {
  display: flex;
  flex: none;
  flex-direction: column;
}

/*
 * 分组标题 20px，比行高 30 矮：标题只有文字没有复选框，
 * 矮一点让它读起来是「一层」而不是「一条」。
 *
 * 吸顶——滚到第三组时还知道自己在看哪组。sticky 需要一个不透明的底，
 * 否则下面滚过的行会从字缝里透出来；用主背景而非次要背景，
 * 让它读起来是内容区的一部分而不是一条独立的面板。
 */
.td__groupHead {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 20px;
  flex: none;
  margin: 0;
  padding: 0 2px;
  background: var(--td-bg, var(--surface-2));
  color: var(--td-sub-text, var(--color-text-faint));
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: 0.03em;
  line-height: 20px;
}
</style>

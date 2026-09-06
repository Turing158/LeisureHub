<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'

import ContextMenu from './ContextMenu.vue'
import DragLayer from './DragLayer.vue'
import OverlayLayer from './OverlayLayer.vue'
import TileCell from './TileCell.vue'
import TileNameTip from './TileNameTip.vue'
import UndoToast from './UndoToast.vue'
import AddTileDialog from './dialog/AddTileDialog.vue'
import TodoDialog from './dialog/TodoDialog.vue'
import { useContextMenu, type MenuItem } from '@/composables/useContextMenu'
import { gridGeometry } from '@/composables/useAreaViewport'
import { useDragSort } from '@/composables/useDragSort'
import { useGridMetrics } from '@/composables/useGridMetrics'
import { useTileFlip } from '@/composables/useTileFlip'
import { useGridStore } from '@/stores/grid'
import { tileSpan, type Tile, type TileDraft } from '@/types/tile'
import { activeProfilePreset } from '@/utils/profileKey'

const emit = defineEmits<{
  /** 菜单里的「设置」：抽屉归 App 管，这里只上报意图 */
  'open-settings': []
}>()

const store = useGridStore()
/** 当前档位同时决定网格几何与触摸交互方式；切档会 reload，因此这里取一次即可。 */
const profilePreset = activeProfilePreset()

/**
 * 网格元素是方块区域本身；外层滚动容器是它的可用空间上限。
 *
 * 两个都要传给 useGridMetrics：设置里给了固定尺寸后网格不再铺满，
 * 「按当前画面」需要问的是容器还剩多大，而不是网格现在多大。
 */
const scrollEl = ref<HTMLElement | null>(null)
const gridEl = ref<HTMLElement | null>(null)
const { metrics, areaStyle } = useGridMetrics(gridEl, scrollEl)

/*
 * 竖向滚轮转横向。
 *
 * 只在「有横向溢出、且没有纵向溢出」时接管：此时用户手上的滚轮本来什么都推不动，
 * 却看得见右侧还有内容。两个方向都能滚时不接管，否则会抢掉正常的纵向滚动；
 * 按住 Shift 是浏览器自带的横向滚动手势，也让给它。
 */
function onWheel(event: WheelEvent) {
  const el = scrollEl.value
  if (!el || event.shiftKey || event.deltaY === 0) return

  const canX = el.scrollWidth - el.clientWidth > 1
  const canY = el.scrollHeight - el.clientHeight > 1
  if (!canX || canY) return

  event.preventDefault()
  el.scrollLeft += event.deltaY
}

// 区域尺寸变化 → 重算行列 → store 增减槽位
// 必须等测量就绪：未挂载时反解出的是 1×1，照着 resize 会把方块全挤进 overflow
watch(
  () => [metrics.value.ready, metrics.value.cols, metrics.value.rows] as const,
  ([ready, cols, rows]) => {
    if (ready) store.resize(cols, rows)
  },
  { immediate: true },
)

/** 每个槽位的方格元素，供拖拽命中检测使用 */
const cellRefs = ref<InstanceType<typeof TileCell>[]>([])

/**
 * 需要渲染的格子：锚点 + 真空位。
 *
 * 被大方块覆盖的槽位不产生元素——它们在 slots 里本就是 null，
 * 渲染出来会在大方块上叠一层可点击的空格。
 */
const cells = computed(() =>
  store.slots.flatMap((tile, index) => {
    const owner = store.coverage[index]
    if (owner !== null && owner !== index) return []
    const span = tile ? tileSpan(tile) : { w: 1, h: 1 }
    return [
      {
        index,
        tile,
        w: span.w,
        h: span.h,
        col: index % store.cols,
        row: Math.floor(index / store.cols),
      },
    ]
  }),
)

/** Dialog 目标槽位；null 表示未打开 */
const dialogIndex = ref<number | null>(null)
/** 有值即为编辑模式，Dialog 只显示预填的对应类型表单 */
const editingTile = ref<Tile | undefined>(undefined)
/** 关闭 Dialog 后把焦点还回触发的方格 */
let lastTrigger: HTMLElement | null = null

/**
 * 完整待办对话框是否打开。
 *
 * 布尔而非「目标槽位」：它展示的是模块级共享的那一份清单（见 useTodos），
 * 与哪一格无关——从 1×1 那格打开和从 3×4 那格打开，看到的是同一个东西。
 * 宿主在这里而不在方块里，所以桌面上放几个待办方块都只有一个对话框。
 */
const todoDialogOpen = ref(false)

/**
 * 浮层展示的内容在拖拽激活时快照。
 * 落位阶段 store 已提交交换，slots[from] 已换成另一个方块，
 * 若浮层直接读 store，飞行中的内容会突变。
 */
const layerTile = shallowRef<Tile | null>(null)

/*
 * 换位动画。
 *
 * 观测对象是网格元素：受影响的方块都在它里面，而换位只改 grid-column / grid-row，
 * 不测量就只能看到瞬移。
 */
const flip = useTileFlip(gridEl)

const drag = useDragSort({
  preset: profilePreset,
  // 按 slot index 定长取，被覆盖的槽位没有元素，返回 null 由命中检测跳过
  getSlotElements: () =>
    Array.from(
      { length: store.slots.length },
      (_, i) => cellRefs.value[i]?.squareEl ?? null,
    ),
  /*
   * 网格几何：列行数 + 相邻锚点的步长。
   *
   * 步长横纵不等——纵向每格还多一条名称行，两轴共用一个值会让行号越算越偏，
   * 大方块朝上 / 下就挪不动。与 useGridMetrics / TileCell 的 cellH 同构。
   */
  getGridGeometry: () => {
    const { gap, cellW, cellH } = gridGeometry.value
    return {
      cols: store.cols,
      rows: store.rows,
      stepX: cellW + gap,
      stepY: cellH + gap,
    }
  },
  onDragStart: (index) => (layerTile.value = store.slots[index]),
  onDragEnd: () => (layerTile.value = null),
  resolveDrop: (from, to) => {
    const tile = store.slots[from]
    if (!tile) return to
    const span = tileSpan(tile)
    return store.resolvePlacement(to, span.w, span.h).anchor
  },
  onCommit: (from, to) => store.moveTile(from, to),
  beforeCommit: () => flip.capture(),
  // 被拖的那个方块由浮层飞过去，这里跳过，免得同一元素上叠两个动画
  afterCommit: () => flip.play(layerTile.value ? [layerTile.value.id] : []),
  onClick: (index) => activate(index),
})

/**
 * 落点指示：把悬停格夹成合法落位后画出完整区域。
 *
 * 不能沿用「给目标 TileCell 加 class」的老做法——拖 2×2 时目标格可能是 1×1 的空格，
 * 高亮出来的范围会小于真实落点。
 */
const dropHint = computed(() => {
  if (!drag.isDragging.value) return null
  const to = drag.hoverIndex.value
  const from = drag.fromIndex.value
  if (to === null || from === null) return null
  const tile = store.slots[from]
  if (!tile) return null
  const span = tileSpan(tile)
  /*
   * nameless 一起带出来：没起名的方块落位后方格会长到名称处（见 TileCell 的
   * --label-block），指示框不跟着长就会比真实落点矮一截。
   */
  return { ...store.resolvePlacement(to, span.w, span.h), nameless: tile.name.trim() === '' }
})

/* ── 右键菜单 ─────────────────────────────────────── */

/** 菜单当前作用的槽位；null 表示这次右键落在空白处 */
const menuIndex = ref<number | null>(null)

/** 删除后暂存，等撤销窗口过期才真正丢弃 */
const undo = ref<{ index: number; tile: Tile } | null>(null)

const menu = useContextMenu((event) => {
  // 拖拽 / 落位进行中不弹菜单：此刻方格位置还在变，菜单指向哪一格是不确定的
  if (drag.isActive.value) return null

  /*
   * 输入框上放行浏览器原生菜单。
   *
   * 搜索方块里的 `<input>` 带 data-native-menu，命中它就返回 null——原生菜单有
   * 复制、粘贴、全选，比自绘的「编辑 / 删除」有用得多。
   *
   * 只挡输入框本身，不挡整个方块：方块的其余部分（外框留白、引擎图标、chips）
   * 仍要出「编辑 / 删除」，否则一个退出了拖拽的方块就再也没有任何配置入口了。
   */
  if ((event.target as HTMLElement | null)?.closest('[data-native-menu]')) return null

  const square = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-slot-index]')
  const index = square ? Number(square.dataset.slotIndex) : null
  menuIndex.value = index !== null && Number.isInteger(index) ? index : null

  const items: MenuItem[] = []
  const tile = menuIndex.value === null ? null : store.slots[menuIndex.value]

  if (menuIndex.value !== null) {
    if (tile) {
      // 链接与组件都可编辑，只是打开的表单不同（尺寸/底色 vs 尺寸/配色）
      items.push({ id: 'edit', label: '编辑', icon: 'edit' })
      items.push({ id: 'delete', label: '删除', icon: 'delete', danger: true })
    } else {
      items.push({ id: 'add', label: '添加', icon: 'add' })
    }
  }

  // 通用项恒在末尾；有前置项时用分隔线把「作用于这一格」和「作用于整页」分开
  items.push({
    id: 'refresh',
    label: '刷新',
    icon: 'refresh',
    separatorBefore: items.length > 0,
  })
  items.push({ id: 'settings', label: '设置', icon: 'settings' })

  return items
},
  { preset: profilePreset },
)

/** 菜单收起后清掉方格的选中态 */
watch(menu.open, (open) => {
  if (!open) menuIndex.value = null
})

function onMenuSelect(id: string) {
  const index = menuIndex.value
  menu.close()

  switch (id) {
    case 'add':
      if (index !== null) openDialog(index)
      break
    case 'edit':
      if (index !== null) openDialog(index, store.slots[index] ?? undefined)
      break
    case 'delete':
      if (index !== null) removeTile(index)
      break
    case 'refresh':
      window.location.reload()
      break
    case 'settings':
      emit('open-settings')
      break
  }
}

/**
 * 删除走「先删 + 可撤销」而不是二次确认弹窗：
 * 单个方格的删除代价低，撤销条既避免了误删不可恢复，也不给每次删除加一次点击。
 */
function removeTile(index: number) {
  const tile = store.slots[index]
  if (!tile) return
  undo.value = { index, tile }
  store.clearTile(index)
}

function undoRemove() {
  const pending = undo.value
  undo.value = null
  if (!pending) return
  // 期间该格可能已被拖入别的方块，restoreTile 只在仍为空时写回
  store.restoreTile(pending.index, pending.tile)
}

/* ── Dialog ───────────────────────────────────────── */

function openDialog(index: number, tile?: Tile) {
  lastTrigger = cellRefs.value[index]?.squareEl ?? null
  editingTile.value = tile
  dialogIndex.value = index
}

function activate(index: number) {
  const tile = store.slots[index]

  if (!tile) {
    openDialog(index)
    return
  }

  if (tile.kind === 'link') {
    window.open(tile.url, '_blank', 'noopener,noreferrer')
  }
  /*
   * widget 不在这里分发自身行为。
   *
   * 待办的「点方块打开完整清单」走 open-widget-dialog 那条独立通路，理由是
   * **哪些形状可点是组件自己的知识**（宽=1 的四档没有内部控件才可整块点，
   * 见 todo/variant.opensOnTileClick）。在这里按 widgetId 分发就等于把那份判据
   * 抄到网格层，而网格层拿不到版式。
   */
}

/**
 * 组件方块请求打开自己的功能对话框。
 *
 * 目前只有待办。按 widgetId 分发而不是让组件直接指定要开哪个对话框：
 * 对话框是网格层的资产，组件只上报「我要打开我的那个」。
 */
function openWidgetDialog(index: number) {
  const tile = store.slots[index]
  if (tile?.kind !== 'widget') return
  if (tile.widgetId !== 'todo') return

  /*
   * 焦点归还的目标是那一格里的**入口按钮**，不是方格本身。
   *
   * 方格根节点对 interactive 方块没有 tabindex（TileCell 把 role / tabindex 都置为
   * undefined，焦点顺序交给内部控件），focus() 到一个不可聚焦的元素是空操作——
   * TodoWidget.onInputEscape 的注释已经踩过同一个坑，这里实测也是：关闭后
   * activeElement 落回 body。待办方块恒有一个入口按钮（.td__openKey 或 .td__enter），
   * 它正是用户点的那个东西，也就是焦点该回去的地方。
   */
  const square = cellRefs.value[index]?.squareEl ?? null
  lastTrigger = square?.querySelector<HTMLElement>('.td__openKey, .td__enter') ?? square
  todoDialogOpen.value = true
}

/** 关闭完整待办对话框，焦点还回入口按钮（与 closeDialog 同一条纪律） */
function closeTodoDialog() {
  todoDialogOpen.value = false
  if (lastTrigger?.isConnected) lastTrigger.focus()
  lastTrigger = null
}

/**
 * 组件方块自己改了配置（目前只有搜索方块的换引擎）。
 *
 * 走 updateTile 而不是原地改 slots[index].props：那是 store 唯一的写入路径，
 * 会过一遍 sanitizeWidgetProps 并保留原 id。合并而非替换 props——
 * 组件只上报自己改的那一个键，其余配置（颜色等）必须留着。
 */
function onWidgetProps(index: number, patch: Record<string, unknown>) {
  const tile = store.slots[index]
  if (!tile || tile.kind !== 'widget') return
  const span = tileSpan(tile)
  store.updateTile(index, {
    kind: 'widget',
    name: tile.name,
    widgetId: tile.widgetId,
    spanW: span.w,
    spanH: span.h,
    props: { ...tile.props, ...patch },
  })
}

function onSubmit(draft: TileDraft) {
  if (dialogIndex.value === null) return
  // 编辑保留原 id，新建才生成新 id
  if (editingTile.value) store.updateTile(dialogIndex.value, draft)
  else store.setTile(dialogIndex.value, draft)
  closeDialog()
}

function closeDialog() {
  dialogIndex.value = null
  editingTile.value = undefined
  // 落位可能被夹到别处，原触发元素已不在文档里，此时不强行对焦
  if (lastTrigger?.isConnected) lastTrigger.focus()
  lastTrigger = null
}

function setCellRef(el: unknown, index: number) {
  if (el) cellRefs.value[index] = el as InstanceType<typeof TileCell>
}

/*
 * 清掉不再渲染的槽位引用。
 *
 * 只按长度截断不够：大方块出现 / 消失会让中间某些下标停止渲染，
 * 残留的旧引用会让命中检测读到已卸载的方格。
 */
watch(
  cells,
  (list) => {
    const alive = new Set(list.map((cell) => cell.index))
    cellRefs.value.length = store.slots.length
    for (let i = 0; i < cellRefs.value.length; i++) {
      if (!alive.has(i)) delete cellRefs.value[i]
    }
  },
  { flush: 'post' },
)

const undoMessage = computed(() => `已删除「${undo.value?.tile.name ?? ''}」`)

/* ── 名称截断提示 ─────────────────────────────────── */

/**
 * 悬停在被截断的名称上时显示完整名称；null 表示不显示。
 *
 * 所有格共用这一份状态、渲染成一个浮层：提示要盖过相邻方格，
 * 挂在格内会被滚动容器裁掉。同时天然保证只有一个提示同时存在。
 */
const nameTip = ref<{ text: string; x: number; top: number; bottom: number } | null>(null)

/**
 * 拖拽一开始就撤掉提示。
 *
 * 光靠名称行的 pointerdown 不够：拖起来之后指针早已离开原来那一格，
 * 而拖拽期间指针被 setPointerCapture 接管，pointerleave 不会照常派发。
 */
watch(drag.isActive, (active) => {
  if (active) nameTip.value = null
})

/**
 * 网格滚动 / 拖拽刷新矩形时的收尾。
 *
 * 提示位置是按进入那一刻的矩形算定的，滚动后锚点已经跑了；
 * 跟着重新定位不合适——名称行可能已经滚出可视区，提示却还悬在原处，
 * 所以直接收起，指针再动一次自会重新触发。
 */
function onGridScroll() {
  drag.refreshRects()
  nameTip.value = null
}
</script>

<template>
  <div class="grid-wrap">
    <p v-if="metrics.tooSmall" class="too-small">窗口过小，建议放大窗口以获得更好体验</p>

    <!-- 手机档长按反馈：触点处显示，达到阈值后由 useContextMenu 触发一次轻微震动。 -->
    <div
      v-if="menu.pressFeedback.visible"
      class="press-feedback"
      :class="{ 'is-ready': menu.pressFeedback.ready }"
      :style="{ left: `${menu.pressFeedback.x}px`, top: `${menu.pressFeedback.y}px` }"
      aria-hidden="true"
    />

    <!--
      滚动容器与网格分开两层。

      网格自身不能带 overflow：useGridMetrics 观测的就是它，
      滚动条会计入 getBoundingClientRect，一出现就少量一点尺寸，
      于是反解出的列数减一、网格变窄、滚动条又消失——一帧一变的抖动。
    -->
    <div ref="scrollEl" class="grid-scroll" @wheel="onWheel" @scroll.passive="onGridScroll">
      <div ref="gridEl" class="grid" :style="{ '--grid-cols': store.cols, ...areaStyle }">
        <TileCell
          v-for="cell in cells"
          :key="cell.tile?.id ?? `empty-${cell.index}`"
          :ref="(el) => setCellRef(el, cell.index)"
          :index="cell.index"
          :tile="cell.tile"
          :span-w="cell.w"
          :span-h="cell.h"
          :style="{
            gridColumn: `${cell.col + 1} / span ${cell.w}`,
            gridRow: `${cell.row + 1} / span ${cell.h}`,
          }"
          :is-source="drag.isDragging.value && drag.fromIndex.value === cell.index"
          :is-landing="drag.isSettling.value && drag.settleIndex.value === cell.index"
          :is-menu-target="menu.open.value && menuIndex === cell.index"
          @pointerdown="
            (event, el, deferCapture) =>
              drag.onPointerDown(event, { index: cell.index, el, deferCapture })
          "
          @pointermove="(event, el) => drag.onPointerMove(event, { index: cell.index, el })"
          @pointerup="(event, el) => drag.onPointerUp(event, { index: cell.index, el })"
          @pointercancel="drag.onPointerCancel()"
          @activate="activate"
          @update-props="onWidgetProps"
          @open-widget-dialog="openWidgetDialog"
          @name-tip="nameTip = $event"
        />

        <!-- 落点指示：独立一层，用显式定位画出夹紧后的完整落点区域 -->
        <div
          v-if="dropHint"
          class="drop-hint"
          :style="{
            gridColumn: `${dropHint.col + 1} / span ${dropHint.w}`,
            gridRow: `${dropHint.row + 1} / span ${dropHint.h}`,
            '--span-h': dropHint.h,
            ...(dropHint.nameless ? { '--label-block': '0px' } : {}),
          }"
          aria-hidden="true"
        />
      </div>
    </div>

    <DragLayer
      v-if="drag.isActive.value && layerTile"
      :tile="layerTile"
      :x="drag.layerX.value"
      :y="drag.layerY.value"
      :w="drag.layerW.value"
      :h="drag.layerH.value"
      :scale="drag.layerScale.value"
      :settling="drag.isSettling.value"
    />

    <!--
      浮层统一裹一层 OverlayLayer：它负责 Teleport 与「跟随设置」的进出场过渡。

      Dialog 的 transition 挂在遮罩的后代上（.overlay__tint / .panel），根元素本身不带，
      所以要显式给 duration；菜单与撤销条的过渡就写在根上，交给 Vue 自己探测。
    -->
    <OverlayLayer name="dialog" duration="base">
      <AddTileDialog
        v-if="dialogIndex !== null"
        :editing="editingTile"
        @close="closeDialog"
        @submit="onSubmit"
      />
    </OverlayLayer>

    <!--
      完整待办对话框。与 AddTileDialog 同一档 z-index（--z-dialog），两者不会同时
      在场：打开这个的入口是方块自身，而那个由右键菜单 / 空格点击触发。
      transition 同样挂在遮罩的后代上，所以要显式给 duration。
    -->
    <OverlayLayer name="todo-dialog" duration="base">
      <TodoDialog v-if="todoDialogOpen" @close="closeTodoDialog" />
    </OverlayLayer>

    <OverlayLayer name="menu">
      <ContextMenu
        v-if="menu.open.value"
        :x="menu.x.value"
        :y="menu.y.value"
        :items="menu.items.value"
        @select="onMenuSelect"
        @close="menu.close()"
      />
    </OverlayLayer>

    <!-- 名称被截断时的完整名称提示，全网格共用一个实例 -->
    <OverlayLayer name="tip">
      <TileNameTip
        v-if="nameTip"
        :text="nameTip.text"
        :x="nameTip.x"
        :top="nameTip.top"
        :bottom="nameTip.bottom"
      />
    </OverlayLayer>

    <OverlayLayer name="toast">
      <UndoToast
        v-if="undo"
        :message="undoMessage"
        action-label="撤销"
        @action="undoRemove"
        @close="undo = null"
      />
    </OverlayLayer>
  </div>
</template>

<style scoped>
/*
 * 外层不留内边距。
 *
 * 留白改由滚动容器自己的 padding 提供：滚动条画在滚动容器的边框盒边缘，
 * 内边距在它之内。padding 放在这一层的话，滚动条会连同容器一起被推离窗口边缘。
 */
.grid-wrap {
  position: relative;
  display: flex;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
}

/*
 * 滚动容器。
 *
 * 与网格分成两层：网格自身是 useGridMetrics 的观测对象，
 * 在它上面开 overflow 会让滚动条计入自身尺寸，反解出的列数随滚动条出现而减一、
 * 网格变窄后滚动条又消失——一帧一变的抖动。
 *
 * padding 落在这一层：滚动条因此贴住窗口边缘，而方格仍有同样的留白。
 * useGridMetrics 读的是 clientWidth 再扣掉这里的 padding，所以可用空间不受影响。
 */
.grid-scroll {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: var(--grid-padding);
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-color: rgb(255 255 255 / 0.18) transparent;
  scrollbar-width: thin;
}

/*
 * 显式定位的 CSS Grid。
 *
 * 换掉 flex-wrap 的理由：跨格方块存在时，自动流会把后续小方块塞进空隙，
 * 视觉顺序与 slot index 脱节。每格都写 grid-column / grid-row，自动流就无从插手。
 *
 * 未设固定尺寸时靠 width: 100% + flex: 1 精确铺满滚动容器。
 * min-height / min-width 必须归零：flex 项默认 min-height: auto 会让它被内容顶大，
 * 而 useGridMetrics 观测的正是这个元素——它一被内容撑开，反解出的行数就等于
 * 当前行数，永远不再收缩，形成观测回环。居中所需的 auto margin 只在
 * areaStyle 里随固定尺寸一起写，理由见那里。
 */
.grid {
  display: grid;
  width: 100%;
  flex: 1;
  min-width: 0;
  min-height: 0;
  align-content: center;
  justify-content: center;
  gap: var(--gap);
  grid-template-columns: repeat(var(--grid-cols), var(--tile-size));
  grid-auto-rows: calc(var(--tile-size) + var(--label-gap) + var(--label-height));
}

/*
 * WebKit 不认 scrollbar-width，单独给一套细滚动条。
 *
 * 拇指用 border 内缩而不是直接给窄宽度：轨道保持 10px 的命中区域，
 * 视觉上却只有 4px，既好点又不抢视线。
 */
.grid-scroll::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

.grid-scroll::-webkit-scrollbar-thumb {
  border: 3px solid transparent;
  border-radius: var(--r-full);
  background: rgb(255 255 255 / 0.18);
  background-clip: content-box;
}

.grid-scroll::-webkit-scrollbar-thumb:hover {
  background: rgb(255 255 255 / 0.3);
  background-clip: content-box;
}

.grid-scroll::-webkit-scrollbar-corner,
.grid-scroll::-webkit-scrollbar-track {
  background: transparent;
}

/*
 * 落点指示层。
 *
 * 只有方格那部分高度（扣掉名称行），与 TileCell 的 --square-h 同构，
 * 否则指示框会比真实落点高出一行。
 */
.drop-hint {
  --span-w: 1;
  --span-h: 1;
  /* 与 TileCell 同名同义：没起名的方块落位后会长到名称处，指示框要跟着一起长 */
  --label-block: calc(var(--label-gap) + var(--label-height));
  --cell-block: calc(var(--tile-size) + var(--label-gap) + var(--label-height));
  align-self: start;
  height: calc(
    var(--cell-block) * var(--span-h) + var(--gap) * (var(--span-h) - 1) - var(--label-block)
  );
  border: 1px solid var(--accent);
  border-radius: calc(var(--tile-size) * var(--tile-radius-ratio));
  box-shadow: 0 0 0 2px var(--accent) inset;
  pointer-events: none;
}

/* 绝对定位不占流内高度，否则提示出现时会把滚动区往下挤一截 */
.too-small {
  position: absolute;
  top: var(--sp-4);
  left: 50%;
  z-index: 1;
  margin: 0;
  color: var(--color-text-dim);
  font-size: var(--fs-sm);
  transform: translateX(-50%);
  pointer-events: none;
}

/* 长按触点提示：动画只表达「正在按住 / 已达到阈值」，不覆盖方块内容。 */
.press-feedback {
  position: fixed;
  z-index: var(--z-tip);
  width: 30px;
  height: 30px;
  border: 2px solid var(--accent);
  border-radius: var(--r-full);
  box-shadow: 0 0 0 4px rgb(255 255 255 / 0.1);
  transform: translate(-50%, -50%) scale(0.62);
  opacity: 0.85;
  pointer-events: none;
  animation: press-feedback-pulse 450ms var(--ease) forwards;
}

.press-feedback.is-ready {
  border-color: var(--accent-solid);
  box-shadow: 0 0 0 6px rgb(255 255 255 / 0.16);
  animation: press-feedback-ready 140ms var(--ease) forwards;
}

@keyframes press-feedback-pulse {
  0% {
    opacity: 0.25;
    transform: translate(-50%, -50%) scale(0.62);
  }

  70% {
    opacity: 0.85;
    transform: translate(-50%, -50%) scale(0.9);
  }

  100% {
    opacity: 0.95;
    transform: translate(-50%, -50%) scale(1);
  }
}

@keyframes press-feedback-ready {
  0% {
    opacity: 0.95;
    transform: translate(-50%, -50%) scale(1);
  }

  100% {
    opacity: 0.7;
    transform: translate(-50%, -50%) scale(1.14);
  }
}
</style>

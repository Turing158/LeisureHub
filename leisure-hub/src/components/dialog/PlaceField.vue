<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

import { searchPlace } from '../widgets/weather/api'
import type { GeoResult } from '../widgets/weather/types'

const props = defineProps<{
  place: string
  /** undefined 表示未设置。用缺省而非 0 表达：0,0 是几内亚湾上的一个合法坐标 */
  lat: number | undefined
  lon: number | undefined
}>()

const emit = defineEmits<{
  /**
   * 三个键一起上报。
   *
   * 地点是一个整体：分三次 emit 会出现「lat 已更新、lon 还是旧值」的中间态，
   * 而预览此刻就会按那半个坐标取一次数。
   */
  update: [value: { place: string; lat: number | undefined; lon: number | undefined }]
}>()

/** 2 字起搜：一个字的候选几乎总是 5 条无关结果 */
const MIN_QUERY = 2
const DEBOUNCE_MS = 400

const query = ref('')
const results = ref<GeoResult[]>([])
const loading = ref(false)
const error = ref('')
/** 键盘高亮项的下标；−1 表示没有高亮（鼠标用户的常态） */
const active = ref(-1)
const open = ref(false)

let timer = 0
let controller: AbortController | undefined

/** 收起列表但保留候选，供 Esc 之后用下箭头重新展开 */
function collapse() {
  open.value = false
  active.value = -1
}

/** 彻底清空：换了查询词或选定之后 */
function reset() {
  results.value = []
  active.value = -1
  open.value = false
  error.value = ''
}

/**
 * 防抖搜索。
 *
 * 每次输入都取消上一个在飞的请求：不取消的话，慢的那个响应可能后到，
 * 把已经不匹配当前输入的候选列表覆盖上去。
 */
function schedule() {
  clearTimeout(timer)
  controller?.abort()
  controller = undefined

  const text = query.value.trim()
  if ([...text].length < MIN_QUERY) {
    loading.value = false
    reset()
    return
  }

  loading.value = true
  timer = window.setTimeout(() => {
    void run(text)
  }, DEBOUNCE_MS)
}

async function run(text: string) {
  const current = new AbortController()
  controller = current

  try {
    const list = await searchPlace(text, current.signal)
    if (current.signal.aborted) return
    results.value = list
    active.value = list.length > 0 ? 0 : -1
    open.value = true
    // 空列表给文案而不是静默：用户无从判断是「没搜到」还是「请求失败」
    error.value = list.length === 0 ? '没有找到这个地名' : ''
  } catch (err) {
    if (current.signal.aborted) return
    results.value = []
    active.value = -1
    open.value = true
    error.value = err instanceof Error ? `搜索失败：${err.message}` : '搜索失败'
  } finally {
    if (controller === current) {
      controller = undefined
      loading.value = false
    }
  }
}

watch(query, schedule)

onBeforeUnmount(() => {
  clearTimeout(timer)
  controller?.abort()
})

function choose(item: GeoResult) {
  emit('update', { place: item.name, lat: item.lat, lon: item.lon })
  query.value = ''
  loading.value = false
  clearTimeout(timer)
  controller?.abort()
  controller = undefined
  reset()
}

/**
 * 上下键选择 + Enter 确认 + Esc 收起。
 *
 * 下标循环而不是夹在两端：5 条候选的列表里，从末项按下再回到首项
 * 比停住更符合预期（与原生 select 一致）。
 */
function onKeydown(event: KeyboardEvent) {
  /*
   * Esc 先收候选列表，且必须 stopPropagation。
   *
   * AddTileDialog 在 window 上监听 keydown 做 Esc 关闭；不拦住的话
   * 一次 Esc 会同时收列表和关整个面板，用户填到一半的地点就丢了。
   * 列表没开时不拦，Esc 照常关面板。
   */
  if (event.key === 'Escape') {
    if (!open.value) return
    event.stopPropagation()
    collapse()
    return
  }

  /*
   * Enter 一律拦下，不管此刻有没有候选。
   *
   * 这个输入框在 <form> 里，回车会触发隐式提交——用户正在搜地名的中途
   * 按一下回车（没搜到、或还没搜完），整个方块就被保存并关掉了面板。
   * 在搜索框里回车的含义只能是「确认候选」，没有候选时它什么都不该做。
   */
  if (event.key === 'Enter') {
    event.preventDefault()
    const item = open.value ? results.value[active.value] : undefined
    if (item) choose(item)
    return
  }

  if (results.value.length === 0) return

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    // Esc 收起后按方向键重新展开，而不是要求用户重打一遍查询词
    if (!open.value) {
      open.value = true
      active.value = event.key === 'ArrowDown' ? 0 : results.value.length - 1
      return
    }
    const delta = event.key === 'ArrowDown' ? 1 : -1
    const n = results.value.length
    active.value = (active.value + delta + n) % n
  }
}

/** 定位。必须由用户手势触发，不在挂载时静默请求——那是隐私边界 */
const locating = ref(false)

function locate() {
  if (!navigator.geolocation) {
    error.value = '这个浏览器不支持定位'
    return
  }

  locating.value = true
  error.value = ''
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      locating.value = false
      /*
       * 定位只给坐标不给地名，所以名字留给用户自己填（或保持原名）。
       * 不反查 geocoding：那要多打一次请求，而「当前位置」这个占位
       * 已经足以自解释（WeatherWidget 的 placeName 就是这个默认值）。
       */
      emit('update', {
        place: props.place,
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
      })
    },
    (err) => {
      locating.value = false
      error.value = err.code === err.PERMISSION_DENIED ? '定位权限被拒绝' : '定位失败'
    },
    { timeout: 10_000, maximumAge: 5 * 60 * 1000 },
  )
}

/**
 * 手填经纬度。
 *
 * 本地草稿而非直接双向绑：直接绑的话「删空重输」不可能——清空的一瞬值成了
 * NaN，回写再夹一次，光标位置与已输入的数字都会被打断。
 * 编辑期间只动草稿，失焦或回车才提交（与 NumberField 同一手法）。
 */
const latDraft = ref(props.lat === undefined ? '' : String(props.lat))
const lonDraft = ref(props.lon === undefined ? '' : String(props.lon))

watch(
  () => [props.lat, props.lon] as const,
  ([lat, lon]) => {
    latDraft.value = lat === undefined ? '' : String(lat)
    lonDraft.value = lon === undefined ? '' : String(lon)
  },
)

/** 空串 → undefined（清除设置）；非法值退回上一个有效值，不写脏数据 */
function parseCoord(draft: string, limit: number, current: number | undefined) {
  const trimmed = draft.trim()
  if (!trimmed) return { value: undefined, ok: true }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < -limit || parsed > limit) {
    return { value: current, ok: false }
  }
  return { value: parsed, ok: true }
}

function commitLat() {
  const { value, ok } = parseCoord(latDraft.value, 90, props.lat)
  if (!ok) latDraft.value = props.lat === undefined ? '' : String(props.lat)
  emit('update', { place: props.place, lat: value, lon: props.lon })
}

function commitLon() {
  const { value, ok } = parseCoord(lonDraft.value, 180, props.lon)
  if (!ok) lonDraft.value = props.lon === undefined ? '' : String(props.lon)
  emit('update', { place: props.place, lat: props.lat, lon: value })
}

function setName(event: Event) {
  const value = (event.target as HTMLInputElement).value
  emit('update', { place: value, lat: props.lat, lon: props.lon })
}
</script>

<template>
  <div class="place">
    <!--
      搜索是主路径，放最上。

      combobox 而非普通 input：候选列表要能被读屏识别为一组选项，
      而 aria-activedescendant 让高亮项在不移动焦点的情况下被播报——
      焦点必须留在输入框里，否则上下键就没法继续改高亮。
    -->
    <label class="place__label" for="wx-place-search">搜索地名</label>
    <div class="place__search">
      <input
        id="wx-place-search"
        v-model="query"
        class="place__input"
        type="text"
        role="combobox"
        autocomplete="off"
        aria-controls="wx-place-list"
        :aria-expanded="open && results.length > 0"
        :aria-activedescendant="active >= 0 ? `wx-place-opt-${active}` : undefined"
        placeholder="例如：北京"
        @keydown="onKeydown"
      />
      <span v-if="loading" class="place__spin" aria-hidden="true"></span>
    </div>

    <!--
      候选列表。每项 ≥44px 高（触摸目标），行内两行：地名 + 省/国用于消歧。
      用 mousedown 而非 click：click 在 blur 之后触发，
      而 blur 会先关掉列表、让点击落到空处。
    -->
    <ul
      v-if="open && results.length > 0"
      id="wx-place-list"
      class="place__list"
      role="listbox"
      aria-label="地名候选"
    >
      <li
        v-for="(item, i) in results"
        :id="`wx-place-opt-${i}`"
        :key="item.id"
        class="place__opt"
        :class="{ 'is-active': i === active }"
        role="option"
        :aria-selected="i === active"
        @mousedown.prevent="choose(item)"
        @mouseenter="active = i"
      >
        <span class="place__opt-name">{{ item.name }}</span>
        <span class="place__opt-region">{{ item.region }}</span>
      </li>
    </ul>

    <p v-if="error" class="place__error">{{ error }}</p>

    <!-- 定位与手填是两条退路，压在同一行的两侧 -->
    <div class="place__row">
      <button class="place__locate" type="button" :disabled="locating" @click="locate">
        {{ locating ? '定位中…' : '用当前位置' }}
      </button>
      <span class="place__hint">会向浏览器请求定位权限</span>
    </div>

    <label class="place__label" for="wx-place-name">显示名称</label>
    <input
      id="wx-place-name"
      class="place__input"
      type="text"
      :value="place"
      maxlength="24"
      placeholder="留空则显示「当前位置」"
      @input="setName"
    />

    <div class="place__coords">
      <label class="place__coord">
        <span class="place__coord-key">纬度</span>
        <input
          class="place__input"
          type="number"
          inputmode="decimal"
          step="0.0001"
          min="-90"
          max="90"
          :value="latDraft"
          placeholder="未设置"
          @input="latDraft = ($event.target as HTMLInputElement).value"
          @change="commitLat"
          @blur="commitLat"
          @keydown.enter.prevent="commitLat"
        />
      </label>

      <label class="place__coord">
        <span class="place__coord-key">经度</span>
        <input
          class="place__input"
          type="number"
          inputmode="decimal"
          step="0.0001"
          min="-180"
          max="180"
          :value="lonDraft"
          placeholder="未设置"
          @input="lonDraft = ($event.target as HTMLInputElement).value"
          @change="commitLon"
          @blur="commitLon"
          @keydown.enter.prevent="commitLon"
        />
      </label>
    </div>
  </div>
</template>

<style scoped>
.place {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--sp-1);
}

.place__label {
  font-size: var(--fs-base);
}

/* 名称输入框与搜索框之间要有一档间距，否则两个同样的框看起来是一组 */
.place__label:not(:first-child) {
  margin-top: var(--sp-2);
}

.place__search {
  position: relative;
  display: flex;
  min-width: 0;
  align-items: center;
}

.place__input {
  width: 100%;
  min-width: 0;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--fill);
  font-size: var(--fs-base);
  transition: border-color var(--dur-fast) var(--ease);
}

.place__input:focus {
  border-color: var(--focus);
  outline: none;
}

/*
 * 请求中的转圈。
 * 中性描边 + 一段亮弧，不用 accent：它不是状态标记而是进度提示。
 * data-motion='off' 时 style.css 已把动画压到 0.01ms，静止的圆环仍能表示「在忙」。
 */
.place__spin {
  position: absolute;
  right: var(--sp-3);
  width: 13px;
  height: 13px;
  border: 2px solid var(--line-strong);
  border-top-color: var(--color-text);
  border-radius: var(--r-full);
  animation: place-spin 0.7s linear infinite;
}

@keyframes place-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── 候选列表 ───────────────────────────────────────── */

.place__list {
  display: flex;
  max-height: 220px;
  flex-direction: column;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  margin: var(--sp-1) 0 0;
  padding: 0;
  background: var(--fill);
  list-style: none;
}

/* 44px 最小高度：触摸目标。两行内容自然到 46px，这里补一道下限 */
.place__opt {
  display: flex;
  min-height: 44px;
  flex-direction: column;
  justify-content: center;
  padding: var(--sp-2) var(--sp-3);
  gap: 2px;
  cursor: pointer;
}

.place__opt + .place__opt {
  border-top: 1px solid var(--line-subtle);
}

/* 高亮用中性填充而非 accent：accent 只标二元状态，不标「当前所指」 */
.place__opt.is-active {
  background: var(--fill-raised);
}

.place__opt-name {
  font-size: var(--fs-base);
}

.place__opt-region {
  color: var(--color-text-dim);
  font-size: var(--fs-sm);
}

.place__error {
  margin: var(--sp-1) 0 0;
  color: var(--danger);
  font-size: var(--fs-sm);
}

/* ── 定位与手填 ─────────────────────────────────────── */

.place__row {
  display: flex;
  align-items: center;
  margin-top: var(--sp-2);
  gap: var(--sp-2);
}

.place__locate {
  flex: none;
  /* 34px 高与 NumberField 的步进按钮一致，两行控件因此等高 */
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--fill);
  font-size: var(--fs-base);
  transition:
    border-color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

.place__locate:hover:not(:disabled) {
  border-color: var(--color-text-faint);
  background: var(--fill-raised);
}

.place__locate:disabled {
  color: var(--color-text-disabled);
  cursor: default;
}

.place__locate:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.place__hint {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-dim);
  font-size: var(--fs-sm);
  text-overflow: ellipsis;
}

.place__coords {
  display: flex;
  margin-top: var(--sp-2);
  gap: var(--sp-3);
}

.place__coord {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--sp-1);
}

.place__coord-key {
  color: var(--color-text-dim);
  font-size: var(--fs-sm);
}

/* 坐标是数字，等宽后两栏的小数点对齐 */
.place__coord .place__input {
  font-variant-numeric: tabular-nums;
}

/* 原生 spinner 在深色玻璃底上几乎看不见，且会挤掉输入宽度 */
.place__coord .place__input::-webkit-outer-spin-button,
.place__coord .place__input::-webkit-inner-spin-button {
  margin: 0;
  appearance: none;
}

.place__coord .place__input {
  appearance: textfield;
}
</style>

<script setup lang="ts">
import { computed, ref } from 'vue'

import ColorSwatches from './ColorSwatches.vue'
import PlaceField from './PlaceField.vue'
import TilePreview from './TilePreview.vue'
import SegmentedControl from '../settings/SegmentedControl.vue'
import EngineChips from '../widgets/search/EngineChips.vue'
import { getWidget } from '@/data/widgets'
import { useSettingsStore } from '@/stores/settings'
import { tileSpan, widgetSpanLimits, type TileDraft, type WidgetTile } from '@/types/tile'
import { widgetColorFields, widgetEngineField, widgetHasPlace } from '@/types/widgetProps'

const props = defineProps<{
  /** 被编辑的组件方块；本 tab 只用于编辑，没有新建路径 */
  tile: WidgetTile
}>()

const emit = defineEmits<{
  submit: [draft: TileDraft]
}>()

const settings = useSettingsStore()

/**
 * 尺寸档位按这一种组件自己的范围生成。
 *
 * 搜索方块是宽 2..6、高 1..2，其余组件仍是 1..4。写死 1..SPAN_MAX 的话，
 * 搜索的编辑框会露出一个点了会被夹回去的 1 档，以及缺掉真正可用的 5、6 档。
 *
 * SegmentedControl 的泛型约束是 string，档位用字符串，提交时再转数字。
 */
const limits = computed(() => widgetSpanLimits(props.tile.widgetId))

function spanOptions(min: number, max: number) {
  return Array.from({ length: max - min + 1 }, (_, i) => ({
    value: String(min + i),
    label: String(min + i),
  }))
}

const spanWOptions = computed(() => spanOptions(limits.value.wMin, limits.value.wMax))
const spanHOptions = computed(() => spanOptions(limits.value.hMin, limits.value.hMax))

const def = computed(() => getWidget(props.tile.widgetId))
const fields = computed(() => widgetColorFields(props.tile.widgetId))
const hasPlace = computed(() => widgetHasPlace(props.tile.widgetId))
const engineField = computed(() => widgetEngineField(props.tile.widgetId))

/*
 * 初值走 tileSpan，它已按这一种方块的上下限夹过。
 *
 * 直接读 props.tile.spanW 会在旧存档上给出越界值（例如搜索方块存着 1），
 * 而 SegmentedControl 找不到当前值时会把 activeIndex 回退到 0——
 * 滑块停在「2」上但 spanW 仍是 '1'，保存后尺寸悄悄变了。
 */
const initialSpan = tileSpan(props.tile)
const spanW = ref(String(initialSpan.w))
const spanH = ref(String(initialSpan.h))

/**
 * 颜色表单的本地副本。
 *
 * 每个字段都以空字符串表示「默认」，与 ColorSwatches 的约定一致；
 * 提交时空字符串不写进 props，因此缺省档会继续跟随主题令牌，
 * 而不是被钉死成当前主题恰好长什么样。
 */
const colors = ref<Record<string, string>>(
  Object.fromEntries(
    fields.value.map((field) => {
      const value = props.tile.props?.[field.key]
      return [field.key, typeof value === 'string' ? value : '']
    }),
  ),
)

/**
 * 地点的本地副本。
 *
 * 三个键一起存一份：它们是一个整体，分开存会在「填了 lat 还没填 lon」时
 * 让预览拿到半个坐标。undefined 表示未设置，与 sanitizeWidgetProps 的
 * finalize 钩子（缺一则两个都删）是同一条约定。
 */
function initialCoord(key: 'lat' | 'lon'): number | undefined {
  const value = props.tile.props?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const place = ref({
  place: typeof props.tile.props?.place === 'string' ? props.tile.props.place : '',
  lat: initialCoord('lat'),
  lon: initialCoord('lon'),
})

/**
 * 引擎的本地副本。
 *
 * 空串表示「没配过」，与颜色字段的约定一致；提交时空串不写进 props，
 * 于是 SearchWidget 的 resolveEngine 会给出默认引擎。
 * 不在这里就地填上默认 id：那会把「跟随默认」变成「钉死在百度」。
 */
const engineId = ref(
  typeof props.tile.props?.engineId === 'string' ? props.tile.props.engineId : '',
)

/** 当前生效的引擎，供 chips 高亮——没配过时高亮的是那个会被用到的默认引擎 */
const currentEngine = computed(() => settings.resolveEngine(engineId.value))

/**
 * 实时预览。
 *
 * 组件按 props 名接收配置，与 TileWidget 走的是同一条路径，
 * 所以预览里看到的就是落格后的样子。
 *
 * 预览里的天气组件会真的订阅一次取数，但它走同一个 useWeather——
 * 同地点命中同一条缓存，不产生额外请求。未配置地点时渲染「未配置」态，
 * 这恰好也是用户此刻要看的。
 */
const previewProps = computed(() => {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(colors.value)) {
    if (value) next[key] = value
  }
  if (hasPlace.value) {
    if (place.value.place.trim()) next.place = place.value.place.trim()
    // 成对才写：与 finalize 钩子同一条规则，预览不该比落格后更宽松
    if (place.value.lat !== undefined && place.value.lon !== undefined) {
      next.lat = place.value.lat
      next.lon = place.value.lon
    }
  }
  if (engineField.value && engineId.value) next.engineId = engineId.value
  return next
})

/**
 * 实时预览的全部绑定。
 *
 * `preview` 只传给声明了它的组件（目前只有搜索），不无条件写上：
 * 不认识这个 prop 的组件会把它落成 DOM 属性（preview=""），
 * 与 TileWidget 里对 spanW / spanH 的处理是同一条理由。
 */
const previewBindings = computed(() => ({
  ...previewProps.value,
  spanW: Number(spanW.value),
  spanH: Number(spanH.value),
  ...(props.tile.widgetId === 'search' ? { preview: true } : {}),
}))

/**
 * 预览的缩放方式。
 *
 * 判据挂在 widgetId 上而不是给 WidgetDef 加一个 `previewMode` 字段：
 * 目前只此一例，加字段就要在注册表里让每个组件都回答一次这个问题。
 * 第二个需要 zoom 的组件出现时再抽。
 */
const previewMode = computed<'fit' | 'zoom'>(() =>
  props.tile.widgetId === 'search' ? 'zoom' : 'fit',
)

/**
 * 预览旁的说明文字；返回空串即不渲染。
 *
 * 搜索方块不给——它的预览是一个写着「用百度搜索」的输入框，已经自解释，
 * 再挂一句注册表里的卡片描述是重复，而且会挤掉预览的宽度（那一档正靠宽度
 * 说明尺寸）。未知组件反过来必须留：此时预览只是个「?」。
 */
const previewHint = computed(() => {
  if (!def.value) return `未知组件：${props.tile.widgetId}`
  return props.tile.widgetId === 'search' ? '' : def.value.desc
})

function onSubmit() {
  /*
   * updateTile 是整体替换，draft 里漏掉的字段会在保存时被抹掉，
   * 所以 widgetId 与 name 必须显式带上。
   */
  emit('submit', {
    kind: 'widget',
    name: props.tile.name,
    widgetId: props.tile.widgetId,
    spanW: Number(spanW.value),
    spanH: Number(spanH.value),
    // 一项都没配就不写空对象，保持「未配置」是同一种表示
    props: Object.keys(previewProps.value).length > 0 ? { ...previewProps.value } : undefined,
  })
}
</script>

<template>
  <form class="form" novalidate @submit.prevent="onSubmit">
    <!--
      预览放在最上：颜色项有四个又带尺寸，改完得能立刻看到效果，
      否则只能靠保存 → 看方格 → 再进来改这样来回试。

      两档缩放方式（见 TilePreview 的 mode）：
      - 日历 / 天气走 fit——它们的内部尺寸全按 --content-size 比例算，
        缩令牌就能一起缩；固定舞台让表单高度不随尺寸档位跳动。
      - 搜索走 zoom——它的输入框高度、字号、圆角都是 clamp() 出来的绝对值，
        fit 模式下不会跟着缩，2×1 与 6×2 的预览会长得一模一样。

      组件本身不预览名称行（桌面上组件方块也只画内容），故不传 label。
    -->
    <div class="preview" :class="{ 'is-zoom': previewMode === 'zoom' }">
      <TilePreview
        :span-w="Number(spanW)"
        :span-h="Number(spanH)"
        :mode="previewMode"
      >
        <component :is="def.component" v-if="def" v-bind="previewBindings" />
        <span v-else class="preview__missing">?</span>
      </TilePreview>

      <!--
        说明文字只在需要它的时候出现。

        搜索方块的预览本身就是一个写着「用百度搜索」的输入框，自解释；
        旁边再挂一句「在方格里直接搜索，可切换引擎」是把注册表里的卡片描述
        搬到了这里，重复且挤掉预览的宽度——而这一档的预览要靠宽度说明尺寸。

        未知组件那一档反过来必须留：此时预览是个「?」，只有这句话说明发生了什么。
      -->
      <span v-if="previewHint" class="preview__hint">{{ previewHint }}</span>
    </div>

    <!--
      引擎排在尺寸之上，与天气的地点同一个位置：它是搜索方块唯一真正的配置项，
      而尺寸有可用的默认值。
    -->
    <div v-if="engineField" class="field">
      <span class="field__label">
        {{ engineField.label }}
        <span class="field__hint">每个搜索方块各自记住自己的引擎</span>
      </span>
      <EngineChips
        :engines="settings.allEngines"
        :current-id="currentEngine.id"
        align="start"
        @select="engineId = $event"
      />
    </div>

    <!--
      地点排在尺寸之上：它是天气方块唯一的必填项（不配就只能渲染「未配置」态），
      而尺寸与颜色都有可用的默认值。
    -->
    <div v-if="hasPlace" class="field">
      <span class="field__label">
        地点
        <span class="field__hint">经纬度会发给 Open-Meteo 用于取数</span>
      </span>
      <PlaceField
        :place="place.place"
        :lat="place.lat"
        :lon="place.lon"
        @update="place = $event"
      />
    </div>

    <div class="field">
      <span class="field__label">
        尺寸
        <span class="field__hint">占用的格数，放不下时会挤走相邻方块</span>
      </span>
      <div class="span-row">
        <span class="span-row__key">宽</span>
        <SegmentedControl v-model="spanW" :options="spanWOptions" label="占格宽度" />
      </div>
      <div class="span-row">
        <span class="span-row__key">高</span>
        <SegmentedControl v-model="spanH" :options="spanHOptions" label="占格高度" />
      </div>
    </div>

    <div v-for="field in fields" :key="field.key" class="field">
      <span class="field__label">{{ field.label }}</span>
      <ColorSwatches
        v-model="colors[field.key]"
        :label="field.label"
        :palette="field.palette"
      />
    </div>

    <button class="submit" type="submit">保存修改</button>
  </form>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* ── 预览 ─────────────────────────────────────────── */

.preview {
  display: flex;
  align-items: center;
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--fill);
  gap: var(--sp-3);
}

/*
 * zoom 一档改为竖排。
 *
 * 那一档的预览宽度就是它要传达的信息（方块在桌面上有多大），所以必须吃满整行；
 * 横排会把它压在说明文字旁边，缩放系数被文字的宽度左右，尺寸档位之间的差别
 * 就看不出来了。目前这一档不带说明文字，竖排只是为了让预览独占一行并居中。
 */
.preview.is-zoom {
  flex-direction: column;
  align-items: stretch;
}

/* 未知组件的占位符：撑满 TilePreview 给出的框 */
.preview__missing {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  color: var(--color-text-dim);
  font-size: 28px;
}

.preview__hint {
  color: var(--color-text-dim);
  font-size: var(--fs-sm);
}

/* ── 表单 ─────────────────────────────────────────── */

.field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--sp-1);
}

.field__label {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  font-size: var(--fs-base);
}

.field__hint {
  color: var(--color-text-dim);
  font-size: var(--fs-sm);
}

.span-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.span-row__key {
  flex: 0 0 auto;
  color: var(--color-text-dim);
  font-size: var(--fs-base);
}

.span-row :deep(.seg) {
  flex: 1;
}

/*
 * 提交按钮是面板里唯一的主动作，用 --accent-solid 填充。
 * 不用 --accent：文字压在它上面只有 3.2:1，达不到正文门槛；
 * accent-solid 是同色相压暗一档的版本，专供「文字压在色块上」的场景。
 */
.submit {
  margin-top: var(--sp-1);
  padding: 11px var(--sp-4);
  border-radius: var(--r-md);
  background: var(--accent-solid);
  font-size: var(--fs-base);
  font-weight: 500;
  transition: filter var(--dur-fast) var(--ease);
}

.submit:hover {
  filter: brightness(1.1);
}
</style>

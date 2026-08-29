<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import OverlayLayer from '../OverlayLayer.vue'
import CustomEngines from './CustomEngines.vue'
import NumberField from './NumberField.vue'
import SegmentedControl from './SegmentedControl.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import { autoFit } from '@/composables/useAreaViewport'
import { useSearchHistory } from '@/composables/useSearchHistory'
import {
  AREA_CELL_MAX,
  AREA_CELL_MIN,
  AREA_SIZE_MAX,
  AREA_SIZE_MIN,
  BG_PRESETS,
  BLUR_MAX,
  SCRIM_OPACITY_MAX,
  SCRIM_OPACITY_MIN,
  useSettingsStore,
  type AreaMode,
  type BgMode,
  type DrawerSide,
  type GlassMode,
  type MotionMode,
} from '@/stores/settings'

const emit = defineEmits<{ close: [] }>()

const props = defineProps<{ open: boolean }>()

const settings = useSettingsStore()
/**
 * 搜索记录。
 *
 * 抽屉里只用到「有几条」与「清空」。它是模块级共享的（见 useSearchHistory），
 * 所以这里清空之后，桌面上每个搜索方块下方那块区域同时变空——不需要任何联动代码。
 */
const history = useSearchHistory()
/** 停靠侧由设置驱动，抽屉出场方向与手柄同侧 */
const side = computed(() => settings.drawerSide)

const BG_MODE_OPTIONS: { value: BgMode; label: string }[] = [
  { value: 'color', label: '纯色' },
  { value: 'image', label: '图片' },
]

const MOTION_OPTIONS: { value: MotionMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'always', label: '始终开启' },
  { value: 'off', label: '关闭' },
]

const GLASS_OPTIONS: { value: GlassMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'always', label: '始终开启' },
  { value: 'off', label: '关闭' },
]

const SIDE_OPTIONS: { value: DrawerSide; label: string }[] = [
  { value: 'left', label: '左边' },
  { value: 'right', label: '右边' },
]

const AREA_MODE_OPTIONS: { value: AreaMode; label: string }[] = [
  { value: 'pixel', label: '按尺寸' },
  { value: 'cell', label: '按格数' },
]

/** 一键填充：两个字段一起写，只填一个轴等于没生效（另一轴仍会铺满） */
function fillAreaFromViewport() {
  settings.setAreaWidth(autoFit.value.width)
  settings.setAreaHeight(autoFit.value.height)
}

function fillCellsFromViewport() {
  settings.setAreaCols(autoFit.value.cols)
  settings.setAreaRows(autoFit.value.rows)
}

/** 图片地址本地暂存：输入过程中不写 store，避免每敲一个字符都触发一次背景请求 */
const imageDraft = ref(settings.bgImage)
const imageError = ref('')

/**
 * 背景图的加载状态。
 *
 * 地址合法 ≠ 图能显示出来：防盗链、403、404、图源挂了、HTTPS 页面上引 http 图
 * 被浏览器直接拦掉——这些全都表现为「填完之后背景一点变化都没有」，
 * 而协议校验对它们一无所知。所以这里真的去加载一次，把结果说出来。
 */
type ImageState = 'idle' | 'loading' | 'ok' | 'error'
const imageState = ref<ImageState>('idle')

/*
 * 每次探测领一个号，回调里比对。
 * 连着改两次地址时先发的请求可能后回来，不比对就会用旧结果覆盖掉新状态。
 */
let probeToken = 0

/**
 * 探测一次背景图能否加载。
 *
 * 传入的是 store 归一化后的绝对地址（bgImageHref），不是输入框里的原文——
 * 必须与 CSS 里那张图完全同址，否则探测结果说明不了背景的实际情况。
 */
function probeImage(href: string | null) {
  probeToken += 1
  const token = probeToken

  if (!href) {
    imageState.value = 'idle'
    return
  }

  imageState.value = 'loading'
  // 用 Image 而不是 fetch：它与 CSS 背景走同一条 no-cors 图片路径，也命中同一份缓存
  const img = new Image()
  img.onload = () => {
    if (token === probeToken) imageState.value = 'ok'
  }
  img.onerror = () => {
    if (token === probeToken) imageState.value = 'error'
  }
  img.src = href
}

/** HTTPS 页面里的 http 图会被浏览器静默拦掉，这种失败要单独说清楚 */
const isMixedContent = computed(
  () => window.location.protocol === 'https:' && /^http:\/\//i.test(settings.bgImageHref ?? ''),
)

/** 加载状态对应的提示语；地址格式错误由 imageError 优先展示 */
const imageStatusText = computed(() => {
  switch (imageState.value) {
    case 'loading':
      return '正在加载图片…'
    case 'ok':
      return '图片已加载'
    case 'error':
      return isMixedContent.value
        ? '当前页面是 HTTPS，浏览器会拦掉 http:// 图片，请换用 https 地址'
        : '图片加载失败：地址已失效、需要登录，或图源禁止外链'
    default:
      return '仅支持网络图片，回车或失焦后应用'
  }
})

/*
 * 地址一变就重验一次。
 *
 * 挂在归一化后的 bgImageHref 上而不是在 applyImage 里手动触发：
 * 「切到图片档」「改地址」「设置被重置」三条路径都会改到它，
 * 逐个补探测调用必然漏掉一条。
 *
 * 不加 immediate：抽屉从未打开过时没人看这条状态，首屏不必多发一次请求；
 * 打开时下面那个 watch 会补上。
 */
watch(() => settings.bgImageHref, probeImage)

// 抽屉重新打开时同步一次，覆盖上次未提交的草稿
watch(
  () => props.open,
  (open) => {
    if (!open) return
    imageDraft.value = settings.bgImage
    imageError.value = ''
    // 地址没变也复验一次：上次看到的结果可能已经过期（图源挂了 / 又活了）
    probeImage(settings.bgImageHref)
  },
)

function applyImage() {
  const trimmed = imageDraft.value.trim()
  if (!trimmed) {
    settings.setBgImage('')
    imageError.value = ''
    return
  }

  settings.setBgImage(trimmed)
  // store 只接受 http(s)，写入没生效就说明地址不合法
  imageError.value = settings.bgImage === trimmed ? '' : '请填写 http/https 开头的图片地址'
}

/*
 * 滑块拖动期间只改 CSS 变量，不写 store。
 *
 * scrimOpacity 在 store 的 persist watch 依赖里，逐帧提交会让拖动过程中
 * 每帧同步写一次 localStorage，直接阻塞主线程——正是这次要修的那类问题。
 * 松手（change）时才落库。
 */
function onScrimOpacityInput(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  document.documentElement.style.setProperty('--scrim-opacity', String(value / 100))
}

function onScrimOpacityCommit(event: Event) {
  settings.setScrimOpacity(Number((event.target as HTMLInputElement).value))
}

/** 点遮罩关闭：由设置开关控制，关掉后只能靠关闭按钮或 Esc 退出 */
function onScrimPointerDown() {
  if (settings.closeOnScrim) emit('close')
}

const panelEl = ref<HTMLElement | null>(null)
/** 打开前的焦点，关闭后归还，键盘用户不会被丢回文档开头 */
let restoreTarget: HTMLElement | null = null

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** 焦点陷阱：Tab 在抽屉内循环，Esc 关闭 */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key !== 'Tab' || !panelEl.value) return

  const focusables = panelEl.value.querySelectorAll<HTMLElement>(FOCUSABLE)
  if (focusables.length === 0) return

  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const current = document.activeElement as HTMLElement | null

  if (!event.shiftKey && current === last) {
    event.preventDefault()
    first.focus()
  } else if (event.shiftKey && current === first) {
    event.preventDefault()
    last.focus()
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      restoreTarget = document.activeElement as HTMLElement | null
      window.addEventListener('keydown', onKeydown)
      await nextTick()
      panelEl.value?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
      return
    }

    window.removeEventListener('keydown', onKeydown)
    restoreTarget?.focus()
    restoreTarget = null
  },
  { immediate: true },
)

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <!--
    Teleport 与进出场过渡由 OverlayLayer 负责，它会在动效关闭时摘掉过渡。

    duration 必须显式给出：下面的 transition 全部挂在 .scrim 的后代上（理由见样式区），
    而 Vue 只在插槽根元素——也就是 .scrim 本身——上探测过渡时长，
    不告诉它就会判定「没有过渡」，退场时同步卸载，关闭动画一帧都看不到。
  -->
  <OverlayLayer name="drawer" duration="base">
    <!--
      遮罩拆成三层。

      磨砂与压暗必须分开：backdrop-filter 每帧都要把身后已合成的画面读回再卷积，
      让它跟着淡入就等于整个过渡期间每帧重做一次全屏模糊。
      现在 .scrim 自己不带任何视觉属性也不参与过渡，
      模糊挂在恒定不变的 __glass 上，只有纯色的 __tint 在动 opacity。
    -->
    <div v-if="open" class="scrim" @pointerdown.self="onScrimPointerDown">
      <div class="scrim__glass" aria-hidden="true" />
      <div class="scrim__tint" aria-hidden="true" />

      <aside
        ref="panelEl"
        class="drawer"
        :class="`drawer--${side}`"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header class="drawer__head">
          <span class="drawer__badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
              <circle cx="12" cy="12" r="3" />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1"
              />
            </svg>
          </span>

          <h2 id="settings-title" class="drawer__title">设置</h2>

          <button class="close" type="button" aria-label="关闭设置" @click="emit('close')">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                stroke="currentColor"
                stroke-linecap="round"
                stroke-width="1.8"
                d="M6 6l12 12M18 6L6 18"
              />
            </svg>
          </button>
        </header>

        <div class="drawer__body">
          <!-- ── 背景 ─────────────────────────────── -->
          <section class="group">
            <h3 class="group__title">背景</h3>

            <SegmentedControl
              :model-value="settings.bgMode"
              :options="BG_MODE_OPTIONS"
              label="背景来源"
              @update:model-value="settings.setBgMode"
            />

            <!-- 纯色：预设色板 -->
            <div
              v-if="settings.bgMode === 'color'"
              class="swatches"
              role="radiogroup"
              aria-label="背景颜色"
            >
              <button
                v-for="preset in BG_PRESETS"
                :key="preset.value"
                class="swatch"
                :class="{ 'is-active': settings.bgColor === preset.value }"
                type="button"
                role="radio"
                :aria-checked="settings.bgColor === preset.value"
                :title="preset.label"
                :style="{ backgroundColor: preset.value }"
                @click="settings.setBgColor(preset.value)"
              >
                <span class="sr-only">{{ preset.label }}</span>
              </button>
            </div>

            <!-- 图片：仅支持网络地址，本地文件不进 localStorage -->
            <template v-else>
              <div class="field">
                <label class="field__label" for="bg-image">图片地址</label>
                <input
                  id="bg-image"
                  v-model="imageDraft"
                  class="field__input"
                  type="url"
                  inputmode="url"
                  placeholder="https://example.com/wallpaper.jpg"
                  @change="applyImage"
                  @keydown.enter.prevent="applyImage"
                />
                <span v-if="imageError" class="field__error">{{ imageError }}</span>
                <span
                  v-else
                  class="field__hint"
                  :class="{
                    'is-error': imageState === 'error',
                    'is-ok': imageState === 'ok',
                  }"
                >
                  {{ imageStatusText }}
                </span>
              </div>

              <!-- 模糊只对图片有意义，纯色底上看不出任何差别，因此不在纯色档露出 -->
              <div class="field">
                <label class="field__label" for="bg-blur">
                  模糊
                  <span class="field__value">{{ settings.bgBlur }}px</span>
                </label>
                <input
                  id="bg-blur"
                  class="slider"
                  type="range"
                  min="0"
                  :max="BLUR_MAX"
                  step="1"
                  :value="settings.bgBlur"
                  @input="settings.setBgBlur(Number(($event.target as HTMLInputElement).value))"
                />
              </div>
            </template>
          </section>

          <!-- ── 动画 ─────────────────────────────── -->
          <section class="group">
            <h3 class="group__title">动画</h3>
            <SegmentedControl
              :model-value="settings.motion"
              :options="MOTION_OPTIONS"
              label="动画开关"
              @update:model-value="settings.setMotion"
            />
            <p class="group__hint">「跟随系统」读取系统的减弱动态效果偏好</p>
          </section>

          <!-- ── 磨砂效果 ─────────────────────────── -->
          <section class="group">
            <h3 class="group__title">磨砂效果</h3>
            <SegmentedControl
              :model-value="settings.glass"
              :options="GLASS_OPTIONS"
              label="磨砂效果"
              @update:model-value="settings.setGlass"
            />
            <p class="group__hint">「跟随系统」读取系统的降低透明度偏好；关闭可明显缓解掉帧</p>

            <!-- 关掉磨砂后压暗层由样式接管到固定值，滑块失去意义，因此只在开启时露出 -->
            <div v-if="settings.glassEnabled" class="field">
              <label class="field__label" for="scrim-opacity">
                遮罩不透明度
                <span class="field__value">{{ settings.scrimOpacity }}%</span>
              </label>
              <input
                id="scrim-opacity"
                class="slider"
                type="range"
                :min="SCRIM_OPACITY_MIN"
                :max="SCRIM_OPACITY_MAX"
                step="1"
                :value="settings.scrimOpacity"
                @input="onScrimOpacityInput"
                @change="onScrimOpacityCommit"
              />
            </div>
          </section>

          <!-- ── 方块区域 ─────────────────────────── -->
          <section class="group">
            <h3 class="group__title">方块区域</h3>

            <SegmentedControl
              :model-value="settings.areaMode"
              :options="AREA_MODE_OPTIONS"
              label="区域尺寸方式"
              @update:model-value="settings.setAreaMode"
            />

            <!-- 按尺寸：直接写像素宽高 -->
            <template v-if="settings.areaMode === 'pixel'">
              <div class="pair">
                <NumberField
                  id="area-width"
                  label="宽度"
                  unit="px"
                  :model-value="settings.areaWidth"
                  :min="AREA_SIZE_MIN"
                  :max="AREA_SIZE_MAX"
                  :step="10"
                  @update:model-value="settings.setAreaWidth"
                />
                <NumberField
                  id="area-height"
                  label="高度"
                  unit="px"
                  :model-value="settings.areaHeight"
                  :min="AREA_SIZE_MIN"
                  :max="AREA_SIZE_MAX"
                  :step="10"
                  @update:model-value="settings.setAreaHeight"
                />
              </div>

              <div class="actions">
                <button class="btn" type="button" @click="fillAreaFromViewport">
                  按当前画面（{{ autoFit.width }} × {{ autoFit.height }}）
                </button>
                <button
                  class="btn btn--ghost"
                  type="button"
                  :disabled="!settings.areaPixelFixed"
                  @click="settings.resetAreaSize()"
                >
                  自动
                </button>
              </div>
            </template>

            <!-- 按格数：写横竖格子数，换算成像素由网格自己做 -->
            <template v-else>
              <div class="pair">
                <NumberField
                  id="area-cols"
                  label="横向格数"
                  unit="列"
                  :model-value="settings.areaCols"
                  :min="AREA_CELL_MIN"
                  :max="AREA_CELL_MAX"
                  @update:model-value="settings.setAreaCols"
                />
                <NumberField
                  id="area-rows"
                  label="竖向格数"
                  unit="行"
                  :model-value="settings.areaRows"
                  :min="AREA_CELL_MIN"
                  :max="AREA_CELL_MAX"
                  @update:model-value="settings.setAreaRows"
                />
              </div>

              <div class="actions">
                <button class="btn" type="button" @click="fillCellsFromViewport">
                  按当前画面（{{ autoFit.cols }} × {{ autoFit.rows }}）
                </button>
                <button
                  class="btn btn--ghost"
                  type="button"
                  :disabled="!settings.areaCellFixed"
                  @click="settings.resetAreaCells()"
                >
                  自动
                </button>
              </div>
            </template>

            <p class="group__hint">
              留空或点「自动」即跟随窗口大小；区域缩小后放不下的方块会暂存，变大后自动放回
            </p>
          </section>

          <!-- ── 搜索 ─────────────────────────────── -->
          <!--
            这里只放「不该逐方块分裂」的三项：建议与补全是隐私 / 输入法取舍，
            自定义引擎表是所有搜索方块共用的词典。

            **搜索方块本身在添加对话框的「组件」里加，可以放多个**，
            每个方块用哪个引擎、多大，都在它自己的右键「编辑」里改。
          -->
          <section class="group">
            <h3 class="group__title">搜索</h3>

            <ToggleSwitch
              id="suggest-enabled"
              label="搜索建议"
              hint="开启后，输入内容会发送给所选搜索引擎以获取建议；关闭时搜索方块仍可正常使用"
              :model-value="settings.suggestEnabled"
              @update:model-value="settings.setSuggestEnabled"
            />

            <!--
              内联补全依赖建议数据，建议关着时它无从发生，所以整体禁用。
              不隐藏而是禁用：隐藏会让「我记得这里有个开关」的用户以为功能被删了。
            -->
            <ToggleSwitch
              id="inline-complete"
              label="内联补全"
              hint="边打字边把首条建议补在光标后（选中态，继续打字即覆盖）；需先开启搜索建议"
              :disabled="!settings.suggestEnabled"
              :model-value="settings.inlineCompleteEnabled && settings.suggestEnabled"
              @update:model-value="settings.setInlineCompleteEnabled"
            />

            <!--
              搜索记录默认**开启**，与上面两项相反：那两项会把用户打的字发给第三方，
              这一项全程留在本机（见 useSearchHistory）。它的成本是「摆在桌面上，
              旁人扫一眼就能看到」，所以给了开关与下面那个「清空」。

              关掉时不只是不显示：SearchWidget 的 submit 也不再往里写
              （只藏不停写等于把开关做成了一个假的）。已经存下的内容仍在，
              所以「清空」在关掉之后照样可点——这正是用户关掉它之后最可能想做的事。
            -->
            <ToggleSwitch
              id="search-history"
              label="搜索记录"
              hint="在 2 格高的搜索方块下方显示最近搜过的词；只存在本机，不发送给任何一方"
              :model-value="settings.searchHistoryEnabled"
              @update:model-value="settings.setSearchHistoryEnabled"
            />

            <div class="actions">
              <button
                class="btn btn--ghost"
                type="button"
                :disabled="!history.hasItems.value"
                @click="history.clear()"
              >
                清空搜索记录（{{ history.items.value.length }} 条）
              </button>
            </div>

            <div class="field">
              <span class="field__label">自定义引擎</span>
              <CustomEngines />
            </div>

            <p class="group__hint">
              搜索方块在「添加 → 组件」里放置，可以放多个；引擎与尺寸在方块的右键「编辑」里改
            </p>
          </section>

          <!-- ── 抽屉位置 ─────────────────────────── -->
          <section class="group">
            <h3 class="group__title">抽屉位置</h3>
            <SegmentedControl
              :model-value="settings.drawerSide"
              :options="SIDE_OPTIONS"
              label="抽屉位置"
              @update:model-value="settings.setDrawerSide"
            />
            <p class="group__hint">手柄与抽屉一起换到该侧，也可直接拖动手柄</p>
          </section>

          <!-- ── 交互 ─────────────────────────────── -->
          <section class="group">
            <h3 class="group__title">交互</h3>
            <ToggleSwitch
              id="close-on-scrim"
              label="点击遮罩关闭"
              hint="关闭后，设置抽屉与弹窗只能用关闭按钮或 Esc 退出，不会因误点空白处丢失填写内容"
              :model-value="settings.closeOnScrim"
              @update:model-value="settings.setCloseOnScrim"
            />
          </section>
        </div>
      </aside>
    </div>
  </OverlayLayer>
</template>

<style scoped>
.scrim {
  position: fixed;
  z-index: var(--z-drawer);
  display: flex;
  padding: var(--sp-3);
  inset: 0;
}

/*
 * 两层都是装饰层，pointer-events: none 保证 @pointerdown.self 仍能命中 .scrim 本身，
 * 点空白关闭的行为不受拆层影响。
 */
.scrim__glass,
.scrim__tint {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* 磨砂层：属性在整个生命周期内恒定，绝不进入任何过渡 */
.scrim__glass {
  backdrop-filter: var(--glass-scrim);
}

/* 压暗层：只有它跟着进出场动 opacity，纯色层重合成几乎零成本 */
.scrim__tint {
  background: var(--scrim-tint);
}

/* 不支持 backdrop-filter 时退化为更深的纯色半透明 */
@supports not (backdrop-filter: blur(1px)) {
  .scrim__tint {
    background: rgb(6 6 8 / 0.82);
  }
}

/* ── 面板：悬浮卡片，四周留白不贴边 ─────────────────── */

.drawer {
  position: relative;
  display: flex;
  width: min(380px, 100%);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--panel-radius);
  background: var(--bg-drawer);
  backdrop-filter: var(--glass-drawer);
  /*
   * 单层阴影，不再叠顶部的 inset 内高光。
   * 内高光是拟物玻璃的痕迹：它模拟的是「玻璃厚度的高光边」，
   * 而这里的面板语言是一张压在页面上的纸，只需要一道描边。
   */
  box-shadow: var(--shadow-lg);
}

.drawer--left {
  margin-right: auto;
}

.drawer--right {
  margin-left: auto;
}

@supports not (backdrop-filter: blur(1px)) {
  .drawer {
    background: var(--surface-1);
  }
}

/* ── 头部 ─────────────────────────────────────────── */

.drawer__head {
  position: relative;
  display: flex;
  align-items: center;
  padding: var(--sp-4) var(--sp-4) var(--sp-4) 18px;
  border-bottom: 1px solid var(--line-subtle);
  gap: var(--sp-3);
}

.drawer__badge {
  display: grid;
  width: 34px;
  height: 34px;
  flex: none;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  /* 中性填充：徽章不该是全屏唯一的彩色块，--accent 只留给状态 */
  background: var(--fill-raised);
  color: var(--color-text);
  place-items: center;
}

.drawer__badge svg {
  width: 18px;
  height: 18px;
}

.drawer__title {
  margin: 0;
  flex: 1;
  font-size: var(--fs-lg);
  font-weight: 600;
  letter-spacing: 0.01em;
}

.close {
  position: relative;
  display: grid;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: var(--r-md);
  color: var(--color-text-dim);
  place-items: center;
  transition:
    background-color var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}

.close svg {
  width: 16px;
  height: 16px;
}

/* 视觉 34px、命中区域补到 44px，满足触控最小尺寸 */
.close::after {
  position: absolute;
  content: '';
  inset: -5px;
}

.close:hover {
  background: var(--fill-raised);
  color: var(--color-text);
}

.close:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/* ── 主体 ─────────────────────────────────────────── */

.drawer__body {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow-y: auto;
  padding: 18px;
  gap: 22px;
  scrollbar-color: rgb(255 255 255 / 0.18) transparent;
  scrollbar-width: thin;
}

/* ── 设置分组 ─────────────────────────────────────── */

.group {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.group__title {
  margin: 0;
  color: var(--color-text);
  font-size: var(--fs-base);
  font-weight: 600;
  letter-spacing: 0.02em;
}

.group__hint {
  margin: 0;
  color: var(--color-text-faint);
  font-size: var(--fs-sm);
  line-height: 1.5;
}

/* ── 色板 ─────────────────────────────────────────── */

/* 固定 4 列而非 auto-fit：8 个预设正好两行，色块保持足够的点击宽度 */
.swatches {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--sp-2);
}

.swatch {
  position: relative;
  height: 34px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  transition:
    transform var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}

.swatch:hover {
  border-color: var(--color-text-faint);
  transform: translateY(-1px);
}

/*
 * 选中态用外圈描边而不是内部勾号：色块本身很小，勾号在深色上不易辨识。
 * 这是 --accent 的三处用途之一——纯灰描边在一排深灰色块上分不出选中的是哪个。
 */
.swatch.is-active {
  border-color: transparent;
  box-shadow:
    0 0 0 2px var(--accent),
    var(--shadow-sm);
}

.swatch:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/* ── 表单字段 ─────────────────────────────────────── */

.field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.field__label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  color: var(--color-text-dim);
  font-size: var(--fs-sm);
  gap: var(--sp-2);
}

.field__value {
  color: var(--color-text);
  font-size: var(--fs-sm);
  font-variant-numeric: tabular-nums;
}

.field__input {
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--fill);
  font-size: var(--fs-base);
  transition: border-color var(--dur-fast) var(--ease);
}

.field__input:focus {
  border-color: var(--focus);
  outline: none;
}

.field__hint {
  color: var(--color-text-faint);
  font-size: var(--fs-xs);
}

/*
 * 加载失败沿用 --danger，但仍留在 hint 位而不是换成 .field__error：
 * 地址本身是合法的，问题在远端，用户不需要重填格式——只需要知道这张图取不到。
 */
.field__hint.is-error {
  color: var(--danger);
}

.field__hint.is-ok {
  color: var(--color-text-dim);
}

.field__error {
  color: var(--danger);
  font-size: var(--fs-xs);
}

/* ── 成对数值输入 ─────────────────────────────────── */

/* 两个输入平分一行：宽 / 高、列 / 行都是同级的一对，竖排会拉长面板 */
.pair {
  display: flex;
  gap: var(--sp-2);
}

.actions {
  display: flex;
  gap: var(--sp-2);
}

.btn {
  flex: 1;
  padding: var(--sp-2) var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--fill-raised);
  color: var(--color-text);
  font-size: var(--fs-sm);
  line-height: 1.3;
  transition:
    background-color var(--dur-fast) var(--ease),
    border-color var(--dur-fast) var(--ease);
}

.btn:hover:not(:disabled) {
  border-color: var(--line-strong);
  background: var(--fill-hover);
}

/* 「自动」是退回默认的次要动作，不与主按钮争视觉重量 */
.btn--ghost {
  flex: none;
  background: none;
  color: var(--color-text-dim);
}

.btn:disabled {
  color: var(--color-text-disabled);
  cursor: default;
}

.btn:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/* ── 滑块 ─────────────────────────────────────────── */

.slider {
  width: 100%;
  height: 20px;
  margin: 0;
  appearance: none;
  background: none;
  cursor: pointer;
}

.slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: var(--r-full);
  background: var(--fill-hover);
}

.slider::-moz-range-track {
  height: 4px;
  border-radius: var(--r-full);
  background: var(--fill-hover);
}

/* margin-top 让圆钮相对 4px 轨道垂直居中：(4 - 14) / 2 */
.slider::-webkit-slider-thumb {
  width: 14px;
  height: 14px;
  margin-top: -5px;
  appearance: none;
  border: none;
  border-radius: 50%;
  background: var(--color-text);
  box-shadow: var(--shadow-sm);
}

.slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: none;
  border-radius: 50%;
  background: var(--color-text);
  box-shadow: var(--shadow-sm);
}

.slider:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 4px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* ── 进出场：只动 transform / opacity ───────────────── */

/*
 * 过渡刻意不落在 .scrim 上。
 *
 * 祖先的 opacity < 1 会建立新的 backdrop root，让后代的 backdrop-filter
 * 只能采样到祖先内部（此时几乎全透明），既每帧付全屏读回的代价、
 * 又看不到真正的模糊结果。所以淡入淡出只交给纯色的 __tint。
 */
.drawer-enter-active .scrim__tint,
.drawer-leave-active .scrim__tint {
  transition: opacity var(--dur-base) var(--ease);
  /* 只在动画窗口内提升；class 移除后自动撤销，不留常驻的全屏纹理 */
  will-change: opacity;
}

/* 退场期间组件还挂着，遮罩得让出点击，否则关闭后有一段时间点不动下面的方格 */
.drawer-leave-active {
  pointer-events: none;
}

.drawer-enter-from .scrim__tint,
.drawer-leave-to .scrim__tint {
  opacity: 0;
}

.drawer-enter-active .drawer,
.drawer-leave-active .drawer {
  transition:
    transform var(--dur-base) var(--ease),
    opacity var(--dur-base) var(--ease);
  will-change: transform, opacity;
}

.drawer-enter-from .drawer,
.drawer-leave-to .drawer {
  opacity: 0;
}

.drawer-enter-from .drawer--right,
.drawer-leave-to .drawer--right {
  transform: translateX(24px);
}

.drawer-enter-from .drawer--left,
.drawer-leave-to .drawer--left {
  transform: translateX(-24px);
}
</style>

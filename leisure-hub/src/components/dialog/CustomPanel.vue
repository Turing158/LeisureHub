<script setup lang="ts">
/**
 * 倒计时组件的自定义装饰折叠面板。
 *
 * 自定义文字（内容 / 颜色 / 字号 / 字重）与背景图片（无 / 网络 / 本地）。
 * 它们是附加的装饰项，不配也完整，所以收在折叠面板里，不去拉长常规配置区。
 *
 * **控件一律复用项目现成的那套。** 文本框抄 .field__input 的逐条声明（与
 * DateField 同一条理由：同一种输入框不该有两套观感）、数值走 NumberField、
 * 两处选档走 SegmentedControl、颜色走 ColorSwatches。自绘一套 select / radio 会在
 * 深色玻璃底上长出第二种观感，而且那套自绘值读不到任何令牌，主题一换就露馅。
 *
 * 折叠动画按 TabRecommend 的解法：**不用原生 `<details>`**（折叠时浏览器压根不
 * 渲染子内容，CSS 无从插值），换成 `button + div[role=region]`，用 aria-expanded
 * + aria-controls 补齐语义，高度过渡走 grid-template-rows 的 0fr → 1fr。
 * 时长吃 style.css 的令牌，data-motion=off 时自动被压成瞬时。
 */
import { computed, ref, useId } from 'vue'

import ColorSwatches from './ColorSwatches.vue'
import NumberField from '../settings/NumberField.vue'
import SegmentedControl from '../settings/SegmentedControl.vue'
import { countdownVariant, showsCustomText } from '../widgets/countdown/variant'
import { clampSpan } from '@/types/tile'

/**
 * 字重档位的键。
 *
 * SegmentedControl 的泛型约束是 string，所以数字档也写成字符串，提交时再转回数字。
 * 只给三档：正文重量、CSS 默认的 600、以及粗。九档滑块在这个面板里是噪音——
 * 一个装饰性的短文本用不到 100 与 200 的区别，而 fontWeightCheck 仍然接受它们，
 * 手改存档的人不会被这个 UI 拦住。
 */
type WeightKey = '400' | '600' | '700'

type ImageSource = 'none' | 'url' | 'local'

const props = withDefaults(
  defineProps<{
    customText?: string
    customTextColor?: string
    customTextSize?: number
    customTextWeight?: number | 'normal' | 'bold'
    customImageSource?: ImageSource
    customImageUrl?: string
    customImageData?: string
    /** 占格宽 / 高，用于判断当前尺寸是否显示自定义文字 */
    spanW?: number
    spanH?: number
  }>(),
  {
    customText: '',
    customTextColor: '',
    /** 0 即「自动」，与 NumberField 的空值约定一致（字号回落到按方块宽度算） */
    customTextSize: 0,
    /** 600 是 .cd__custom 的 CSS 默认字重，缺省档必须与它对齐 */
    customTextWeight: 600,
    customImageSource: 'none',
    customImageUrl: '',
    customImageData: '',
  },
)
const emit = defineEmits<{
  update: [
    value: {
      customText?: string
      customTextColor?: string
      customTextSize?: number
      customTextWeight?: number | 'normal' | 'bold'
      customImageSource?: ImageSource
      customImageUrl?: string
      customImageData?: string
    },
  ]
}>()

/** 与 COUNTDOWN_FIELDS 的 stringCheck 上限对齐；超出会在落格时被整条丢掉 */
const TEXT_MAX = 100
const URL_MAX = 2000

/**
 * 本地图片的两道上限。
 *
 * DATA_MAX 是硬的那道：customImageData 的校验是 stringCheck(500000)，超一个字符
 * 整条 props 就被丢掉，而方块只会安静地不显示图——所以在这里挡下来并说明原因，
 * 不让它走到存档里去。量的是**读完之后的字符串**，因为校验器量的就是它。
 *
 * FILE_MAX 是前置估算（base64 约为字节数的 4/3），先按文件大小挡一次，
 * 省掉一次几百 KB 的读取。
 */
const DATA_MAX = 500000
const FILE_MAX = 350 * 1024

const open = ref(false)
/** aria-controls / aria-labelledby 要成对的稳定 id，与 TabRecommend 同一条理由 */
const uid = useId()

/**
 * props 的字重值 → 档位键。
 *
 * 600 是 .cd__custom 的 CSS 默认，所以它是**缺省档**，落格时不写这个键——
 * 与颜色「空串不写」同一条纪律：不把「跟随默认」钉成一个具体值。
 * 其余值向最近的档靠：这功能还没发布过，实际不会有别的值，但校验器接受
 * 100..900 与 normal/bold，读到时给个确定的落点比一律回落到 600 更诚实。
 */
function weightKeyOf(value: number | 'normal' | 'bold' | undefined): WeightKey {
  if (value === 'bold') return '700'
  if (value === 'normal') return '400'
  if (typeof value === 'number') {
    if (value <= 500) return '400'
    if (value >= 700) return '700'
  }
  return '600'
}
/* ── 本地草稿 ─────────────────────────────────────── */

/*
 * 七个键各一份草稿，改动后整体 emit 一次。
 *
 * 不用 computed + setter 直连 props：那样每次输入都要父组件回传一轮，
 * 中文输入法组字期间会被打断。这里编辑期间只动本地值，emitUpdate 负责
 * 把「空 / 缺省」折成 undefined 再交出去。
 */
const text = ref(props.customText)
const textColor = ref(props.customTextColor)
const textSize = ref(props.customTextSize)
const textWeight = ref<WeightKey>(weightKeyOf(props.customTextWeight))
const imageSource = ref<ImageSource>(props.customImageSource)
const imageUrl = ref(props.customImageUrl)
const imageData = ref(props.customImageData)

/** 本地图片被拒的原因；空串即无错。用行内文案而非 alert（项目里没有第二处 alert） */
const imageError = ref('')

const sourceOptions: { value: ImageSource; label: string }[] = [
  { value: 'none', label: '无图片' },
  { value: 'url', label: '网络图片' },
  { value: 'local', label: '本地图片' },
]

const weightOptions: { value: WeightKey; label: string }[] = [
  { value: '400', label: '常规' },
  { value: '600', label: '中粗' },
  { value: '700', label: '加粗' },
]

/**
 * 当前尺寸是否显示自定义文字。
 *
 * 走 CountdownWidget 用的同两个函数（countdownVariant + showsCustomText），
 * 不在这里重写一遍 `w >= 2 && h >= 2`：那条判据一旦改档（比如将来放宽到 strip），
 * 两处会各说一套，而这个面板的提示语正是在替那条判据说话。
 * 占格走 clampSpan 夹取，与 variant.ts 的入口约定一致（可选 prop / NaN）。
 */
const willDisplay = computed(() =>
  showsCustomText(countdownVariant(props.spanW, props.spanH)),
)

/**
 * 提示文案：当前尺寸不显示自定义文字时说明原因。
 *
 * 只在填了文字且当前尺寸不显示时出现，放在文字输入框下方。
 * 预览里当场就能看出来，但预览缺一句「为什么不显示」——没有它，用户会
 * 反复检查输入框而不是去改尺寸。占格同样过 clampSpan，文案里的数字才与实际一致。
 */
const sizeHint = computed(() => {
  if (!text.value.trim() || willDisplay.value) return ''
  return `当前 ${clampSpan(props.spanW)}×${clampSpan(props.spanH)} 不显示自定义文字，2×2 及更大才显示`
})

/**
 * 剩余可输入的字数。
 *
 * 数 `.length`（UTF-16 码元）而不是 `[...s].length`（码点）：上限是硬的，由
 * stringCheck(100) 执行，而它数的就是 `.length`——两处不一致的话，一串 emoji
 * 会在计数还显示「还可输入 3 字」时就已经超了校验，落格时整条 props 被丢掉。
 * 输入框同时带 maxlength，所以这个数不会变成负的。
 *
 * 与 TabWidgetEdit 的名称计数不同，那里是**软**上限（名称没有硬校验，只是会被
 * 视觉截断），所以它允许超出并标红；这里超出等于存不进去，只能挡在输入时。
 */
const textLeft = computed(() => TEXT_MAX - text.value.length)

/**
 * 预览用的图片地址：当前来源那一路的值，没有则空串。
 *
 * 按 imageSource 取而不是「有哪个用哪个」：来源切回网络时不该继续显示上一张
 * 本地图（那张已经不参与落格了，见 emitUpdate 与 FINALIZE.countdown）。
 */
const previewUrl = computed(() => {
  if (imageSource.value === 'url') return imageUrl.value.trim()
  if (imageSource.value === 'local') return imageData.value
  return ''
})

/**
 * 把草稿交给父组件。
 *
 * 「空 / 缺省」一律折成 undefined，与颜色字段「空串不写」同一条纪律：
 * 写一个等于默认值的键进存档，只会让「跟随默认」变成「钉死在当前默认」。
 * 跨键约束（源为 none 时删图片地址、无文字时删文字样式）由 FINALIZE.countdown
 * 兜第二道，这里先按同样的规则出手，好让预览与落格后完全一致。
 */
function emitUpdate() {
  const trimmedText = text.value.trim()
  const hasText = trimmedText.length > 0

  emit('update', {
    customText: hasText ? trimmedText : undefined,
    // 文字样式只在有文字时有意义，与 FINALIZE 同一条规则
    customTextColor: hasText ? textColor.value || undefined : undefined,
    customTextSize: hasText && textSize.value > 0 ? textSize.value : undefined,
    // 600 是 CSS 默认档，不写这个键
    customTextWeight: hasText && textWeight.value !== '600' ? Number(textWeight.value) : undefined,
    customImageSource: imageSource.value === 'none' ? undefined : imageSource.value,
    customImageUrl:
      imageSource.value === 'url' ? imageUrl.value.trim() || undefined : undefined,
    customImageData: imageSource.value === 'local' ? imageData.value || undefined : undefined,
  })
}

/** 切换来源时清掉上一次的报错：它说的是另一路的事 */
function onSourceChange(value: ImageSource) {
  imageSource.value = value
  imageError.value = ''
  emitUpdate()
}

/* ── 本地图片 ─────────────────────────────────────── */

const fileInput = ref<HTMLInputElement | null>(null)

function pickFile() {
  fileInput.value?.click()
}

/**
 * 读一张本地图为 data: URI。
 *
 * 与 SettingsDrawer 的背景图不同，这里**不进 IndexedDB**：它是这个方块的一项
 * props，跟着 grid 存档走 localStorage，所以上限比那边紧得多（见 DATA_MAX）。
 * 读完立刻 emit，父组件的 previewProps 会把它送进预览里的 CountdownWidget。
 */
function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // 清掉 value，允许连续两次选同一个文件（否则 change 不会触发第二次）
  input.value = ''
  if (!file) return

  if (!file.type.startsWith('image/')) {
    imageError.value = '请选择图片文件'
    return
  }
  if (file.size > FILE_MAX) {
    imageError.value = `图片过大，请选 ${Math.round(FILE_MAX / 1024)}KB 以内的`
    return
  }

  const reader = new FileReader()
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : ''
    // 校验器量的是这个字符串，所以这道门也量它——base64 会比原文件大约三分之一
    if (!result || result.length > DATA_MAX) {
      imageError.value = `图片过大，请选 ${Math.round(FILE_MAX / 1024)}KB 以内的`
      return
    }
    imageData.value = result
    imageError.value = ''
    emitUpdate()
  }
  reader.onerror = () => {
    imageError.value = '图片读取失败，请重试'
  }
  reader.readAsDataURL(file)
}

function clearImageData() {
  imageData.value = ''
  imageError.value = ''
  emitUpdate()
}
</script>

<template>
  <div class="deco">
    <!--
      折叠头与 TabRecommend 的分类头同构：button + aria-expanded/aria-controls，
      指示器是一个按 aria-expanded 旋转的「›」。视觉状态与无障碍状态同源。
    -->
    <button
      :id="`${uid}-head`"
      class="deco__head"
      type="button"
      :aria-expanded="open"
      :aria-controls="`${uid}-panel`"
      @click="open = !open"
    >
      <span class="deco__name">自定义装饰</span>
      <span class="deco__hint">文字与背景图，可不配</span>
    </button>

    <!--
      inert 用 `|| undefined`：Vue 会把 false 原样渲染成 inert="false"，
      而该属性只看存在性，反而把展开的面板也惰化了。折叠期间内容仍在 DOM 里
      （高度才有得过渡），靠 inert 把里面的控件一并移出焦点序列与无障碍树——
      AddTileDialog 的焦点陷阱会扫 button/input，不惰化就会 Tab 进一个看不见的面板。
    -->
    <div
      :id="`${uid}-panel`"
      class="deco__panel"
      :class="{ 'is-open': open }"
      :inert="!open || undefined"
      role="region"
      :aria-labelledby="`${uid}-head`"
    >
      <div class="deco__body">
        <!-- ── 自定义文字 ───────────────────────── -->

        <label class="field">
          <span class="field__label">
            自定义文字
            <span class="field__hint">{{ textLeft > 20 ? '可留空' : `还可输入 ${textLeft} 字` }}</span>
          </span>
          <input
            v-model="text"
            class="field__input"
            type="text"
            :maxlength="TEXT_MAX"
            placeholder="叠在倒计时上的一句话"
            @input="emitUpdate"
          />
          <span v-if="sizeHint" class="field__hint">{{ sizeHint }}</span>
        </label>

        <!--
          文字样式三项只在填了文字后出现。

          没有文字时它们无处可施（FINALIZE.countdown 会把它们一并删掉），
          先摆出来只是三个改了没反应的控件。
        -->
        <template v-if="text.trim()">
          <div class="field">
            <span class="field__label">文字颜色</span>
            <ColorSwatches v-model="textColor" label="自定义文字颜色" palette="text" @update:model-value="emitUpdate" />
          </div>

          <div class="field field--row">
            <NumberField
              :id="`${uid}-size`"
              v-model="textSize"
              label="字号"
              :min="8"
              :max="32"
              unit="px"
              auto-placeholder="自动"
              @update:model-value="emitUpdate"
            />

            <div class="field field--grow">
              <span class="field__label">字重</span>
              <SegmentedControl
                v-model="textWeight"
                :options="weightOptions"
                label="自定义文字字重"
                @update:model-value="emitUpdate"
              />
            </div>
          </div>
        </template>

        <!-- ── 背景图片 ─────────────────────────── -->

        <div class="field">
          <span class="field__label">
            背景图片
            <span class="field__hint">铺满方块，倒计时叠在它上面</span>
          </span>
          <SegmentedControl
            :model-value="imageSource"
            :options="sourceOptions"
            label="背景图片来源"
            @update:model-value="onSourceChange"
          />
        </div>

        <label v-if="imageSource === 'url'" class="field">
          <span class="field__label">图片地址</span>
          <input
            v-model="imageUrl"
            class="field__input"
            type="url"
            :maxlength="URL_MAX"
            placeholder="https://"
            @input="emitUpdate"
          />
        </label>

        <div v-else-if="imageSource === 'local'" class="field">
          <span class="field__label">本地图片</span>

          <!-- 真实文件输入隐藏，视觉入口是下面那个按钮，与 SettingsDrawer 同一套 -->
          <input
            ref="fileInput"
            class="sr-only"
            type="file"
            accept="image/*"
            @change="onFilePicked"
          />

          <div class="pick">
            <button class="pick__btn" type="button" @click="pickFile">
              {{ imageData ? '重新选择' : '选择图片' }}
            </button>
            <button v-if="imageData" class="pick__btn" type="button" @click="clearImageData">
              移除
            </button>
          </div>

          <span v-if="imageError" class="field__error">{{ imageError }}</span>
          <span v-else class="field__hint">
            存进方块自身的配置里，所以限 {{ Math.round(FILE_MAX / 1024) }}KB 以内
          </span>
        </div>

        <!--
          缩略图。draggable=false 是必需的：原生图片拖放会抢掉指针，
          在对话框里表现为「按住图想拖面板，结果拖出一张图」。CSS 管不到这件事。
        -->
        <div v-if="previewUrl" class="thumb">
          <img class="thumb__img" :src="previewUrl" alt="背景图片预览" draggable="false" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * 类名用 deco 而不是 custom：ColorSwatches 的「自定义」取色行就叫 .custom，
 * 它是本组件的子孙，两者会在选择器与调试器里彼此撞名（验证脚本里
 * `.custom` 一次命中五个元素）。deco = decoration，指这一整段装饰配置。
 */
.deco {
  display: flex;
  flex-direction: column;
  /* 与 .form 的 gap 一致，折叠头看起来就是表单里的下一项 */
  border-top: 1px solid var(--line-subtle);
  padding-top: var(--sp-2);
}

/* ── 折叠头 ───────────────────────────────────────── */

.deco__head {
  display: flex;
  width: 100%;
  align-items: baseline;
  padding: var(--sp-2) 0;
  border-radius: var(--r-sm);
  gap: var(--sp-2);
  text-align: left;
  user-select: none;
}

/* 指示器与 TabRecommend 逐条一致：中性色的「›」，角度读 aria-expanded */
.deco__head::after {
  content: '›';
  color: var(--color-text-dim);
  font-size: var(--fs-md);
  line-height: 1;
  transition: transform var(--dur-base) var(--ease);
}

.deco__head[aria-expanded='true']::after {
  transform: rotate(90deg);
}

.deco__name {
  font-size: var(--fs-base);
}

.deco__hint {
  flex: 1;
  color: var(--color-text-dim);
  font-size: var(--fs-sm);
}

.deco__head:hover .deco__name {
  color: var(--color-text);
}

.deco__head:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

/* ── 展开 / 折叠动画 ─────────────────────────────── */

/*
 * 与 TabRecommend 同一套解法：0fr → 1fr 可插值，不必先用 JS 量一遍高度，
 * 内容随后变化（填了文字后多出三项、选了图后多出缩略图）也不会卡在旧值上。
 * 时长吃 style.css 的令牌，data-motion=off 时被全局压成瞬时。
 *
 * minmax(0, 0fr) 而不是裸 0fr：裸 fr 的下界是 auto，子元素的 margin
 * 会作为轨道的自动最小值留下收不掉的残高。
 *
 * ── 横向那 3px ──
 * 折叠动画要求这里 overflow: hidden，而 ColorSwatches 的选中态是
 * `box-shadow: 0 0 0 2px var(--accent)`、焦点环是 `outline-offset: 2px`，
 * 两者都长在元素盒子**外面**。色板是 auto-fill 网格、左右都贴着容器边缘
 * （实测容器与首格同为 x=441），那 2px 于是被裁掉——表现就是用户说的
 * 「第一列看不到左边框和左上、左下的圆角」。
 *
 * 内边距必须落在**裁切的这一层**上：overflow 的裁切边是 padding box，
 * 所以 padding 撑开的这 3px 是可见区。挪到内层子元素上没有用——
 * 那只是把子元素往里推，裁切边仍在原处，实测子元素照旧落在 x=441。
 * 负 margin 把这一层整体拉回与其他表单项齐平，于是视觉上没有缩进。
 *
 * 3px 而不是 2px：2px 刚好等于环宽，抗锯齿的最外一像素仍会被切。
 * **只给横向**：纵向也给的话，折叠态会剩下 6px 收不掉的残高（padding 不参与
 * 行轨道尺寸，minmax(0,0fr) 压不到它）；而色板上下各有 12px 的 gap 邻居，
 * 纵向本来就不贴边。
 *
 * 不改 ColorSwatches 自身——它同时服务其他 tab（那里没有裁切），
 * 为这一个消费方去动共享组件的选中态是把问题挪了个地方。
 * 负 margin 也不会带来横向滚动条：对话框 .panel__body 是 `overflow: hidden auto`，
 * X 轴本就被裁掉，而它自己还有 20px 内边距。
 */
.deco__panel {
  display: grid;
  grid-template-rows: minmax(0, 0fr);
  overflow: hidden;
  margin-inline: -3px;
  padding-inline: 3px;
  opacity: 0;
  transition:
    grid-template-rows var(--dur-base) var(--ease),
    opacity var(--dur-fast) var(--ease);
}

.deco__panel.is-open {
  grid-template-rows: minmax(0, 1fr);
  opacity: 1;
}

/* grid item 的自动最小高度同样会顶住 0fr，一并归零 */
.deco__panel > * {
  min-height: 0;
}

.deco__body {
  display: flex;
  flex-direction: column;
  /* 顶间距留在被裁切的内容里，折叠后不会剩下一条空隙 */
  padding-top: var(--sp-1);
  gap: var(--sp-3);
}

/* ── 表单项 ───────────────────────────────────────── */

.field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--sp-1);
}

/* 字号与字重并排：两项都窄，竖排会把面板拉长一截 */
.field--row {
  flex-direction: row;
  align-items: flex-end;
  gap: var(--sp-2);
}

.field--grow {
  flex: 1;
}

.field__label {
  display: flex;
  align-items: baseline;
  color: var(--color-text-dim);
  font-size: var(--fs-sm);
  gap: var(--sp-2);
}

.field__hint {
  color: var(--color-text-faint);
  font-size: var(--fs-xs);
}

.field__error {
  color: var(--danger);
  font-size: var(--fs-xs);
}

/*
 * 与 TabWidgetEdit / DateField 的 .field__input 逐条一致：
 * 同一种输入框不该有两套观感。逐条抄而不是抽公共类，与 DateField 同一条理由
 * ——scoped 样式过不去，而这几行是这套对话框的既有语言。
 */
.field__input {
  min-width: 0;
  padding: var(--sp-2) var(--sp-3);
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

.field__input::placeholder {
  color: var(--color-text-faint);
}

/* ── 本地图片 ─────────────────────────────────────── */

.pick {
  display: flex;
  gap: var(--sp-2);
}

/* 与 .field__input 同一套描边与圆角，只是按钮的内边距 */
.pick__btn {
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--fill);
  font-size: var(--fs-base);
  transition:
    border-color var(--dur-fast) var(--ease),
    background-color var(--dur-fast) var(--ease);
}

/* hover 用中性描边：--accent 只留给「已选中」这类状态 */
.pick__btn:hover {
  border-color: var(--line-strong);
  background: var(--fill-raised);
}

/* 内描焦点环：面板 overflow: hidden 会裁掉外扩的轮廓 */
.pick__btn:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

/*
 * 缩略图与 SettingsDrawer 的 .thumb 同构，但**不是正方形**：
 * 图片会以 cover 铺在方块上，而方块常是 2×1 这类横向形状，
 * 16/9 比 1/1 更接近它落地后的样子。宽度给一个上限，免得一张图把面板撑高。
 */
.thumb {
  overflow: hidden;
  width: 140px;
  max-width: 100%;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--fill);
}

.thumb__img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.sr-only {
  position: absolute;
  overflow: hidden;
  width: 1px;
  height: 1px;
  border: 0;
  margin: -1px;
  padding: 0;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>

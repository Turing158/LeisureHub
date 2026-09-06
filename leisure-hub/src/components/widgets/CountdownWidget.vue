<script setup lang="ts">
/**
 * 倒计时 / 纪念日方块。
 *
 * 与日历 / 天气 / 搜索 / 待办同一套 widget 契约：占格形状决定版式
 * （见 countdown/variant.ts），配置存在 WidgetTile.props 里。
 *
 * **数据走 props，和搜索的 engineId 同一条路，不走待办那条。** 待办的三条理由
 * 在这里逐条反向成立：一个日期串加一个布尔本就是「少量标量」、目标日期永远不在
 * 渲染中被改写（只在保存时写一次）、方块删掉时日期跟着消失是**对的**。
 * 于是多实例是这个决定的正面收益而不是代价——桌面上一格「项目上线」、
 * 一格「妈妈生日」，这才是它的常态。
 *
 * **不写 interactive**：方块内没有任何控件，`<input type="date">` 只存在于
 * 编辑对话框里。TileCell 因此走既有的「整体拖拽 / 点开编辑」那条路。
 */
import { computed } from 'vue'

import { countdownText, dayDiff, nextAnniversary, parseDateParts } from './countdown/dayDiff'
import { countdownVariant, showsCustomText } from './countdown/variant'
import { useToday } from '@/composables/useToday'
import { clampSpan } from '@/types/tile'
import { isHexColor } from '@/utils/color'

const props = defineProps<{
  /** 目标日期 `YYYY-MM-DD`；缺省即「未配置」态 */
  targetDate?: string
  /** 按年重复（生日、纪念日）。缺省即单次事件 */
  repeatYearly?: boolean
  /** 方块底；缺省沿用方格自身的玻璃底 */
  bgColor?: string
  /** 大数字 */
  textColor?: string
  /** 前缀、单位、日期行 */
  subTextColor?: string
  /** 占格宽 / 高，由 TileWidget 透传；缺省按 1×1 处理（拖拽浮层与卡片列表不传） */
  spanW?: number
  spanH?: number
  /** 自定义文字 */
  customText?: string
  /** 自定义文字颜色 */
  customTextColor?: string
  /** 自定义文字大小（px） */
  customTextSize?: number
  /** 自定义文字字重 */
  customTextWeight?: number | 'normal' | 'bold'
  /** 自定义图片来源：'none' | 'url' | 'local' */
  customImageSource?: 'none' | 'url' | 'local'
  /** 网络图片 URL */
  customImageUrl?: string
  /** 本地图片 data: URI */
  customImageData?: string
}>()

/**
 * 跨零点更新**一行都不用新写**：useToday 已经做完了全部工作（模块级共享定时器、
 * 引用计数、visibilitychange 补齐、以当前时钟为准重排）。
 *
 * 日历与倒计时因此在零点翻页是**同一次** ref 写入，不会一个先一个后。
 *
 * **不需要秒级刻度。** 「还有 3 天 7 小时 22 分」要一个 setInterval(1000)，
 * 而它带来的是一个永远在动的方块——在导航站这种长期开着的页面上那是干扰。
 */
const today = useToday()

/** 未配置 / 脏数据都落到 undefined，两者渲染同一个提示态 */
const parts = computed(() => parseDateParts(props.targetDate))

/**
 * 实际参与计算的那一天。
 *
 * 按年重复时是「下一次纪念日」（今天就是的话停在今天，见 nextAnniversary），
 * 否则就是存的那一天本身。
 */
const target = computed(() => {
  const p = parts.value
  if (!p) return undefined
  return props.repeatYearly === true
    ? nextAnniversary(today.value, p.month, p.day)
    : new Date(p.year, p.month - 1, p.day)
})

const diff = computed(() => {
  const t = target.value
  return t ? dayDiff(today.value, t) : undefined
})

const text = computed(() => (diff.value === undefined ? undefined : countdownText(diff.value)))

/**
 * 主文字占几个「数字宽」，1..4（或「今天」那一档的 3.34）。
 *
 * **位数是第二个自变量**，按宽算还不够：「还有 3 天」和「已经 9618 天前」的字符数
 * 差 4 倍，而位数不是占格能预测的——同一个 1×1 方块，今天两位数，三个月后三位数。
 * 按最坏情况（4 位）定死会让绝大多数方块的数字白白小一半；不管它则四位数溢出。
 * 所以它进 CSS，由 .cd__num 的 font-size 拿它算字宽预算（分母是 0.6em/字）。
 *
 * **「今天」不能按 2 计。** 那是两个**全角**汉字，各占约 1em 而不是 0.6em，
 * 按 2 算会让它比 2 位数字宽出 67%——1×1 上正好溢出。折算成 2 × (1 / 0.6) = 3.34
 * 个数字宽，于是同一条 CSS 公式对两种字形都成立，不必为它开一个分支。
 */
const CJK_PER_DIGIT = 1 / 0.6

const numWidthUnits = computed(() => {
  const value = text.value?.value
  if (!value) return 1
  const numeric = /^\d+$/.test(value)
  const units = numeric ? value.length : value.length * CJK_PER_DIGIT
  return Math.round(units * 100) / 100
})

const variant = computed(() => countdownVariant(props.spanW, props.spanH))

/**
 * 自定义文字是否在当前版式显示。
 *
 * 只有 panel 档（w≥2 且 h≥2）画自定义文字；其余三档空间太紧，强行塞进去会压坏数字。
 */
const displaysCustomText = computed(() => showsCustomText(variant.value) && !!props.customText)

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const

/**
 * 是否说出目标日的星期。
 *
 * 两个入口，判据都是「星期有没有一个自己的位置」而不是方块大不大：
 *   - w ≥ 3（strip / panel）：strip 这一档右侧有一个三行的副栏，星期占最后一行；
 *     panel 的日期行独占一行，265 − 24 = 241px 放得下「2027年1月1日 星期五」。
 *     **w=2 一定不能画**：那一档 strip 走两行式，第二行就是 dateLine
 *     （`2015 年 12 月 31 日`，实测墨迹 118px 于 144px 可用宽内），
 *     追加「星期四」要再吃 46px，正好越界被 ellipsis 削掉
 *   - column 的 h=4：那一档页脚有三行，星期占最后一行（见 dateWeekday）；
 *     h≤3 的页脚只排得下年份与月日
 *
 * 抽成一个判据是因为它有三个消费方——column 的页脚行、strip 的副栏行，以及
 * `.sr-only` 里的那句摘要（它走 dateLine）。三处各写一遍迟早会走岔：
 * 读屏听到的与看到的不是同一件事，而这种偏差没有任何断言看得见。
 */
const showsWeekday = computed(
  () => clampSpan(props.spanW) >= 3 || (variant.value === 'column' && clampSpan(props.spanH) >= 4),
)

/**
 * 日期整句。**三个消费方**：panel 档的日期行、strip 两行式（w=2）的第二行，
 * 以及 `.sr-only` 里那句摘要。
 *
 * w≥3 的 strip 不用它——那两档把日期拆成三行副栏（dateYear / dateMd /
 * dateWeekday），理由见 .cd__stripSide：拼成一句约 127px，会把连接线压到地板。
 *
 * repeatYearly 时**改写成「每年 1 月 1 日」，不显示存的年份**：那个年份此时是
 * 无意义的（用户存 2000 年的生日，显示 2000 只会让人以为算错了）。
 * 同一句话也解释了它为什么在这里提前返回、连星期都不追加——「每年 5 月 1 日」
 * 落在哪个星期每年都不一样，说一个出来就是错的。
 */
const dateLine = computed(() => {
  const p = parts.value
  const t = target.value
  if (!p || !t) return ''
  if (props.repeatYearly === true) return `每年 ${p.month} 月 ${p.day} 日`

  const base = `${p.year} 年 ${p.month} 月 ${p.day} 日`
  return showsWeekday.value ? `${base} 星期${WEEKDAYS[t.getDay()]}` : base
})

/**
 * column 档（w=1，h≥2）的前缀槽。
 *
 * **这一档的三种形状只能靠内容分档，字号一个像素都动不了。** 数字被 0.42 × 75
 * 那一支封在 31.5px 以内，h 从 2 涨到 4 多出来的 242px 换不来更大的字——
 * 按宽算是这个组件的根规则，而按高算会把「起名 / 没起名差 26px」的高度二义性
 * 引进来（同一个 1×2，起名 196px、没起名 222px，字号会跟着变两档）。
 * 于是高度只兑成两样东西：中间那道竖线的长度（见模板里 .cd__colRule 那段），
 * 以及日期三槽（dateYear / dateMd / dateWeekday）从省略变成显示。
 *
 * 前缀（`还有` / `已经`）的门槛是 h≥3。它与单位重复的是**方向**而不是句子——
 * `还有` / `240` / `天` 竖着读下来才是一句完整的话，panel 档三行式正是这么排的
 * （那一档也同时画前缀行与单位）。h=2 不画：194px 是这一档最紧的高度，
 * 而这句话少了它仍然完整。
 *
 * 只按占格取舍、**不看数值**：让某一行随着天数从 4263 掉到 999 又冒出来，
 * 比一直不画更让人费解（stripPrefix 那段已经立过这条规矩）。
 */
const columnPrefix = computed(() =>
  clampSpan(props.spanH) >= 3 ? (text.value?.prefix ?? '') : '',
)

/**
 * 日期的三个槽：年份 / 月日 / 星期。**column 的页脚与 strip 的副栏共用它们。**
 *
 * 两处的构成本来就该是同一个（都是「把一个日期竖着拆成三行」），而分开写两份
 * 的下场是 strip 那档漏掉层级——改造前它只有一条 15px 的均质日期串，
 * 而 column 早就有「月日重一档」了。同一个组件横着比竖着讲究，那是缺陷不是取舍。
 *
 * 共用的只是**内容**，不是样式：两处的字号系数差一个数量级（column 宽 75px 用
 * 0.115w，strip 宽 263..358px 用 0.065w），所以 CSS 仍是 .cd__colDay 与
 * .cd__stripMd 两条。类名描述位置，这几个计算属性描述内容。
 *
 * 按「少了这一行会丢掉什么」逐槽定门槛：
 *   - 月日（`5/1`）：两档都恒画，它是「什么时候」的答案
 *   - 「每年」：恒画。它改的是那个日期的**含义**（这事会再来一次），
 *     不是给已知的事加个注脚。原先 column 只画 `M/D`，一格生日与一格单次事件
 *     长得一模一样，而 strip 与 panel 都分得出来——这一条是补掉那个缺陷
 *   - 年份（`2027`）：strip 恒画（副栏三行都排得下）；column 要 h≥3。
 *     `5/1` 单独出现读不出是哪一年，倒数上来的那一路（「已经 3899 天前」）
 *     尤其要它——3899 天是几几年没人心算得出来。重复那一路没有年份可画，
 *     「每年」占着同一个槽
 *   - 星期（`星期六`）：走 showsWeekday（strip 的 w≥3、column 的 h=4）
 *
 * column 把日期拆成三行、不拼成 `2027-5-1` 一行：10px 字（这个宽度下 clamp 已压到
 * 下界）里最坏的 `2015-12-31` 约 54.6px，吃掉 59px 可用宽的 93%——那是一行装不下的
 * 量级，而一行放不下时该丢段或换行，不该靠 ellipsis 削出一个「2015…」。拆开之后
 * 每行最宽只有 30px 上下，剩下的宽度成了两侧的留白。strip 的副栏沿用同一个拆法，
 * 那里的理由是横向预算要留给连接线（见 .cd__stripSide）。
 *
 * **重复那一路不画星期**：`每年` 与 `星期六` 并排会读成「每年都是星期六」，
 * 而那是假的。dateLine 也正是为这条判据在 repeatYearly 时提前返回。
 */
const dateYear = computed(() => {
  const p = parts.value
  if (!p) return ''
  // 「每年」恒画：它改的是那个日期的含义，不是给已知的事加注脚
  if (props.repeatYearly === true) return '每年'
  // strip 的副栏三行都排得下；column 的 h=2 页脚只排得下月日
  return variant.value === 'strip' || clampSpan(props.spanH) >= 3 ? String(p.year) : ''
})

const dateMd = computed(() => {
  const p = parts.value
  return p ? `${p.month}/${p.day}` : ''
})

const dateWeekday = computed(() => {
  const t = target.value
  if (!t || !showsWeekday.value || props.repeatYearly === true) return ''
  return `星期${WEEKDAYS[t.getDay()]}`
})

/**
 * strip 档的 w=2 是否走**两行式**。
 *
 * 这一档 168px 宽，一行上塞不下「数字 + 单位 + 日期」（原先索性一个日期字都不画，
 * 于是 defaultSpan 落格后的那一格说不出「什么时候」——而那正是用户第一眼看到的
 * 形状）。改成把日期整句摞到主组下面：73px 的带高里两行分别 44 + 14.3px，
 * 加 2px 间距合计 60.3px，两端各留六个像素。
 *
 * w≥3 反过来不能摞：那两档宽 263 / 358px，两行式会让墨迹只占 50..60% 的宽而
 * 纵向贴死；而它们的宽度足够开出「主组 | 连接线 | 副栏」三段（见 .cd__stripRule）。
 *
 * 判据只看占格，与位数无关——同一格的构图不能随天数从 4 位掉到 1 位而改变。
 */
const stripStacked = computed(() => clampSpan(props.spanW) === 2)

/**
 * 颜色写成内联的 CSS 变量而非直接的 color / background，与另外四个组件同构。
 *
 * 变量没被设上时，样式里的 `var(--cd-text, <令牌>)` 自动回落到主题令牌，
 * 「未配置」与「配成当前主题色」因此是两种状态——前者跟着主题走。
 *
 * 仍要过一遍 isHexColor：这些值来自持久化数据，store 已校验过，这里是第二道。
 */
const colorStyle = computed(() => {
  const vars: Record<string, string> = {}
  const set = (name: string, value: string | undefined) => {
    if (isHexColor(value)) vars[name] = value
  }
  set('--cd-bg', props.bgColor)
  set('--cd-text', props.textColor)
  set('--cd-sub-text', props.subTextColor)
  return vars
})

/**
 * 背景图片样式。
 *
 * source='url' 或 'local' 时生成 background-image，'none' 或未设时不生成。
 * 图片以 cover 铺满、居中、不重复，叠在 --cd-bg 或玻璃底之上。
 */
const backgroundStyle = computed(() => {
  const { customImageSource, customImageUrl, customImageData } = props
  if (customImageSource === 'url' && customImageUrl) {
    return { backgroundImage: `url("${customImageUrl}")` }
  }
  if (customImageSource === 'local' && customImageData) {
    return { backgroundImage: `url("${customImageData}")` }
  }
  return {}
})

/**
 * 自定义文字的样式。
 *
 * 字号三上界取最小：
 *   1. 用户设的（customTextSize，未设时此支不参与）
 *   2. 按宽等比（0.1 × 方块宽，下界 12px 上界 22px）
 *   3. 硬上限 32px（再大就不是标题而是主角了）
 *
 * 行数只交出一个 `--cd-custom-lines`，截断规则留在 CSS 里。
 * **不在这里写 -webkit-line-clamp / -webkit-box**：带厂商前缀的属性经由 JS 的
 * 内联样式要靠框架的 autoPrefix 猜一次驼峰名，而写成自定义属性没有这层不确定性
 * ——同一条 CSS 声明在样式表里是无歧义的。
 */
const customTextStyle = computed(() => {
  const vars: Record<string, string> = {}
  if (props.customTextColor && isHexColor(props.customTextColor)) {
    vars.color = props.customTextColor
  }

  // 字号三上界：用户设的 / 按宽等比 / 硬上限 32px
  const sizeByWidth = 'clamp(12px, calc(var(--cd-w) * 0.1), 22px)'
  vars.fontSize =
    props.customTextSize && props.customTextSize > 0
      ? `min(${props.customTextSize}px, ${sizeByWidth}, 32px)`
      : `min(${sizeByWidth}, 32px)`

  if (props.customTextWeight && props.customTextWeight !== 'normal') {
    vars.fontWeight = String(props.customTextWeight)
  }

  /*
   * 行数按高度分：h=2 一行，h≥3 两行。
   *
   * h=2 那一档纵向最紧（数字区扣掉标题后实得 ~105px），第二行会把数字压到
   * --cd-cap 之下；h≥3 带高 300px 以上，两行仍留得出余量。
   */
  vars['--cd-custom-lines'] = clampSpan(props.spanH) >= 3 ? '2' : '1'

  return vars
})

/**
 * strip 档实际画出来的前缀：**只有 w=4 画**。
 *
 * 门槛不因改版式而放宽，尽管双区构图腾出了横向余量——那些余量的去处是**连接线**
 * （见 .cd__stripRule），不是再塞一段字。量出来的账（w=3，263px）：
 * padding 24 + 数字 106（四位 × 44px）+ 单位 40 + gap 4 + 连接线 min 8
 * + gap 10 + 副栏 49 = 241，余 22px；前缀那 40 + 一道 gap 加进来就超 22px，
 * 而超出的部分先吃掉的是连接线（它是 flex: 1），于是构图塌掉。
 *
 * **让前缀先走，不让日期先走**，尽管日期在这一行里排位更次要：
 * 前缀与单位是重复的——`天` / `天前` 本身就带着方向，去掉「已经」方向没丢
 * （micro 与 w=2 早就照这条判据不画前缀了）；而日期不与任何一段重复，
 * 它是这一行唯一还没被说出来的信息。让它让位只会得到一个「2015…」的碎片。
 *
 * 顺带的收益：w=2 上前缀原本把两端各裁掉 4.5px（「已」与「前」各缺一角），
 * 而数字的宽度预算被前缀挤到只剩 23px——那时数字只比单位大 1.2 倍，
 * 「主 / 副」的层级读不出来。去掉前缀后数字回到 41.9px。
 *
 * 判据只看占格、不看位数：让「已经」随着天数从 4263 掉到 999 又冒出来，
 * 比一直不画更让人费解。
 */
const stripPrefix = computed(() =>
  clampSpan(props.spanW) >= 4 ? (text.value?.prefix ?? '') : '',
)

/**
 * 与数字**同一行**的副信息共几个字。
 *
 * 数字的宽度预算要扣掉它们（见 CSS 的 --cd-num-reserve）：不扣的话四位数会把
 * 单位顶出方格——实测 panel 2×2 上数字自己就探出 2.8px、「天前」被裁掉同样的量，
 * 而这与版式用 flex 还是 grid 无关（两种写法量到同一个值）。
 *
 * 哪几段算「同一行」由版式决定，所以这个判断留在 JS 里（variant 在这里）：
 *   - panel：单位与数字并排，前缀独占一行 → 只数单位
 *   - strip：前缀、数字、单位同在主组那一行上（.cd__stripMain）→ 两个都数。
 *     连接线与副栏**不数**：它们不与数字争这条预算——连接线是 flex: 1
 *     的伸缩项，副栏的每一段都带 ellipsis（.cd__date 自带），挤不下时是它们收窄
 *   - micro / column：单位在数字**下一行** → 0，这两档不受影响
 *
 * 只交出字数，宽度换算留在 CSS：副信息一律是汉字（`天` / `天前` / `年后` /
 * `年前` / `还有` / `已经`），每个约 1em，而那个 em 是 --cd-sub-fs，
 * 那条 clamp 只存在于样式表里。
 */
const inlineSubChars = computed(() => {
  const t = text.value
  if (!t) return 0
  if (variant.value === 'panel') return t.unit.length
  if (variant.value === 'strip') return t.unit.length + stripPrefix.value.length
  return 0
})

/** 字宽预算进 CSS，与颜色合成同一个 style 对象 */
const rootStyle = computed(() => ({
  ...colorStyle.value,
  ...backgroundStyle.value,
  '--cd-digits': String(numWidthUnits.value),
  '--cd-inline-sub': String(inlineSubChars.value),
  // panel 档显示自定义文字时，数字纵向上界从 80 降到 72
  ...(displaysCustomText.value && variant.value === 'panel' ? { '--cd-cap': '72px' } : {}),
}))

/**
 * 可读摘要。
 *
 * 与日历 / 待办同一条：TileCell 对 widget 刻意不写 aria-label，否则按钮名会盖掉
 * 这里的内容，读屏只听得到「倒计时」而听不到还有几天。各版式的可见文字一律
 * aria-hidden，唯一的可读内容始终是这一句 .sr-only。
 *
 * 自定义文字若存在也要说出来（在视觉上它是首行标题），即使当前版式不显示
 * （存档里有这个键，用户拉大方块后会露出来）。
 */
const summary = computed(() => {
  const customPrefix = props.customText ? `${props.customText}，` : ''
  const t = text.value
  if (!t) return `倒计时：${customPrefix}未设置日期`
  const when = dateLine.value ? `，${dateLine.value}` : ''
  return `倒计时：${customPrefix}${t.prefix}${t.value}${t.unit}${when}`
})
</script>

<template>
  <div class="cd" :class="`cd--${variant}`" :style="rootStyle">
    <span class="sr-only">{{ summary }}</span>

    <!--
      未配置态。判据抄天气那句（1×1「连『点右键设置地点』这句自解释文案都放不下，
      用户看到的会是一个不知所以的齿轮」）：micro 只画一个「—」，其余档给两行提示。

      注册表的 defaultSpan 取 2×1 正是为了让**落格后的那一档**有这两行；
      micro 是用户自己选出来的尺寸，不是默认落格的样子。
    -->
    <div v-if="!text" class="cd__blank" aria-hidden="true">
      <template v-if="variant === 'micro'">
        <span class="cd__dash">—</span>
      </template>
      <template v-else>
        <span class="cd__blankMain">未设置日期</span>
        <span class="cd__blankHint">右键设置</span>
      </template>
    </div>

    <!--
      micro（1×1）：数字在上、单位在下，竖排两行。

      前缀这一档**不画**——59px 放不下两个汉字加数字，而单位本身就带着方向
      （`天` / `天前`），方向没丢。
    -->
    <div v-else-if="variant === 'micro'" class="cd__micro" aria-hidden="true">
      <span class="cd__num">{{ text.value }}</span>
      <span v-if="text.unit" class="cd__unit">{{ text.unit }}</span>
    </div>

    <!--
      strip（h=1，w≥2）：两种构成，由 stripStacked 分。

      **w=2 两行式**：主组在上、整句日期在下。原先这一档一个日期字都不画
      （一行上塞不下），于是 defaultSpan 落格后的那一格说不出「什么时候」——
      而那正是用户第一眼看到的形状。73px 里 44 + 2 + 14.3 = 60.3px，两端各留六个像素。

      **w≥3 双区**：主组 | 连接线 | 副栏。三件事同时解决：
        - 主组换 grid（见 .cd__stripMain）后整组真正纵向居中。原先单行 flex +
          align-items: baseline，基线组的兜底对齐是 cross-start，整组顶到上边，
          实测墨迹中心比方格中心高 10.88px（起名）/ 26.19px（没起名）
        - **连接线吃掉全部横向余量**，于是那个洞不再是「剩下多少算多少」。原先日期靠
          margin-left: auto 推到右端，主组与日期之间的空隙 3×1 是 20..127px、
          4×1 是 71..183px——同一格的构图随天数位数变形，4×1 的「今天」中间是一片
          183px 的空白。改后线宽 32..179px，而线是唯一会长个的东西
        - 副栏抄 column 档的页脚（年 / 月日 / 星期，月日重一档）。原先这里是一条
          15px 的均质日期串，而竖版早就有层级了——同一个组件横着比竖着讲究，
          那是缺陷不是取舍

      连接线的四条纪律与 .cd__colRule 完全同源（不是块面、不做进度条、颜色跟
      --cd-sub-text 走、可以被压缩到消失），只是转了 90 度；细节见那一段。

      **自定义文字这一档仍然不画**（showsCustomText 只放 panel）。两条路都量过：
      塞进副栏顶行，4×1 只剩 72px ≈ 4 个可见字（「项目上…」，正是既有纪律说不要的
      碎片）；放主组上方，主字被迫从 44 压到 36px，而 3×1 的长标题照旧溢出 6px。
    -->
    <div
      v-else-if="variant === 'strip'"
      class="cd__strip"
      :class="{ 'cd__strip--stacked': stripStacked }"
      aria-hidden="true"
    >
      <div class="cd__stripMain">
        <span v-if="stripPrefix" class="cd__prefix">{{ stripPrefix }}</span>
        <span class="cd__num">{{ text.value }}</span>
        <span v-if="text.unit" class="cd__unit">{{ text.unit }}</span>
      </div>

      <!-- w=2：整句日期摞在主组下面，不拆三行（144px 可用宽装得下 118px 的墨迹） -->
      <span v-if="stripStacked" class="cd__date cd__stripSub">{{ dateLine }}</span>

      <!-- w≥3：连接线 + 三行副栏 -->
      <template v-else>
        <div class="cd__stripRule"></div>
        <div class="cd__stripSide">
          <span v-if="dateYear" class="cd__date">{{ dateYear }}</span>
          <span class="cd__date cd__stripMd">{{ dateMd }}</span>
          <span v-if="dateWeekday" class="cd__date">{{ dateWeekday }}</span>
        </div>
      </template>
    </div>

    <!--
      column（w=1，h≥2）：一句话在上、目标日在下，中间一道竖线把两头连起来。

      **竖线是这一档的结构**，也是三种形状唯一真正吃得下高度的东西。这一档只有
      四个短字符串，59px 宽下数字已经被 0.42w 顶到 31.5px 封顶（三位数正好铺满
      可用宽），再高的方块换不来更大的字也换不来更多的字——1×4 有 436px，
      而全部文字加起来只有 86px。原先三段一起居中，量到的就是 54px 内容浮在
      462px 正中、上下各空 200px。摊成 space-between 也只是把一个 200px 的洞
      变成两个 90px 的洞：CalColumn 与 TodoRail 能靠「摊成带间距」解决，是因为
      它们手里有周历轨与点阵这种**会长个的内容**，倒计时没有。

      于是让那道空白自己变成内容：一条从「现在」拉到「那一天」的竖线，
      flex: 1 吃掉全部余量（96 / 186 / 296px 三档），版面因此在三种高度上
      都是同一个构图，只是线更长、日期更细。它不带任何信息，所以摘要里没有它。

      画线而不画条块：倒计时**没有次要块面**（COUNTDOWN_FIELDS：「它没有任何
      次要块面……subBgColor 配了看不见」），加一块就得同时给它加一个配色项；
      而 1px 的线不是块面，站内已有六个组件用 --tile-border 画这种线。
      横向也不画分隔线——75px 宽里一道横线只会把内容切得更碎（CalColumn 写过）。

      三档同一个构图、不分叉成「有线 / 无线」两种形态，理由抄 CalColumn：
      「某一档单独换层级会让相邻两档看起来像换了个组件」。

      **不画标签**：61px 可用宽，一个被截成「项目上…」的标签不如不画，
      理由与 TodoRail 不放文字同源。

      页脚三槽（dateYear / dateMd / dateWeekday）与 strip 的副栏共用同一组计算属性：
      两处都是「把一个日期竖着拆成三行」，分开写两份的下场就是 strip 那档曾漏掉层级。
    -->
    <div v-else-if="variant === 'column'" class="cd__column" aria-hidden="true">
      <span v-if="columnPrefix" class="cd__prefix">{{ columnPrefix }}</span>
      <div class="cd__colMain">
        <span class="cd__num">{{ text.value }}</span>
        <span v-if="text.unit" class="cd__unit">{{ text.unit }}</span>
      </div>
      <div class="cd__colRule"></div>
      <div class="cd__colFoot">
        <span v-if="dateYear" class="cd__date">{{ dateYear }}</span>
        <span class="cd__date cd__colDay">{{ dateMd }}</span>
        <span v-if="dateWeekday" class="cd__date">{{ dateWeekday }}</span>
      </div>
    </div>

    <!--
      panel（w≥2，h≥2）：自定义文字（可选）+ 前缀行 + 大数字 + 日期行。

      自定义文字作为首行标题，放在前缀行之上；只在 panel 档显示，且必须有内容。
      三行式的前缀行原本是方格名，同 strip 的理由改成前缀行（「还有」/「已经」）
      ——它是这一档唯一被拆出来的副信息，而数字与单位在中间那行并排。
      「今天」那一档没有前缀也没有单位，顶行自然收掉，大字独占中央。

      自定义文字存在时，数字纵向上界从 80 降到 72（--cd-cap 在 rootStyle 里覆写）。
    -->
    <div v-else class="cd__panel" aria-hidden="true">
      <span v-if="displaysCustomText" class="cd__customText" :style="customTextStyle">
        {{ customText }}
      </span>
      <span v-if="text.prefix" class="cd__prefix">{{ text.prefix }}</span>
      <div class="cd__panelMain">
        <span class="cd__num">{{ text.value }}</span>
        <span v-if="text.unit" class="cd__unit">{{ text.unit }}</span>
      </div>
      <span class="cd__date">{{ dateLine }}</span>
    </div>
  </div>
</template>

<style scoped>
/*
 * 尺寸基准与日历同一套三级回落：
 *   --cd-w  真实宽度，由 TileCell 的 --square-w 继承而来（自定义属性穿透 scoped）。
 * 回落链末端是 --tile-size，兼容只覆写了后者的调用方（拖拽浮层、卡片列表）。
 *
 * 注意：拖拽浮层把 --tile-size 设成了 min(w, h)，所以不得直接读它，只能读这个别名。
 *
 * **纵向一个换算都没有。** 这是整个组件最关键的一条取舍：同一形状有两个高度
 * （起名 196 / 没起名 222，差 26px），按高算的比例系数在两档上差 13%，而倒计时是
 * 一个居中的大字，**没有可以吸收那 26px 的第三方**（待办靠 overflow-y 吸收、
 * 日历必须按高算所以必须两档都量）。于是字号一律按宽算，纵向只用 flex 居中——
 * 多出来的 26px 全归留白，不影响任何字号。
 */
.cd {
  --cd-w: var(--square-w, var(--content-size, var(--tile-size)));
  /*
   * 左右内边距**合计**，从字宽预算里扣掉。
   *
   * 写成绝对像素而不是 --cd-w 的比例：下面各档的 padding 本身就是绝对值
   * （12px / 8px），比例式会在 w=4 上扣掉 57px 的假预算，把大方块的字压小。
   * micro 那一档 padding 更窄，它自己覆写这个值。
   */
  --cd-pad: 24px;
  /* 由脚本写入的字宽预算（数字个数或汉字折算），1..4；未设上时按 2 算 */
  --cd-digits: 2;
  /*
   * 副信息字号。
   *
   * 抽成变量而不是写在 .cd__prefix / .cd__unit 里，是因为**数字的宽度预算要读它**
   * ——panel 与 strip 把副信息摆在数字同一行上，那一行的可用宽得先扣掉它们。
   * 两端夹死的理由见 .cd__prefix 那段。
   */
  --cd-sub-fs: clamp(11px, calc(var(--cd-w) * 0.11), 20px);
  /*
   * 同一行上要让给副信息的横向宽度，默认 0（micro / column 把单位摆在下一行）。
   *
   * 各档的算式都是 `字数 × (1em + 一道 gap)`：同行副信息一律是汉字（`天` /
   * `天前` / `年后` / `年前` / `还有` / `已经`），每个约 1em，而那个 em 是
   * --cd-sub-fs。gap 乘进括号里，于是 --cd-inline-sub 为 0 时整项**真的归零**
   * （「今天」那一档没有单位，micro / column 两档一个都不同行）——写在括号外面
   * 会让这两种情况白扣掉一道 gap。代价是两个字时多留一道，而多留只是数字略小，
   * 少留就是溢出。
   */
  --cd-inline-sub: 0;
  --cd-num-reserve: 0px;
  /*
   * 数字字号的纵向上界，各档覆写。
   *
   * 根上给一个宽松的默认（micro 那一档纵向本来就够，由 0.42 那支先封顶），
   * 真正吃紧的是 strip（带高 75/101）与 panel（前缀行 + 日期行之后的余量）。
   */
  --cd-cap: 999px;

  /* .sr-only 是绝对定位的，没有定位祖先时会逃到初始包含块 */
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  /* 未配置时 --cd-bg 未定义，透出方格自身的玻璃底 */
  background: var(--cd-bg, transparent);
  /*
   * 背景图片以 cover 铺满、居中、不重复。
   *
   * backgroundImage 由 backgroundStyle 计算属性在 source='url'/'local' 时生成，
   * 叠在 background（--cd-bg 或玻璃底）之上。未配图时 backgroundImage 不存在，
   * 这几行声明不起作用。
   */
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  border-radius: inherit;
  user-select: none;
}

/* 版式块是唯一的 flex 子项，铺满除 .sr-only 以外的全部空间 */
.cd > :not(.sr-only) {
  min-width: 0;
  min-height: 0;
  flex: 1;
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

/* ── 数字与副信息 ────────────────────────────────────── */

/*
 * 大数字。
 *
 * 两个上界取小：一个是「这一格有多宽」，一个是「这几位数放得下多大」。
 * 后者是 §位数 那笔账——4 位数在 1×1 上的上限约 24.6px，而 2 位数能放到 49px，
 * 按最坏情况定死会让绝大多数方块的数字白白小一半。
 *
 * 0.6 是等宽数字的字宽系数（估值，宁可估大——估大只是字略小，估小是溢出）。
 * 分两步除而不是 `/(var(--cd-digits) * 0.6)`：分母里放表达式的支持面更窄。
 */
.cd__num {
  color: var(--cd-text, var(--color-text));
  /*
   * 三个上界取最小：
   *   1. 这一格有多宽          --cd-w × 0.42
   *   2. 这几位数放得下多大    (可用宽 − 同行副信息) / 字数 / 0.6em
   *   3. **这一档纵向容得下多高**  --cd-cap，各档自己给一个绝对像素
   *
   * 第三个上界是量出来才加的：按宽算在 w=4 上给出 151px，而 h=1 那一档的带高
   * 只有 75/101px，panel 在 4×2 上扣掉前缀行与日期行后也只剩 88px——
   * 原本的两支公式在这两处都溢出（实测 4×1 纵向 176 > 73）。
   *
   * 用**绝对像素**而不是 --square-h 的比例，是为了不把 26px 的高度二义性
   * 引回来（见根节点那句）：常量上界在起名 / 不起名两档给出同一个字号，
   * 多出来的 26px 仍然全归留白。这也顺带让 4×2 与 4×4 的数字仍然一样大。
   *
   * 第二支还要再扣 --cd-num-reserve：panel 与 strip 把副信息摆在**同一行**，
   * 不扣的话四位数会把「天前」顶出方格（实测 2×2 数字自己就探出 2.8px、
   * 单位被裁掉同样的量）。这两档各自给出预留值，其余两档为 0。
   */
  font-size: min(
    calc(var(--cd-w) * 0.42),
    calc((var(--cd-w) - var(--cd-pad) - var(--cd-num-reserve)) / var(--cd-digits) / 0.6),
    var(--cd-cap)
  );
  font-weight: 600;
  /*
   * tabular-nums 是上面那套字宽账成立的前提：比例数字下 `1` 比 `8` 窄得多，
   * 「11 天」到「88 天」会让整块字左右跳。日历的 micro__day 因为同一个理由带着它。
   */
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: 1;
  white-space: nowrap;
}

.cd__prefix,
.cd__unit,
.cd__date {
  color: var(--cd-sub-text, var(--color-text-dim));
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

/*
 * 前缀与单位跟着宽度等比，但**两端都夹死**。
 *
 * 纯比例式（0.11 × --cd-w）在 w=4 上给出 39.6px——那是副信息长到主角的一半，
 * 而它在 h=1 那一档（带高 75）把日期挤成一条 5px 的碎片。截图上看得很清楚，
 * 而纯数值断言看不出来：没有溢出，只是那一行变成了噪音。
 *
 * 下界 11px 是 §5.4 给 micro 的单位定的数（0.11 × 75 = 8.25 太小）；
 * 上界 20px 让副信息在任何宽度下都稳定读作「副」。
 *
 * 这条 clamp 抽进了 --cd-sub-fs：数字的宽度预算要读它（见 --cd-num-reserve）。
 */
.cd__prefix,
.cd__unit {
  font-size: var(--cd-sub-fs);
}

/* 日期行比前缀 / 单位再小一档：它是三条信息里最次要的 */
.cd__date {
  min-width: 0;
  overflow: hidden;
  font-size: clamp(10px, calc(var(--cd-w) * 0.085), 15px);
  text-overflow: ellipsis;
}

/* ── micro（1×1）───────────────────────────────────── */

/*
 * padding 左右各 8，所以字宽预算只扣 16 而不是根上的 24。
 *
 * 可用宽 = 75 − 16 = 59；4 位数的字号上限 ≈ 59 / (4 × 0.6) ≈ 24.6px，
 * 而只有 2 位数时同一格能放到 49px（此时 0.42 那一支先封顶在 31.5）。
 */
.cd__micro {
  --cd-pad: 16px;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 6px 8px;
  gap: 4px;
}

/* ── strip（h=1，w≥2）─────────────────────────────── */

/*
 * 两种构成共用这一个根：w=2 竖向摞两行（--stacked），w≥3 横向分三段。
 *
 * 横向账（w=3，263px，最坏「3900 天前」+「2015 / 12/31 / 星期四」）：
 *   padding 24 + 主组 138.2 + gap 10 + 连接线 flex + gap 10 + 副栏 49 = 231.2
 *   连接线因此实得 31.8px；w=4（358px）加上前缀 40 + gap 4 后实得 82.8px。
 * 前缀在 w=3 不画（见 stripPrefix）：加进来 44px 会先吃掉连接线，构图塌掉。
 *
 * **align-items: center 而不是 baseline。** 三个子项各自都是块（主组是 grid、
 * 连接线是 1px、副栏是竖排 flex），没有共同基线可对；跨块的基线对齐正是原先
 * 那个「整组顶到上边」的来源（flex 基线组的兜底对齐是 cross-start，实测墨迹
 * 中心比方格中心高 10.88px / 26.19px）。组内的共基线由 .cd__stripMain 单独管，
 * 两条轴分开——这与 .cd__panelMain 那段是同一个手法。
 */
.cd__strip {
  /*
   * 44px：这一档的带高是 75（起名）/ 101（没起名），取矮的那个作为下限——
   * 44 的行高 1 加上基线对齐后的字形高度落在 52 上下，两端各留十来个像素。
   * 取常量而非 --square-h 的比例，两个高度因此给出同一个字号（见 --cd-cap）。
   *
   * 两行式那一档**不下调**：44 + gap 2 + 日期 14.3 = 60.3px 落在 73px 里，
   * 上下各余六个多像素（实测纵偏 −0.07..−3.58）。下调只会让 2×1 的数字比
   * 3×1 小一档，而它们的宽度预算是同一条。
   */
  --cd-cap: 44px;
  /*
   * 这一档**前缀与单位都在主组那一行上**，所以两段都要扣（--cd-inline-sub 由 JS
   * 按版式数出来，strip 数的是 unit + stripPrefix）。连接线与副栏不扣：
   * 前者是 flex: 1 的伸缩项，后者每一段都带 ellipsis，挤不下时是它们收窄。
   *
   * 每字多给一道 4px 的 gap（主组内的 gap 就是 4px）。
   */
  --cd-num-reserve: calc(var(--cd-inline-sub) * (var(--cd-sub-fs) + 4px));

  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 10px;
}

/*
 * 主组（前缀 + 数字 + 单位）：grid 两轴分治，与 .cd__panelMain 同一个理由。
 *
 * align-content: center 管**行轨道**在余量里的位置，align-items: baseline 管
 * **轨道内**几项怎么对齐。flex 做不到这两件事同时成立（三条死路见 panelMain 那段）。
 * 这一档的余量虽然只有二十来个像素，但那个偏移恰恰是用户看得见的——
 * 原先「3900 天前」的墨迹带压在方格上沿，下面空出 26px。
 *
 * flex: 0 0 auto：余量归连接线，主组只占自己那点宽。
 */
.cd__stripMain {
  display: grid;
  flex: 0 0 auto;
  grid-auto-flow: column;
  align-content: center;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
}

/*
 * 数字裁到墨迹，与 .cd__column .cd__num 同一条（那里写了完整的理由：
 * 行盒里基线的位置由字体说，本机 Segoe UI 下数字在自己那一行里偏低 1.31px，
 * 而补偿量必须由**当下真正渲染的那个字体**算出来，所以用 text-box 而不是负 margin）。
 *
 * 这一档裁完把整块内容的纵偏从 4.58 收到 3.58px。**共基线不受影响**：
 * 裁的是行盒而不是基线位置，实测单位与数字的基线落差恒为 0.00。
 * 引擎不认这两条时一起被丢掉，回落到 4.58px 的偏移——仍在「肉眼看不出」的量级内，
 * 降级方向安全。
 *
 * 只裁主组里的数字：副栏那三行是 11..17px 的小字，行盒里本来就几乎没有幻影。
 */
.cd__stripMain .cd__num {
  text-box-trim: trim-both;
  text-box-edge: cap alphabetic;
}

/*
 * 连接线：**这一档唯一会长个的东西**，横向版的 .cd__colRule。
 *
 * 它解决的是一个能量出来的缺陷：原先日期靠 margin-left: auto 推到右端，
 * 主组与日期之间的空隙在 3×1 是 20..127px、4×1 是 71..183px——同一格的构图
 * 随天数位数变形（4×1 的「今天」中间是一片 183px 的空白）。让线吃掉全部余量后，
 * 那个洞不再是「剩下多少算多少」而是版面的一部分，实测线宽 32..179px。
 *
 * 四条纪律与竖版逐条同源，细节见 .cd__colRule：
 *   - 两端淡出而非齐头实线（等亮度细线会读成裂缝）
 *   - 颜色跟 --cd-sub-text 走、亮度交给 opacity（用户配深色副文字时白线会整根消失；
 *     用 opacity 而非 color-mix 免掉 @supports 那一层）
 *   - 不做成进度条（进度要有起点，存档里只有目标日期）
 *   - 1px 的线不是块面，COUNTDOWN_FIELDS 因此不必开第四档颜色
 *
 * min-width: 0 与 .cd__colRule 的 min-height: 0 对应，**且是刻意不给地板**。
 * flex-basis: 0% 让它的基础尺寸就是 0，于是空间不够时**先归零的是它而不是任何一段字**
 * ——这正是想要的优先级（装饰让位于内容）。曾经给过 8px 的地板，桌面上永远碰不到
 * （最挤的 3×1 + 四位数仍有 31.8px），只在编辑对话框的 fit 预览里生效，
 * 而那里副栏已经被压成 0，一根 8px 的线旁边什么都没有，读起来是个乱码而不是连接线。
 */
.cd__stripRule {
  height: 1px;
  min-width: 0;
  flex: 1;
  background: linear-gradient(
    to right,
    transparent,
    var(--cd-sub-text, var(--color-text)) 15%,
    var(--cd-sub-text, var(--color-text)) 85%,
    transparent
  );
  opacity: 0.2;
}

/*
 * 副栏：年 / 月日 / 星期竖排右对齐，与 .cd__colFoot 同一组内容（共用 dateYear /
 * dateMd / dateWeekday），只是字号系数差一个数量级——那一档宽 75px 用 0.115w，
 * 这一档宽 263..358px 用 0.065w。
 *
 * 拆三行而不是拼成「2015-12-31 星期四」一行：拼起来约 127px，会把连接线从 32px
 * 压到归零，而连接线才是这一档的结构。拆开之后最宽的一行只有 45px。
 *
 * max-width: 30% 是给连接线留的护栏。不夹的话未来若有更长的内容进这一栏
 * （例如把自定义文字放进来——量过，4×1 会让线掉到归零），线会先消失。
 * 用百分比而非绝对像素：这一栏的字号本身是按 --cd-w 等比的。
 *
 * 右对齐（align-items: flex-end + text-align: right）：三行长短不一，
 * 靠齐外侧才读作一块贴在右端的落款；居中会让它们各自浮在中线上、与连接线的
 * 收束点错开。
 *
 * **flex: 0 1 auto——可以被压缩，而且压到 0 也不加地板。** 编辑对话框的 fit 预览
 * （倒计时不写 interactive，走那一档）把方格宽压到 174px 而**字号一个都不缩**
 * （fit 档的既有代价，TilePreview 自己的注释写着「1×1 与 4×4 里的文字是同一个大小」），
 * 主组一家就吃掉 132px，副栏在那里必然放不下。三条路量下来：
 *   - 让副栏不让位（flex: 0 0 auto）：横向溢出 40..41px，日期探出方格边缘被裁掉
 *   - 把副栏的宽度算进 --cd-num-reserve：预览里副栏回来了，但 4×1 的**数字被压到
 *     0px**（那一档 --cd-w 只有 174 而 reserve 要 76），整个方块空白
 *   - 现在这条：预览里副栏收成 0，只显示「3900 天前」
 * 取第三条，因为它与改动前**行为一致**——旧代码那一段 `2015-12-31` 在同一个预览里
 * 被 ellipsis 削到只剩 8..9px 的可见宽（一个「2…」都不到）。这不是这次改动引入的缺陷，
 * 是 fit 档「缩框不缩字」的老账；而桌面上（263 / 358px）副栏恒为 45px、clip 恒为 0。
 * 反过来 2×1 那一档在预览里反而**更好**了：改动前它一个日期字都不画，
 * 现在两行式的第二行完整显示「2015 年 12 月 31 日」。
 */
.cd__stripSide {
  display: flex;
  min-width: 0;
  max-width: 30%;
  flex: 0 1 auto;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  gap: 1px;
  text-align: right;
}

.cd__stripSide > * {
  max-width: 100%;
}

/*
 * 月日在副栏里重一档，判据与 .cd__colDay 逐字相同：它是两种构成都画的那一行，
 * 也是「什么时候」的答案。只提字号与字重、不动色相（accent 只准标状态，
 * 而目标日不是状态）。
 *
 * 系数 0.065 是量出来改的：沿用 .cd__date 那条 0.085w / 上界 15px，
 * 3×1 上月日算出 13.3px 而「年」是 15px——**层级倒了**。0.065w 在两档都给出 17px
 * （3×1 的 0.065 × 263 = 17.1 触到上界，4×1 的 23.3 更是），于是月日恒大于年。
 * 下界 12px 只在预览的窄舞台上生效。
 */
.cd__stripMd {
  color: var(--cd-text, var(--color-text));
  font-size: clamp(12px, calc(var(--cd-w) * 0.065), 17px);
  font-weight: 500;
}

/*
 * 两行式（w=2）：主组在上、整句日期在下。
 *
 * 纵向账（168×73，最坏「已经 3900 天前」+「2015 年 12 月 31 日」）：
 *   主组 41.9（宽度预算先封顶，见 .cd__num）+ gap 2 + 日期 14.3 = 58.2，余 14.8
 * 没起名那一档（99px）多出的 26px 全归留白，一行字号都不变——这是「按宽算」
 * 在这一档的兑现。
 *
 * 日期在这里**不拆三行**，与 w≥3 相反：这一档纵向只放得下两行，而横向
 * 144px 的可用宽装得下整句 118px 的墨迹（dateLine 在 w=2 上不含星期，
 * 见 showsWeekday——追加「星期四」要再吃 46px，正好越界）。
 */
.cd__strip--stacked {
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

/* 整句日期，挤不下时靠 .cd__date 自带的 ellipsis 收（实测 clip 恒为 0） */
.cd__stripSub {
  max-width: 100%;
}

/* ── column（w=1，h≥2）───────────────────────────── */

/*
 * 纵向账（`.cd` 高 194/220、315/341、436/462，两个数是起名 / 没起名）：
 *   padding 上下 22 + 前缀 11（h≥3）+ 数字区 37.06 + 竖线 flex + 页脚 11/22/33
 *   + 三道 gap 24（h=2 只有三个子项，两道 16）
 * 竖线因此实得 107.94 / 133.94（h=2）、198.94 / 224.94（h=3）、308.94 / 334.94（h=4）。
 * 除竖线外全是绝对像素，起名 / 没起名差的那 26px 整段落进线长，一行字号都不变
 * ——这是「按宽算」在这一档的兑现，与 --cd-cap 那段同一条纪律。
 *
 * 数字区那 37.06 = 裁到墨迹的数字 22.06 + gap 4 + 单位 11（见 .cd__colMain）。
 * 引擎不认 text-box-* 时是 46.5，竖线各短 9.44，三档仍然都是正数。
 *
 * 编辑对话框的预览走 fit 档（倒计时不写 interactive），绝对尺寸在那里不缩，
 * 三档都在那个固定舞台（176×160）里实测过一遍。fit 解出的 --tile-size 让方格
 * 竖着填满舞台，所以 h 越大方格越窄（`.cd` 宽 52.3 / 31.6 / 22.3），高反而
 * 恒为 140（起名）/ 158（没起名）。竖线实得 61.1 / 39.2 / 31.8 与
 * 79.2 / 56.6 / 49.2，三档都是正数，纵向一档都不溢出。
 *
 * 预览里唯一被削的是 1×4 的星期行：那一档只有 22px 宽，而 .cd__date 的 clamp
 * 下界是 10px，三个汉字 30px 放不下（横向溢出 3..4px）。这是 fit 档「字号不跟着
 * 缩」的既有代价，桌面上这一档宽 75px、页脚每一行的 clip 都是 0。不为那个 22px
 * 的预览去掉下界：去掉之后桌面的日期行会掉到 6.4px。
 */
.cd__column {
  /* 与 micro 同 padding，字宽预算也同（75 − 16 = 59） */
  --cd-pad: 16px;
  /*
   * **这一档不覆写 --cd-cap**，与 micro 一样吃根上那个宽松的 999px。
   *
   * strip 与 panel 都覆写了，所以这里的「没有」需要一句话：那两档是横向版式，
   * 带高 75 / 前缀行与日期行之后的余量才是真正的瓶颈；而竖条这一档最矮也有
   * 194px，纵向从来不是约束——0.42 × 75 = 31.5px 那一支早就先封了顶。
   *
   * 也**不为了「同形状同字号」把它夹到四位数那一档的 24.6px**。数字随位数变小
   * 是这个组件明写过的取舍（见 .cd__num：「按最坏情况定死会让绝大多数方块的
   * 数字白白小一半」），而 0.42 这个系数恰好把 1..3 位都压在 31.5px、只让四位数
   * 落到 24.6——差 22% 且只在四位数时出现，比让每一格都小 22% 划算。夹下去还会
   * 顺带让 1×1 与 1×2 的同一个数字不一样大（两档共用 --cd-pad: 16px）。
   */

  display: flex;
  flex-direction: column;
  align-items: center;
  /*
   * 上 12 / 下 10 不对称：底下那一层是三行小字，末行离方格底边越近越容易撞上圆角
   * （这一档圆角 min(0.22 × 75, 26) = 16.5px），而顶上只有一行 11px 的前缀。
   * CalStack 的 stack__grid 为同一个理由给了同样偏心的 padding。
   */
  padding: 12px 8px 10px;
  gap: 8px;
}

/*
 * 把数字的行盒裁到字形本身：上边取 cap 高、下边取基线。于是「数字那一行」就是那几个
 * 数字，行盒中心与墨迹中心重合（实测偏差 +0.09px）。
 *
 * 为什么原来不居中：line-height: 1 只把行盒定成 1em，基线落在行盒里的哪个位置是
 * **字体**说的。本机这套字体栈实际落到 Segoe UI，行盒 31.5px 里基线在 28.0px 处
 * （0.889em，用零尺寸 inline-block 探针量的，不是公式推的）；而数字的墨迹只有
 * cap 高 22.38px、基线以下为 0（`239` 这类字符串没有 descender），于是墨迹占
 * 5.62..28.5——上面空 5.62px，下面空 3.0px，**数字在自己那一行里偏低 1.31px**。
 * 这个差值等于 (asc−desc)/2 − (cap−0)/2，与 line-height 取多少无关：改行高、
 * 再套一层 flex 居中，都只是把这个偏移连着行盒整块搬个地方。
 *
 * 用 text-box 而不是手写一个 em 的负 margin：补偿量得由**当下真正渲染的那个字体**
 * 的度量算出来，而那是每台机器不一样的。同一段 line-height: 1，实测
 *   Segoe UI  +0.048em（本机落到的那个）
 *   Arial     −0.016em（反过来偏高）
 *   兜底那个   0
 * ——字体栈第一位的 Inter 在本机没装（给 'Inter' 与给一个不存在的名字量到同一组
 * 度量，都是兜底那支）。写死 0.048em 会让装了 Inter 的机器反过来高一个像素半。
 * text-box 是引擎拿当下的字体度量去裁，换字体自己跟着变。
 *
 * 残差 +0.09px：cap 是这组关键字里离数字顶最近的一个，而 Segoe UI 的数字比大写
 * 字母还高 0.32px（0.01em）。这个量级看不出来，且同样自适应。
 *
 * 写两条长属性而不是 `text-box:` 那个简写：简写晚了两个 Safari 小版本，
 * 而这两条从 Chromium 133 / Safari 18.2 起就在。引擎不认时**两条一起被丢掉**，
 * 回落到上面那套几何：数字照旧偏低 1.31px，行盒回到 31.5px（于是 .cd__colMain
 * 高 46.5、竖线短 9.4px，见那两条），两档都不溢出，降级方向安全。
 *
 * **只裁 column 这一档的数字。** 主文字有可能是汉字（diff===0 那一档 value 是
 * 「今天」），所以这条得对汉字也验一遍：汉字的墨迹确实会探出 cap/基线那条带，
 * 但**上下探得一样多**（29.5px 上实测 3.95 / 4.00），裁完照旧居中（偏差 +0.02）。
 * 数字自己也探出一点（0.31 / 0.50，圆头字形在 cap 线与基线上的 overshoot），
 * 同理不影响居中。「今天」那一档没有单位，数字墨迹到竖线净剩 4px（原来 6.5），
 * 不撞；三档都不溢出，墨迹也没探出方格。
 *
 * 前缀与单位不跟着裁：它们的行盒里本来就几乎没有幻影（「天」在 11px 的盒里上边
 * 只空 1.0px），裁了没有可去的东西，只会把上面那笔 gap 账再算一遍。
 * strip 那档是 align-items: baseline，基线组按「基线以上最高的那一项」贴上边，
 * 裁掉那 0.3em 会把整组往上提；panel 的纵向账是量到像素的。那两档要不要一起裁
 * 是另一笔账，不在这次改动里。
 */
.cd__column .cd__num {
  text-box-trim: trim-both;
  text-box-edge: cap alphabetic;
}

/*
 * 数字与单位竖叠。**不吃余量**（余量归竖线），所以 flex: 0 0 auto。
 *
 * 单位在数字**下一行**而不是并排，于是 --cd-inline-sub 保持 0、数字的横向预算
 * 不用扣它，也不存在 panel 那条「整组居中」与「组内共基线」的矛盾——
 * 竖叠只有一条轴，flex 就够，不必上 grid。
 */
.cd__colMain {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  /*
   * 4px 而不是原来的 2px：数字的行盒裁到墨迹之后（见上一条），原先垫在基线底下的
   * 那 3px 幻影没了，gap 于是**就是**眼睛看到的那道间距。三个候选值实测的视觉间距
   * （数字墨迹底 → 「天」墨迹顶）是 gap2 → 3.0、gap4 → 5.0、gap5 → 6.0，
   * 而改动前那套（无裁剪 + gap 2）是 6.5。
   *
   * 取 4 而不是「把 6.5 抄回来」的 5：这一档的间距要分出主次——h≥3 上前缀与数字
   * 之间是 7.1px（padding/gap 都没动，裁掉幻影后由 13.8 收到这个数），单位必须比
   * 它更近，数字 + 单位才读作一块。gap 5 给出 6.0，与 7.1 几乎相等，前缀会被拉进
   * 同一块里。裁不到 text-box 的引擎上这个 4px 给出 8.5，仍然只是松一点。
   */
  gap: 4px;
}

/*
 * 竖线：这一档唯一会随高度长个的东西，吃掉全部余量。
 *
 * 两端淡出而不是一条齐头齐尾的实线：100..327px 的等亮度细线在 75px 宽的方格里
 * 会读成一道裂缝或一根滚动条（CalWeekRail 为竖向高亮块写过同一句担心），
 * 而两端淡出让它读作一段轨迹——起点在那句话上、终点在那个日期上。
 *
 * 颜色跟着 --cd-sub-text 走、亮度交给 opacity，而不是写 --tile-border：
 * 用户把副文字配成深色时（浅色底那一路），一条固定的白线会整根消失。
 * 用 opacity 而不是 color-mix 调淡，是因为 color-mix 必须包一层 @supports，
 * 而这里只要一个整体透明度——元素里没有别的东西会被它一起调淡。
 * 未配色时回落到 --color-text × 0.2 ≈ rgb(237 237 240 / 0.2)，
 * 与站内那批 1px 分隔线用的 --tile-border（0.14）同一个量级。
 *
 * **不做成进度条**，尽管 CalColumn 底部就有一条：进度要有起点，而倒计时只存了
 * 目标日期——「从什么时候开始倒数」这件事存档里没有，编出一个（创建时间、
 * 一年前）就是在画一条假数据。年份进度在日历那里成立恰恰因为「今年」自带起点。
 */
.cd__colRule {
  width: 1px;
  min-height: 0;
  flex: 1;
  background: linear-gradient(
    to bottom,
    transparent,
    var(--cd-sub-text, var(--color-text)) 15%,
    var(--cd-sub-text, var(--color-text)) 85%,
    transparent
  );
  opacity: 0.2;
}

/*
 * 页脚：年份 / 月日 / 星期，逐档从一行长到三行（见 dateYear 那段）。
 *
 * 行距 1px 而不是 0：三行同色近同字号，靠一点间距分行就够，
 * 再大一点它们就散成三条各自为政的信息，而它们说的是同一个日期。
 */
.cd__colFoot {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  text-align: center;
}

/*
 * 月日行在页脚里重一档：它是三个形状都画的那一行，也是「什么时候」的答案。
 *
 * 只提字号与字重、不动色相（accent 只准标状态，而目标日不是状态）——
 * 与 CalColumn 把星期从「次要文字」提到「主要文字」是同一种手法。
 */
.cd__colDay {
  color: var(--cd-text, var(--color-text));
  font-size: clamp(11px, calc(var(--cd-w) * 0.115), 17px);
  font-weight: 500;
}

/* ── panel（w≥2，h≥2）──────────────────────────── */

/*
 * 纵向账（2×2 起名 196）：
 *   padding 上下 24 + 自定义文字（可选）+ 前缀行 ~19 + gap 6 + 数字区 flex + gap 6 + 日期行 ~14
 * 自定义文字不存在时，固定占用约 69，数字区实得 127（没起名 153）。
 * 自定义文字存在时（按 h=2 一行 ~16px 算），固定占用约 91，数字区实得 105（没起名 131）。
 * 那 26px 全进数字区的留白，三行的字号一个都不变。这是「按宽算」的直接兑现。
 */
.cd__panel {
  /*
   * 80px：h=2 那一档的带高 194（起名）/ 220，扣掉 padding 24 + 前缀行 19
   * + 两处 gap 12 + 日期行 14 后数字区实得 125（没起名 151）。
   * 字形高度约为字号的 1.0，80 在最矮那一档留出四十来个像素的呼吸。
   *
   * **存在自定义文字时降到 72px**（由 rootStyle 覆写 --cd-cap）：
   * 自定义文字那一行加一道 gap 合计吃掉约 22px，数字区因此少 22，
   * 而 72 在这个缩减后的空间里仍然够用（量出来 4×2 数字区实得 78.6）。
   *
   * **h≥3 不放宽**，尽管那几档纵向还很宽裕（带高 300px 以上）。这不是疏漏，
   * 正是「4×2 与 4×4 的数字一样大」那条断言的兑现——多出来的空间全归留白与
   * 副信息，因为那个数字在 4×2 上已经足够大，继续放大只是变吵。
   * 于是 80（或有自定义文字时的 72）同时是纵向上界与 panel 一档的全局字号上限。
   */
  --cd-cap: 80px;
  /*
   * 单位与数字同一行（.cd__panelMain 那一格），所以横向预算要扣掉它。
   * 前缀不在这一行上（它自己独占一行），不扣——JS 那边 panel 只数 unit。
   *
   * 不扣的后果实测得到：2×2 上「已经 4263 天前」的数字探出方格 2.8px，
   * 单位被裁掉同样的量——而这与版式用 flex 还是 grid 无关（两种写法量到同一个值）。
   */
  --cd-num-reserve: calc(var(--cd-inline-sub) * (var(--cd-sub-fs) + 6px));

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 12px;
  gap: 6px;
  text-align: center;
}

.cd__panel .cd__date {
  max-width: 100%;
}

/*
 * 数字与单位并排、**共基线**，一并吃掉三行之外的全部余量。
 *
 * 用 grid 而不是 flex：这一格比数字高得多（flex: 1 把余量全收了），
 * 而 flex 下「整组在余量里居中」与「组内两项共基线」互斥——
 *   align-items: center 会让单位各自垂直居中（脱开数字的基线）；
 *   给单位 align-self: flex-end 则把它按到**这一格的底边**而不是数字脚边，
 *   于是格子越高掉得越远（实测 2×4 掉到数字下方 147px，「天」贴到了日期行上）。
 * flex 的 baseline 也不行：基线组的兜底对齐是 cross-start，整组会顶到上边。
 *
 * grid 两条轴分开管就没有这个矛盾：align-content 管**行轨道**在余量里的位置
 * （居中），align-items 管**轨道内**两项怎么对齐（共基线）。
 * grid-auto-flow: column 让两个子项落进同一行的两列。
 *
 * 单位因此不再需要 padding-bottom 去反推：那 0.12em 原本是把 flex-end 的结果
 * 往上拽一点的补偿，真正共基线之后它只会把基线组整体推高。
 */
.cd__panelMain {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-auto-flow: column;
  align-content: center;
  align-items: baseline;
  justify-content: center;
  gap: 6px;
}

/* ── 自定义文字（panel 档首行）────────────────── */

/*
 * 自定义文字作为 panel 档的首行标题。
 *
 * 字号、颜色、字重由 customTextStyle 生成；这里给默认值（回落到与主数字同色同重）
 * 与截断规则。行数读 --cd-custom-lines（h=2 给 1，h≥3 给 2）。
 *
 * 截断用 -webkit-box + line-clamp 而非 white-space: nowrap + ellipsis：
 * 两行是这一档要的（h≥3 纵向宽裕，一句话截成一行反而浪费），而 line-clamp
 * 是唯一能在**多行**末尾出省略号的办法。它带前缀但在 Chromium / WebKit /
 * Firefox 上都实现了，且降级方向是安全的——不支持时变成不截断的多行，
 * 而 .cd 根节点的 overflow: hidden 兜住溢出。
 *
 * 宽度 100% 让截断按父容器宽度算，而不是由内容撑开。
 */
.cd__customText {
  display: -webkit-box;
  width: 100%;
  overflow: hidden;
  color: var(--cd-text, var(--color-text));
  font-weight: 600;
  line-height: 1.3;
  -webkit-line-clamp: var(--cd-custom-lines, 1);
  -webkit-box-orient: vertical;
  text-align: center;
  overflow-wrap: break-word;
}

/* ── 未配置态 ────────────────────────────────────────── */

.cd__blank {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8px;
  color: var(--cd-sub-text, var(--color-text-disabled));
  gap: 3px;
  text-align: center;
}

/*
 * 两行提示同样两端夹死，与 .cd__prefix 同一个理由。
 *
 * 下界 11px 是 §6 那笔账的输入（「2×1 已经放得下未设置 / 右键设置两行 11px 的字」），
 * 上界让 4×4 的未配置态不至于变成一句横幅——它是一个待办事项，不是主角。
 */
.cd__blankMain {
  font-size: clamp(11px, calc(var(--cd-w) * 0.1), 17px);
  line-height: 1.2;
}

.cd__blankHint {
  font-size: clamp(10px, calc(var(--cd-w) * 0.075), 14px);
  line-height: 1.2;
  opacity: 0.8;
}

/* micro 的未配置态只有一个破折号，按主字号给，别的什么都不画 */
.cd__dash {
  color: var(--cd-sub-text, var(--color-text-disabled));
  font-size: calc(var(--cd-w) * 0.32);
  line-height: 1;
}
</style>

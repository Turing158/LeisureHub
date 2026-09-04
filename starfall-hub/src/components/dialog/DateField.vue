<script setup lang="ts">
/**
 * 目标日期 + 按年重复。
 *
 * 形状照抄 PlaceField：两个键由**一个控件**同时 emit，而不是两个独立控件各写一个。
 * 理由与那边同源——「2 月 29 日 + 按年重复」是一个组合，分两次 emit 会有一帧
 * 算在错误的年份上。
 *
 * **用原生 `<input type="date">`。** NumberField 的文件头否掉了原生 spinner，
 * 这里不照抄那个结论，差别值得写清楚：number 的 spinner 是**装饰性**的，
 * 去掉它值照样能打字输入；date 的日历弹层是**功能性**的，自绘要重新实现闰年、
 * 月份天数、区域格式、键盘方向键、读屏播报——几百行代码去换一件浏览器免费给的事。
 *
 * 原生控件在深色底上唯一的真问题是那个日历图标是深色的，一行 color-scheme: dark
 * 就解决（项目全局没设，所以局部设在这个控件上）。
 *
 * **不给「明年元旦 / 下个月」这类快捷预设**：正确的预设集合取决于用户是谁——
 * 对一个人是「考试日」，对另一个是「宝宝百天」。猜不中的预设占着表单里最显眼的一行。
 */
import { computed } from 'vue'

import ToggleSwitch from '../settings/ToggleSwitch.vue'
import {
  countdownText,
  dayDiff,
  nextAnniversary,
  parseDateParts,
} from '../widgets/countdown/dayDiff'

const props = defineProps<{
  /** `YYYY-MM-DD`；空串表示未设置 */
  targetDate: string
  repeatYearly: boolean
}>()

const emit = defineEmits<{
  /**
   * 两个键一起上报。
   *
   * 与 PlaceField 的三键同一条理由：分开 emit 会出现「日期已更新、重复开关还是
   * 旧值」的中间态，而预览此刻就会按那个组合算一次天数。
   */
  update: [value: { targetDate: string; repeatYearly: boolean }]
}>()

/** 校验的上下界与 dateCheck 一致，只是这里落成 input 的 min/max */
const MIN_DATE = '1970-01-01'
const MAX_DATE = '2099-12-31'

const parts = computed(() => parseDateParts(props.targetDate))

/**
 * 实时预览文案（「还有 243 天」）。
 *
 * **这是这个控件的核心。** 它让用户在保存前就确认自己填对了年份，比预览方块里的
 * 大字更直接——大字看不出 2000 和 2020 的区别，「已经 9618 天前」一眼就看得出。
 *
 * 这里直接 new Date() 而不订阅 useToday：对话框的生命周期是几十秒，
 * 跨零点重算这件事在这里没有收益，而多一个订阅方就多一次引用计数的往返。
 */
const preview = computed(() => {
  const p = parts.value
  if (!p) return props.targetDate.trim() ? '这一天不存在' : '未设置日期'

  const now = new Date()
  const target = props.repeatYearly
    ? nextAnniversary(now, p.month, p.day)
    : new Date(p.year, p.month - 1, p.day)

  const text = countdownText(dayDiff(now, target))
  return `${text.prefix}${text.value}${text.unit}`
})

function onDate(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  /*
   * 清空日期时把重复开关一起复位。
   *
   * 一个孤零零的 repeatYearly: true 是没有意义的键，而 sanitizeWidgetProps 的
   * FINALIZE.countdown 也会把它删掉——在这里就复位，让表单显示的状态与
   * 保存后的状态一致，而不是让用户看着一个开着的开关而它保存不下去。
   */
  emit('update', { targetDate: raw, repeatYearly: raw ? props.repeatYearly : false })
}

function onRepeat(value: boolean) {
  emit('update', { targetDate: props.targetDate, repeatYearly: value })
}
</script>

<template>
  <div class="date">
    <input
      class="date__input"
      type="date"
      :value="targetDate"
      :min="MIN_DATE"
      :max="MAX_DATE"
      aria-label="目标日期"
      @change="onDate"
      @input="onDate"
    />

    <!--
      复用面板那套 ToggleSwitch，不自绘第二种开关。

      hint 说的是「为什么要有这个开关」而不是「它是什么」：生日是纪念日里最大的
      一类，而不开它的话 2000-05-01 会显示「已经 9618 天前」。
    -->
    <ToggleSwitch
      id="cd-repeat"
      class="date__repeat"
      label="每年重复"
      hint="生日、纪念日这类按年循环的日子"
      :model-value="repeatYearly"
      :disabled="!parts"
      @update:model-value="onRepeat"
    />

    <!--
      实时文案。aria-live 让读屏用户改完日期就听到结果，
      而不必去别处找那个大字。
    -->
    <p class="date__preview" aria-live="polite">{{ preview }}</p>
  </div>
</template>

<style scoped>
.date {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--sp-2);
}

/*
 * 与 TabWidgetEdit 的 .field__input 逐条一致：同一种输入框不该有两套观感。
 *
 * color-scheme: dark 是这里唯一的额外一行——不设的话浏览器按浅色渲染那个
 * 日历图标与弹层，深色玻璃底上是一块白疤。项目全局没设，所以只能落在这里。
 */
.date__input {
  min-width: 0;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--fill);
  color: var(--color-text);
  color-scheme: dark;
  font-size: var(--fs-base);
  font-variant-numeric: tabular-nums;
  transition: border-color var(--dur-fast) var(--ease);
}

.date__input:focus {
  border-color: var(--focus);
  outline: none;
}

/* 日历图标默认贴在最右，给它一点呼吸并标出可点 */
.date__input::-webkit-calendar-picker-indicator {
  cursor: pointer;
  opacity: 0.7;
}

.date__input::-webkit-calendar-picker-indicator:hover {
  opacity: 1;
}

.date__repeat {
  padding-top: 2px;
}

/*
 * 预览文案用 --color-text 而非 dim：它是这个控件的核心反馈，
 * 压暗会让它读起来像一句可以跳过的说明。
 */
.date__preview {
  margin: 0;
  color: var(--color-text);
  font-size: var(--fs-base);
  font-variant-numeric: tabular-nums;
}
</style>

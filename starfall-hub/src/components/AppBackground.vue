<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { useSettingsStore, type BgFrame } from '@/stores/settings'

/**
 * 背景层：一组背景之间的交叉淡入，以及按时轮换。
 *
 * 从 App.vue 拆出来，因为它现在自己带状态（两个槽位、进行中的过渡、定时器），
 * 塞在 App 里会把「页面骨架」和「背景播放器」两件事混在一个文件里。
 *
 * **为什么是两个常驻槽位而不是一个层换 background-image**：换图属性无法用透明度
 * 过渡，只能瞬切。两层则可以让新的一张浮在旧的之上淡入。
 *
 * **为什么旧层在淡入期间保持不透明**：若两层同时反向动（新 0→1、旧 1→0），
 * 中点两层各 0.5，合成结果会透出底色——一次换背景中间闪一下灰。所以旧层
 * 全程 opacity: 1 垫在下面，只有新层动；等新层完全盖住了，旧层才归零并卸掉图。
 *
 * **为什么外面还要包一层 .bg**：两个槽位靠 z-index 1/2 分出前后，而页面内容只有
 * z-index: 1。不隔离出自己的层叠上下文，前槽就会盖住内容——背景一出来方格全没了。
 */
const settings = useSettingsStore()

const FALLBACK_FADE_MS = 800

/**
 * 清理旧层前多等一帧多一点。
 *
 * CSS 过渡不是在写下样式的那一刻开始计时，而是从下一帧的时间戳起算，
 * 所以它结束得比 setTimeout(fadeMs) 稍晚。差值虽只有一帧，但那一帧里
 * 新层还差最后千分之几没到 1，旧层却已被卸掉——底色会从这道缝里透出来
 * （实测过：max(opacity) 掉到 0.9979）。多等这点时间把缝合上。
 */
const FADE_CLEAR_MARGIN_MS = 80

/** 淡入时长以 style.css 的 --dur-bg 为唯一来源，这里只换算单位（与 OverlayLayer 同一手法） */
function fadeMs(): number {
  if (!settings.motionEnabled) return 0
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--dur-bg').trim()
  const parsed = Number.parseFloat(raw)
  const ms = raw.endsWith('ms') ? parsed : parsed * 1000
  return Number.isFinite(ms) && ms > 0 ? ms : FALLBACK_FADE_MS
}

/* ── 两个槽位 ─────────────────────────────────── */

/** 槽位内容；null 表示该槽空着（不画任何东西） */
const slots = ref<[BgFrame | null, BgFrame | null]>([null, null])
/** 两个槽位的 DOM：换帧前要读一下它们的布局，把过渡的起点值钉住（见 swapTo） */
const slotAEl = ref<HTMLElement | null>(null)
const slotBEl = ref<HTMLElement | null>(null)
/** 当前显示的是哪个槽 */
const front = ref<0 | 1>(0)
/** 淡入进行中——这段时间里后槽（旧图）要保持不透明，垫在下面 */
const fading = ref(false)
/**
 * 正在「上膛」的槽位：已经装好新帧，但还被按在 opacity: 0 且不带过渡的状态上。
 *
 * 淡入的起点必须先被浏览器真正算过一遍，否则那一段过渡不会启动（见 swapTo）。
 * null 表示没有槽位处于这个状态。
 */
const arming = ref<0 | 1 | null>(null)

/**
 * 加载失败的帧（按 sig 记）。
 *
 * 防盗链、403、图源挂了都会走到这里。记下来是为了轮换时跳过它们——
 * 否则一张坏图会让轮换每转到它就卡住不动，看起来像轮换坏了。
 */
const failed = ref(new Set<string>())
/** 正在等第一张图加载：占位动画只在这段时间播 */
const loading = ref(false)

/** 目标帧：当前档、当前游标指向的那一帧 */
const target = computed<BgFrame | null>(() => {
  const frames = settings.bgFrames
  if (frames.length === 0) return null
  return frames[settings.bgIndex % frames.length] ?? null
})

/** 还有没有能用的帧——全坏了就不要再无限往下找 */
const hasUsableFrame = computed(() =>
  settings.bgFrames.some((frame) => !failed.value.has(frame.sig)),
)

/** 预加载一张图；成功与否都会返回，不抛错 */
function preload(href: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    // 与 CSS 背景走同一条 no-cors 图片路径，命中同一份缓存，不会多下一次
    img.src = href
  })
}

/* ── 换帧 ─────────────────────────────────────── */

let swapToken = 0
let clearTimer: number | null = null
/** 淡入进行中时新来的目标先记在这儿，等这一轮走完再换过去 */
let pendingRetry = false

async function swapTo(frame: BgFrame | null) {
  swapToken += 1
  const token = swapToken

  // 目标与当前显示的完全一致（含内容 sig）——什么都不用做
  if (slots.value[front.value]?.sig === frame?.sig) return

  if (!frame) {
    // 没有可显示的帧：两槽清空，露出底色。上一轮若还有槽被上膛按着，一并松开
    arming.value = null
    slots.value = [null, null]
    loading.value = false
    return
  }

  if (frame.kind === 'image' && frame.href) {
    // 首帧还没立起来时才播占位动画；换图期间保持旧图，不闪回占位
    loading.value = slots.value[front.value] === null
    const ok = await preload(frame.href)
    if (token !== swapToken) return
    loading.value = false

    if (!ok) {
      failed.value = new Set(failed.value).add(frame.sig)
      // 轮换中且还有别的图可用：跳过这张继续往下，坏图不该卡住整轮
      if (settings.bgRotating && hasUsableFrame.value) settings.advanceBg()
      return
    }
  }

  const back: 0 | 1 = front.value === 0 ? 1 : 0

  /*
   * 分两步提交：先把新帧「上膛」——装进后槽，同时把它按在 opacity: 0 且不带过渡的
   * 状态上；等浏览器真的把这个状态算过一遍，再松手让它淡到 1。
   *
   * 不能一步写完。过渡启动的条件是浏览器在某次样式重算里**看到** opacity 变了，
   * 而它比较的是「这次重算的结果」与「上次重算的结果」。同一批任务里连着改两次，
   * 中间没有重算，中途那个值就等于不存在。
   *
   * 快速连点正好撞在这上面。第二次点击落在淡入期内，被记成 pendingRetry，由
   * clearTimer 补做；而那个回调里「fading 归零 + 卸掉旧图」和紧接着同步调用的
   * swapTo 处在同一个任务里，Vue 只在末尾刷一次 DOM。于是「这一槽先空掉」
   * 这一步被合并掉了——它带着的 opacity: 0 / transition: none 从未生效。
   * 浏览器看到的是同一个槽从「垫在下面的 opacity: 1」直接变成「新帧 + opacity: 0
   * 且过渡是活的」，于是启动了一段 1 → 0 的**淡出**；下一步翻转 front 又把它拽回 1，
   * 那段淡出刚起步就被取消。两下相抵，只剩 background-image 瞬切。
   * 表现就是用户说的「等了一会，然后图硬生生地换掉」。
   *
   * 所以起点不能指望后槽「本来就是 0」——它可能正垫在下面显示着，也可能正淡出到
   * 一半。arming 明确把它压到 0 并摘掉过渡，压住的这一帧才是干净的起点。
   */
  arming.value = back
  const armed: [BgFrame | null, BgFrame | null] = [...slots.value] as [
    BgFrame | null,
    BgFrame | null,
  ]
  armed[back] = frame
  slots.value = armed

  /*
   * 等 DOM 落地。
   *
   * 这里被抢掉时不必收拾 arming：抢占者的 back 与本轮必然相同（front 只在下面那次
   * 翻转里变，而本轮还没翻），它会自己把这一槽重新上膛并松开。就算它在更早的
   * 出口返回了，被按住的也只是一个「非前槽」的槽——它本来就该是 opacity: 0。
   */
  await nextTick()
  if (token !== swapToken) return
  // 读一下布局：这会迫使浏览器把刚落地的样式算完，opacity: 0 从此成为过渡的起点
  ;(back === 0 ? slotAEl : slotBEl).value?.getBoundingClientRect()

  /*
   * 松手 + 翻转，一次提交。上一段已经把起点钉成 0，这里给出的 1 才构成一次变化。
   *
   * 走到这里 fading 必为 false：置它为 true 的只有本段代码，而两个入口都挡在
   * 前面（watch 见 fading 就转记 pendingRetry；clearTimer 里的补做在调用前已归零）。
   */
  arming.value = null
  fading.value = true
  front.value = back

  if (clearTimer !== null) window.clearTimeout(clearTimer)
  clearTimer = window.setTimeout(() => {
    if (token !== swapToken) return
    fading.value = false
    // 旧图这时已被完全盖住，卸掉它释放解码后的位图
    const rest: [BgFrame | null, BgFrame | null] = [...slots.value] as [
      BgFrame | null,
      BgFrame | null,
    ]
    rest[back === 0 ? 1 : 0] = null
    slots.value = rest
    clearTimer = null

    // 淡入期间攒下的变化在这里补上
    if (pendingRetry) {
      pendingRetry = false
      void swapTo(target.value)
    }
    // 动效关掉时不必留余量：那一档根本没有过渡，等待只会推迟卸载
  }, fadeMs() > 0 ? fadeMs() + FADE_CLEAR_MARGIN_MS : 0)
}

/**
 * 目标一变就换。
 *
 * 淡入进行中不打断当前这一轮（半程改向会让还在 0.6 的那层被强行拉回 1，
 * 是肉眼可见的一跳），只记一个标记，等它走完立刻续上。
 */
watch(
  target,
  (frame) => {
    if (fading.value) {
      pendingRetry = true
      return
    }
    void swapTo(frame)
  },
  { immediate: true },
)

/*
 * 地址被改过的帧要给第二次机会。
 *
 * 否则用户把打错的地址修对了，那一帧仍在 failed 里，永远不再尝试加载。
 * 按 sig 记录 + 列表变化时重置，正好覆盖「改了地址」与「换了一档」两种情况。
 */
watch(
  () => settings.bgFrames.map((frame) => frame.sig).join('|'),
  () => {
    failed.value = new Set()
  },
)

/* ── 轮换定时器 ───────────────────────────────── */

let rotateTimer: number | null = null

function stopRotate() {
  if (rotateTimer !== null) {
    window.clearInterval(rotateTimer)
    rotateTimer = null
  }
}

/*
 * 开关、间隔、帧数任一变化都重建定时器。
 *
 * bgRotating 已经把「开关开着但只有一帧」排除掉了（见 store），所以这里不必
 * 再判断条数——一帧的时候定时器根本不会建立，不会空转。
 */
watch(
  [() => settings.bgRotating, () => settings.bgIntervalMs],
  ([rotating, interval]) => {
    stopRotate()
    if (!rotating) return
    rotateTimer = window.setInterval(() => settings.advanceBg(), interval)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  stopRotate()
  if (clearTimer !== null) window.clearTimeout(clearTimer)
})

/* ── 样式 ─────────────────────────────────────── */

/** 底色层：图片档下是图未就绪 / 模糊外扩时透出的底 */
const baseStyle = computed(() => ({ backgroundColor: settings.bgBaseColor }))

/**
 * 单个槽位的样式。
 *
 * 纯色帧走 backgroundColor，图片帧走 backgroundImage + cover；模糊只作用在
 * 图片帧上（纯色底上模糊没有任何视觉差异，白付一条合成链）。
 */
function slotStyle(index: 0 | 1) {
  const frame = slots.value[index]
  const isFront = front.value === index
  /*
   * 上膛中的那一槽被按在 0 且摘掉过渡：它是下一段淡入的起点，必须先以这个样子
   * 被浏览器算过一遍（见 swapTo）。摘过渡是关键——留着的话这一步本身会变成
   * 一段 1 → 0 的淡出，而不是瞬间归零。
   */
  const isArming = arming.value === index
  /*
   * 前槽恒为 1；后槽在淡入期间同样是 1（垫在下面防止透出底色，见文件头注释），
   * 淡入结束后归零。
   */
  const opacity = isArming ? 0 : isFront ? 1 : fading.value ? 1 : 0
  const base: Record<string, string | number | undefined> = {
    opacity,
    // 前槽在上：新图从 0 淡到 1 时盖住下面那张
    zIndex: isFront ? 2 : 1,
    /*
     * 动效关掉时彻底摘掉过渡，而不是依赖全局的 transition-duration: 0.01ms。
     *
     * 0.01ms 仍然是一段过渡：新层挂上 opacity: 1 的那一帧，浏览器给出的是起点值 0，
     * 而旧层的清理定时器在 fadeMs() === 0 时是同一批任务里执行的，已经把图卸了。
     * 两层同时不画东西，底色就会透出来闪一帧。
     */
    transition: settings.motionEnabled && !isArming ? undefined : 'none',
  }

  /*
   * 空槽直接归零，且摘掉过渡。
   *
   * 卸掉图的那一刻这层已经什么都不画了，让它再花 --dur-bg 把 opacity 从 1 补到 0
   * 是一段完全看不见的动画——白占一条合成链，也让「是否正在淡入」不好观测。
   */
  if (!frame) return { ...base, opacity: 0, transition: 'none' }

  if (frame.kind === 'color') {
    return { ...base, backgroundColor: frame.color, inset: '0' }
  }

  const blur = settings.effectiveBlur
  return {
    ...base,
    backgroundImage: settings.frameBackground(frame),
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    filter: blur > 0 ? `blur(${blur}px)` : undefined,
    // 模糊会让边缘一圈变透明露出底色，向外扩张两倍半径补掉
    inset: blur > 0 ? `-${blur * 2}px` : '0',
  }
}

const slotAStyle = computed(() => slotStyle(0))
const slotBStyle = computed(() => slotStyle(1))

/**
 * 噪点与压暗两层不再互斥挂载，改为交叉淡入。
 *
 * v-if 切换会让「纯色 ↔ 图片」换档时颗粒层与压暗层硬生生地跳变，
 * 而背景本身是平滑过渡的，两者不同步就显得很脏。
 */
const grainOpacity = computed(() => (settings.isImageMode ? 0 : 1))
const dimOpacity = computed(() => (settings.isImageMode ? 1 : 0))
</script>

<template>
  <!--
    所有背景层都裹在这一层里，它自己是个层叠上下文（position + z-index）。

    必须有这个包裹层：两个槽位要靠 z-index 1/2 决定谁在上（新图盖住旧图），
    而 .app__content 只有 z-index: 1。不隔离的话它们就是同一个层叠上下文里的兄弟，
    前槽的 2 会盖过内容的 1——表现为背景一出来方格就看不见了。
    隔离后那两个数只在这层内部比较，整层恒定压在内容之下。
  -->
  <div class="bg" aria-hidden="true">
    <!--
      底色层：纯色常驻、纯装饰不参与命中。
      图片档下它是图就绪前的唯一底，加载中借 --loading 播占位动画。
    -->
    <div class="bg__base" :class="{ 'bg__base--loading': loading }" :style="baseStyle" />

    <!-- 两个常驻槽位，交替承载新旧背景 -->
    <div ref="slotAEl" class="bg__slot" :style="slotAStyle" />
    <div ref="slotBEl" class="bg__slot" :style="slotBStyle" />

    <!-- 噪点只在纯色底上叠：壁纸自带纹理，再加颗粒只会显脏 -->
    <div class="bg__grain" :style="{ opacity: grainOpacity }" />
    <!-- 图片底则压暗，保证白字与方格描边在任意壁纸上都可读 -->
    <div class="bg__dim" :style="{ opacity: dimOpacity }" />
  </div>
</template>

<style scoped>
/*
 * 背景整体。
 *
 * position + z-index: 0 让它成为层叠上下文，把内部槽位的 z-index 1/2 关在里面；
 * 对外它只是 .app 里一个 z-index 为 0 的层，恒在 .app__content（z-index: 1）之下。
 *
 * overflow: hidden 是给模糊外扩兜底：图片层在模糊时会向外扩 2×半径，
 * 让它在这里就被裁掉，而不是指望祖先的 overflow。
 */
.bg {
  position: absolute;
  z-index: 0;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.bg__base,
.bg__slot,
.bg__grain,
.bg__dim {
  position: absolute;
  pointer-events: none;
}

/*
 * .bg 内部的层序，自下而上：底色 0 → 槽位 1/2（行内给，互相决定新旧）→ 颗粒/压暗 3。
 *
 * 这三个数必须都显式写出来。只要有一层留 z-index: auto，它就会掉到带 z-index 的
 * 槽位之下——压暗层落到壁纸底下什么也压不住，浅色壁纸上白字和方格描边直接糊成一片。
 */
.bg__base {
  z-index: 0;
  /* inset 固定为 0，不随模糊外扩——补偿外扩只对图片层有意义 */
  inset: 0;
}

.bg__grain,
.bg__dim {
  z-index: 3;
  inset: 0;
}

/*
 * 槽位。
 *
 * inset 由行内给（模糊时要外扩），这里只定过渡。--dur-bg 比 --dur-base 长得多：
 * 换背景是整屏面积的变化，240ms 会显得突兀，接近 1 秒才读作「渐变」。
 * will-change 常驻在这两层上是有意的：它们的 opacity 是唯一会动的属性，
 * 且总数固定为二，不会随内容增长。
 */
.bg__slot {
  transition: opacity var(--dur-bg) linear;
  will-change: opacity;
}

/* 噪点 / 压暗跟着一起淡，换档时与背景同步 */
.bg__grain,
.bg__dim {
  transition: opacity var(--dur-bg) linear;
}

/*
 * 占位动画：加载期在纯色底上扫过一道极淡的斜光。
 *
 * 用 ::after 而不是给底层换背景：底色是行内写的 backgroundColor，
 * 换成渐变会冲掉它；而且 sheen 要浮在底色之上。扫过的是一层近乎透明的白，
 * 无色相，不触发视觉语言的「去 AI 感」红线。
 *
 * 动画交给 motion 总闸：data-motion='off' 时只播一帧即停，仍落回静态占位。
 */
.bg__base--loading::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    110deg,
    transparent 32%,
    rgb(255 255 255 / 0.03) 45%,
    rgb(255 255 255 / 0.06) 50%,
    rgb(255 255 255 / 0.03) 55%,
    transparent 68%
  );
  background-size: 220% 100%;
  animation: bg-sweep 1.7s var(--ease) 0.2s infinite;
  will-change: background-position;
}

@keyframes bg-sweep {
  from {
    background-position: 130% 0;
  }
  to {
    background-position: -130% 0;
  }
}

/*
 * 噪点。
 *
 * 大面积纯色在 8 位色深下会出现色带，且观感偏塑料；一层几乎不可见的
 * 颗粒就能消掉这两点，代价只有一个内联 data URI。
 *
 * 刻意不用 mix-blend-mode: overlay——overlay 在 base < 0.5 时是
 * 2 × base × blend，底色亮度只有 0.055，噪点会被压到看不见。
 * 普通混合 + 极低 opacity 才能真正提亮像素，也顺带避开了
 * mix-blend-mode 建立层叠上下文与 backdrop root 的副作用。
 *
 * baseFrequency 取 0.8：更低会聚成云雾状色块，更高在高 DPR 屏上
 * 被下采样成均匀灰，两头都失去颗粒感。
 *
 * 这一层的 opacity 由行内的档位淡入控制，颗粒本身的浓度改由
 * background 的 alpha 承担——两者相乘正好还是原来的 0.035。
 */
.bg__grain {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E");
}

/*
 * 图片底的压暗层。
 *
 * 0.55 是按最坏情况（纯白壁纸）定的下限：白色名称文字在这个底上对比度约 4.5:1，
 * 再浅就压不住白墙照片。方格与抽屉都是深色面板，这一层同时保住了它们的描边可见性。
 */
.bg__dim {
  background: rgb(6 6 8 / 0.55);
}
</style>

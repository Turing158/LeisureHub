import { nanoid } from 'nanoid'

import { PROFILE_PRESETS, type ProfilePreset } from '@/types/profile'
import { type Tile, type TileDraft } from '@/types/tile'
import type { TodoItem } from '@/types/todo'

/*
 * 首次打开时的初始内容，也是设置里「重置为默认」的目标状态。
 *
 * 只放两样东西：方块布局与待办清单。设置项仍归 stores/settings 的 DEFAULTS——
 * 那边每个字段都带着自己的取舍注释，搬过来会让「这个默认值为什么是这个数」
 * 离开它的理由。这里放的是**内容**（哪一格放什么、清单里有什么），
 * 与 data/recommend.ts 同一个性质。
 *
 * 一律做成 build 函数而不是导出常量：调用方拿到的必须是能直接改写的新数组，
 * 否则 store 一次原地改写就把「默认值」本身改掉了，重置后拿到的是上次被改过的状态。
 *
 * **每个配置档预设各有一张播种表**，不共用一张再重排：电脑档的锚点按 15 列折算，
 * resize 到 3 列时宽 4 的日历、宽 7 的搜索在 `areaFree` 里 `col + w > cols` 恒为 false，
 * 落进 displaced，内层补位循环的 `col + w <= nextCols` 也永不成立——三个组件全部进
 * overflow 暂存，手机档首次打开会是一片空网格。
 */

/** 一个方块的播种位置：锚点槽位下标 + 内容（id 由 build 时补） */
interface GridSeed {
  anchor: number
  tile: TileDraft
}

/**
 * 默认桌面（电脑档）。
 *
 * 锚点按电脑档预设的 15 列折算：0 起是第 0 行，15 起是第 1 行，依此类推。
 * 跨格方块只写在锚点槽位上，被它覆盖的槽位留 null——那是 stores/grid 的不变量，
 * 见那里 coverage 的注释。
 *
 *      0  1  2  3  4  5  6  7  8  9 10 11 12 13 14
 *  r0  日  历  组  件  搜  索  组  件  组  件  件  天  气  组  件
 *  r1  日  历  组  件  ·  链  接  五  枚  ·   ·   天  气  组  件
 *  r2  待  办  件  ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·
 *  r3  待  办  件  ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·   ·
 *
 * 三个组件都不起名（name: ''）：它们自己就画着标题，方格下再挂一行文字是重复，
 * 而且没起名的方格会长到名称行处（见 TileCell 的 --label-block），正好占满两行。
 *
 * 链接的 icon 一律写各站自家的 favicon 直链，与 data/recommend.ts 同一条纪律
 * （不走第三方取图服务）；这五条也正是从那张推荐表里挑出来的。
 */
const GRID_SEEDS: GridSeed[] = [
  {
    anchor: 0,
    tile: {
      kind: 'widget',
      name: '',
      widgetId: 'calendar',
      spanW: 4,
      spanH: 2,
      // 30% 黑：压在壁纸上仍读得出日期，又不把壁纸盖成一块实心板
      props: { bgColor: '#0000004c' },
    },
  },
  {
    anchor: 4,
    tile: {
      kind: 'widget',
      name: '',
      widgetId: 'search',
      spanW: 7,
      spanH: 1,
      // 输入框要比两侧组件更实一档（50% 黑），否则光标落进去时读不出边界
      props: { bgColor: '#00000080', engineId: 'bing' },
    },
  },
  {
    anchor: 11,
    tile: {
      kind: 'widget',
      name: '',
      widgetId: 'weather',
      spanW: 4,
      spanH: 2,
      props: { bgColor: '#0000004c', lat: 22.2082, lon: 113.4569 },
    },
  },
  {
    anchor: 20,
    tile: {
      kind: 'link',
      name: 'DeepSeek',
      url: 'https://chat.deepseek.com/',
      icon: 'https://fe-static.deepseek.com/chat/favicon.svg',
      spanW: 1,
      spanH: 1,
    },
  },
  {
    anchor: 21,
    tile: {
      kind: 'link',
      name: 'BiliBili',
      url: 'https://www.bilibili.com/',
      icon: 'https://www.bilibili.com/favicon.ico',
      spanW: 1,
      spanH: 1,
    },
  },
  {
    anchor: 22,
    tile: {
      kind: 'link',
      name: 'Turing158博客',
      url: 'https://blog.turing158.cc.cd/',
      icon: 'https://blog.turing158.cc.cd/icons/favicon.png',
      spanW: 1,
      spanH: 1,
    },
  },
  {
    anchor: 23,
    tile: {
      kind: 'link',
      name: 'GitHub',
      url: 'https://github.com/',
      // 深色版：站点视觉恒定深色，浅色那版 favicon 在方格底上几乎看不见
      icon: 'https://github.githubassets.com/favicons/favicon-dark.png',
      spanW: 1,
      spanH: 1,
    },
  },
  {
    anchor: 24,
    tile: {
      kind: 'link',
      name: 'StackOverflow',
      url: 'https://stackoverflow.com/',
      icon: 'https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico',
      spanW: 1,
      spanH: 1,
    },
  },
  { anchor: 30, tile: { kind: 'widget', name: '', widgetId: 'todo', spanW: 3, spanH: 2 } },
]

/**
 * 手机档的播种表。
 *
 * **现在是空的，等用户在手机上自己摆。** 布局是**内容**而不是取舍（见文件头），
 * 猜一张出来只会得到一张没人用的图。摆好之后回读 `leisure-hub:grid@mobile`
 * 转成这张表：存档是**扁平 slots**（长度 cols * rows，大方块只写在锚点槽位、
 * 被覆盖的槽位留 null），按锚点下标折算即可，形状与上面的 GRID_SEEDS 相同。
 * 同时把存档里的 rows 写进 PROFILE_PRESETS.mobile 的 rows 与 area.rows——三处一致。
 *
 * 空表期间手机档首次打开是一片空网格：右键任意格子就能加方块，
 * 与「网格里有什么」无关的那些行为（resize、切档、引用计数、检测）都不受影响。
 *
 * 摆的时候有三条硬约束，违反了不会报错、只会表现为「方块不见了」：
 *
 * - **每个方块宽 ≤ 3**（就是列数）。宽 4 的在 3 列里放不下，直接进 overflow 暂存。
 * - **搜索方块宽取 2 或 3**：wMin 是 2（SEARCH_SPAN_LIMITS），1 会被 tileSpan 提到 2。
 *   3 宽（265px）够 chips 带名称显示（需 241px），2 宽（170px）会收成只有图标。
 * - **组件不起名**（`name: ''`）：它们自己画着标题，方格下再挂一行文字是重复，
 *   而且没起名的方格会长到名称行处、正好占满整格（差 26px）。
 */
const MOBILE_SEEDS: GridSeed[] = [
  { anchor: 0, tile: { kind: 'widget', name: '', widgetId: 'calendar', spanW: 4, spanH: 2, props: { bgColor: '#0000004c' } } },
  { anchor: 8, tile: { kind: 'widget', name: '', widgetId: 'search', spanW: 4, spanH: 1, props: { bgColor: '#00000080', engineId: 'bing' } } },
  { anchor: 12, tile: { kind: 'widget', name: '', widgetId: 'weather', spanW: 4, spanH: 2, props: { bgColor: '#0000004c', lat: 22.2082, lon: 113.4569 } } },
  { anchor: 20, tile: { kind: 'link', name: 'DeepSeek', url: 'https://chat.deepseek.com/', icon: 'https://fe-static.deepseek.com/chat/favicon.svg', spanW: 1, spanH: 1 } },
  { anchor: 21, tile: { kind: 'link', name: 'BiliBili', url: 'https://www.bilibili.com/', icon: 'https://www.bilibili.com/favicon.ico', spanW: 1, spanH: 1 } },
  { anchor: 22, tile: { kind: 'link', name: 'Turing158博客', url: 'https://blog.turing158.cc.cd/', icon: 'https://blog.turing158.cc.cd/icons/favicon.png', spanW: 1, spanH: 1 } },
  { anchor: 23, tile: { kind: 'link', name: 'GitHub', url: 'https://github.com/', icon: 'https://github.githubassets.com/favicons/favicon-dark.png', spanW: 1, spanH: 1 } },
  { anchor: 24, tile: { kind: 'link', name: 'StackOverflow', url: 'https://stackoverflow.com/', icon: 'https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico', spanW: 1, spanH: 1 } },
  { anchor: 28, tile: { kind: 'widget', name: '', widgetId: 'todo', spanW: 4, spanH: 2 } },
]

/** 按预设取播种表；新增预设时这里加一行，不必改 buildDefaultGrid */
const SEEDS_BY_PRESET: Record<ProfilePreset, GridSeed[]> = {
  desktop: GRID_SEEDS,
  mobile: MOBILE_SEEDS,
}

/** 首条待办的正文：空清单会让待办方块只显示一句「还没有待办」，不如给个可勾掉的示例 */
const TODO_SEEDS = ['新增一条代办吧！']

/**
 * 默认壁纸。
 *
 * 放在这里而不是 stores/settings 的 DEFAULTS 里，与上面那张链接表同一个判据：
 * 它是**内容**（一张具体的图），不是取舍（「背景该不该默认放图」才是）。
 * 那边只留 `bgMode: 'image'` 这个决定，图本身在这一处。
 */
const WALLPAPER =
  'https://pic.turing158.de5.net/file/home/1787929710900_destop-low.png'

/**
 * 默认网格。
 *
 * 返回 cols / rows 而不让调用方自己拼：slots 的长度必须严格等于 cols * rows
 * （stores/grid 的 load 会校验并整份丢弃），三者只能一处产出。
 *
 * 入参是**预设**而不是「当前档」：调用方（grid.seedDefaults）从索引里取当前档的
 * preset 传进来，于是「重置为默认」回到的是**这个档自己的**预设，而不是电脑档。
 */
export function buildDefaultGrid(
  preset: ProfilePreset,
): { cols: number; rows: number; slots: (Tile | null)[] } {
  const { cols, rows } = PROFILE_PRESETS[preset]
  const slots: (Tile | null)[] = Array.from({ length: cols * rows }, () => null)
  for (const seed of SEEDS_BY_PRESET[preset]) {
    // id 每次现取而不是写死常量：撤销删除会把带原 id 的方块放回来，写死会撞 v-for 的 key
    slots[seed.anchor] = { ...seed.tile, id: nanoid() } as Tile
  }
  return { cols, rows, slots }
}

/** 默认待办清单。createdAt 取当下而不是写死时间戳：那个数只用来排序，写死会显示成很久以前 */
export function buildDefaultTodos(): TodoItem[] {
  return TODO_SEEDS.map((text) => ({ id: nanoid(), text, done: false, createdAt: Date.now() }))
}

/**
 * 默认的网络背景列表。
 *
 * 返回类型写成结构而不是 import settings 的 BgUrlItem：那边正 import 本文件，
 * 虽然 `import type` 在编译期会被擦掉、不成运行时环；但这个类型只有两个字段，
 * 就地写清比留一条反向依赖更省事。
 *
 * id 每次现取：它是列表行的 v-for key 与 bgPick 的引用目标，写死常量会让
 * 「重置后又添一条」出现两行同 id。**bgPick 不必跟着重置**——默认只有一帧，
 * 空 pick 会被那个 watch 解成第一帧（见 stores/settings 里 bgPick 的注释）。
 */
export function buildDefaultBgUrls(): { id: string; url: string }[] {
  return [{ id: nanoid(), url: WALLPAPER }]
}

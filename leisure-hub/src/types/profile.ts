/**
 * 配置档（多配置文件）。
 *
 * 一份 localStorage 里放多套桌面：每一档有自己的方格布局与全部外观设置，
 * 用户手打的记录（待办、搜索记录）与隐私开关一律**不**按档分——理由见
 * stores/settings 里 `:global` 那段与 useTodos 的文件头。
 *
 * 这个文件只放「档位」这件事本身的形状与两张预设表，不 import 任何 store：
 * types/tile 要读预设的行列数，utils/profileKey 要读预设名，stores/settings
 * 要读区域四项——三处都在它下游，放这里才不成环。
 */

/**
 * 预设：一档配置的出厂形态。
 *
 * 只有两个，且**不打算随设备种类增长**：平板落在 desktop 是有意接受的折中
 * （820px 宽装得下 8 列，档里写的是 1440，于是横向滚动——那正是它今天的行为），
 * 为它单开第三档要重算一遍版式、再验一遍互解，而用户点一下就能切过去。
 */
export type ProfilePreset = 'desktop' | 'mobile'

/** UI 里三个「新建」按钮的排列顺序，也是首次运行实例化的顺序 */
export const PRESET_ORDER: readonly ProfilePreset[] = ['desktop', 'mobile']

/** 预设的中文名，同时是首次实例化时那两档的档名 */
export const PRESET_LABEL: Record<ProfilePreset, string> = {
  desktop: '电脑',
  mobile: '手机',
}

/**
 * 一档预设的几何。
 *
 * 网格行列与区域四项**必须互解**，否则首帧按预设摆好的布局会被 TileGrid 的
 * resize watch 挪一遍（见 stores/settings 的 DEFAULTS.areaWidth 与
 * useGridMetrics 那段「回不到原来的锚点」）。两者写在同一个对象里就是为了
 * 让这条互解检查在一屏内看得见：
 *
 *   desktop  15 × 6  ←→  pixel 1440×720   `fitCount(1440,75,20)=15`、`fitCount(720,101,20)=6`
 *   mobile    3 × N  ←→  cell  3×N        cell 档不做反解，同一个数即恒等
 *
 * mobile 用 cell 而不是 pixel 正是为了这条：`useGridMetrics` 在 cell 档直接
 * 采用用户给的数，只要 `area.cols/rows` 与 `cols/rows` 是同一对数就成立，
 * 不像像素档那样要验 `fitCount` 反解。
 *
 * `area.mode` 的类型刻意写成字面量而不是 import stores/settings 的 `AreaMode`：
 * 那边正 import 本文件，反向引用会成环。两者是同一个联合类型，结构上互相可赋值。
 */
export interface PresetDef {
  /** 播种网格的列数；每个方块的宽都不得超过它 */
  cols: number
  /** 播种网格的行数，必须等于 area 里对应的那个数 */
  rows: number
  /** 区域尺寸设置的四项 + 档位 */
  area: {
    mode: 'pixel' | 'cell'
    width: number
    height: number
    cols: number
    rows: number
  }
}

/**
 * 两档预设。
 *
 * **手机档只改「几格」，不改 `--tile-size`。** 后者牵动四个组件三十余种版式：
 * 搜索 h=1 那档的 75px 是逐像素排满的（5+32+4+22+5=68），日历与天气各有一张
 * 按 16 种形状推导的版式表且带绝对像素的纵向上界，圆角上限与角标内缩阈值
 * （t ≥ 0.293R）也都是按 26px 定的。
 *
 * 3 列是算术而非审美：`fitCount(space, 75, 20) = floor((space + 20) / 95)`，
 * `space = innerWidth - 2 × 24`（--grid-padding），4 列需要 408px 的视口宽，
 * 而当下最主流的两档 iPhone 是 390 与 393——放不下。3 列从 320 起全部成立。
 *
 * mobile 的 rows 与 data/defaults 里那张播种表**必须是同一个数**。
 */
export const PROFILE_PRESETS: Record<ProfilePreset, PresetDef> = {
  desktop: {
    cols: 15,
    rows: 6,
    area: { mode: 'pixel', width: 1440, height: 720, cols: 0, rows: 0 },
  },
  mobile: {
    /*
     * rows 是**从布局算出来的**（最后一个方块的行 + 它的 spanH），不是先定的。
     * 手机档的播种表还空着（等用户在手机上摆好，见 data/defaults 的 MOBILE_SEEDS），
     * 6 行只是这段时间里的占位：`cellExtent(6, 101, 20) = 706`，约等于一屏。
     * 回填播种表时这个数要跟着改，两处必须一致。
     */
    cols: 4,
    rows: 8,
    area: { mode: 'cell', width: 0, height: 0, cols: 4, rows: 8 },
  },
}

/** 档名长度上限：抽屉里是一行输入框，再长也只会被截断显示 */
export const PROFILE_NAME_MAX = 16

/** 索引里的一项 */
export interface ProfileEntry {
  /**
   * 寻址用的 id，拼进 `:grid@<id>` / `:settings@<id>`。
   *
   * 首次运行实例化的两档固定用 `desktop` / `mobile`（手改存档时看得懂，
   * 与 widgetProps 里那条纪律同源）；**用户新增的一律现取 nanoid，
   * 永不复用这两个字面量**——否则「删掉 desktop → 又从电脑预设新建一个」
   * 会捡回一份没清干净的旧存档。
   */
  id: string
  /** Stable external identity used by exports and future cloud sync. */
  uuid: string
  name: string
  /**
   * 出厂预设，**必须持久化**。
   *
   * 「重置为默认」要回到**这个档自己的**预设，不是回到电脑档；
   * grid.reset() 与 settings.reset() 都得据此取行列与区域四项。
   */
  preset: ProfilePreset
}

/**
 * 索引存档。
 *
 * 带 version 是刻意的：现存的几份存档里有三份没有版本（待办与搜索记录是裸数组），
 * 它们只能靠逐项 sanitizer 兜底。索引是**其余所有按档键的寻址表**，
 * 读错一次就等于所有档都找不到，它必须能判「这份我不认识」。
 */
export interface ProfileIndex {
  version: number
  active: string
  items: ProfileEntry[]
}

export const PROFILE_SCHEMA_VERSION = 1

export function isProfilePreset(value: unknown): value is ProfilePreset {
  return value === 'desktop' || value === 'mobile'
}

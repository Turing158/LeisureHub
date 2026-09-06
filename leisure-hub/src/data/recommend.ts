import type { TileDraft } from '@/types/tile'

/**
 * 推荐 tab 的一个分类：折叠头 + 该分类下的站点条目。
 */
export interface RecommendCategory {
  /** 分类名，作折叠头与 aria 标签 */
  title: string
  items: TileDraft[]
}

/**
 * 「推荐」tab 的数据源，按分类组织。
 *
 * v0.1 的测试方块已完成「点空格 → Dialog → 选推荐 → 落格」链路的验证使命，撤掉，
 * 换成按主题分组的真实站点。每个分类在 TabRecommend 里渲染成一个可折叠的
 * button + region 手风琴（默认全展开，用户自由收起）。
 *
 * icon 一律写各站自家的 favicon 直链（来源见 plan/recommend.md 的清单），不走
 * 第三方取图服务：那类服务要把用户访问的域名送出去，也多一个会挂的依赖。
 * 取不到图时 TileIcon 的 <img> 加载失败，仍旧只是空白而非破图；真要兜底就清空
 * 该条的 icon，回到 name 首字符。
 *
 * 一律补齐协议头（豆包那条源清单里是 `//` 开头的协议相对地址）：TileIcon 判定
 * 「是不是图片」的正则虽然接受 `/` 开头，但方格数据会被序列化进 localStorage，
 * 留着协议相对地址会让这份存档依赖当初的页面协议。
 */
export const RECOMMEND_CATEGORIES: RecommendCategory[] = [
  {
    title: 'Turing158',
    items: [
      {
        kind: 'link',
        name: 'Turing158博客',
        url: 'https://blog.turing158.cc.cd/',
        icon: 'https://blog.turing158.cc.cd/icons/favicon.png',
      },
    ],
  },
  {
    title: 'Git',
    items: [
      {
        kind: 'link',
        name: 'GitHub',
        url: 'https://github.com/',
        // 深色版：站点视觉恒定深色，浅色那版 favicon 在方格底上几乎看不见
        icon: 'https://github.githubassets.com/favicons/favicon-dark.png',
      },
      { kind: 'link', name: 'Gitee', url: 'https://gitee.com/', icon: 'https://gitee.com/favicon.ico' },
    ],
  },
  {
    title: 'AI',
    items: [
      {
        kind: 'link',
        name: 'DeepSeek',
        url: 'https://chat.deepseek.com/',
        icon: 'https://fe-static.deepseek.com/chat/favicon.svg',
      },
      {
        kind: 'link',
        name: 'DeepSeek开放平台',
        url: 'https://platform.deepseek.com/',
        icon: 'https://fe-static.deepseek.com/platform/favicon.svg',
      },
      {
        kind: 'link',
        name: '豆包',
        url: 'https://www.doubao.com/',
        icon: 'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao/chat/favicon-doubao.png',
      },
      {
        kind: 'link',
        name: '千问',
        url: 'https://tongyi.aliyun.com/',
        icon: 'https://img.alicdn.com/imgextra/i4/O1CN01PIhuaD29Z9kq4Y1xq_!!6000000008081-2-tps-80-80.png',
      },
    ],
  },
  {
    title: '编程',
    items: [
      {
        kind: 'link',
        name: '菜鸟教程',
        url: 'https://www.runoob.com/',
        icon: 'https://www.runoob.com/favicon.ico',
      },
      {
        kind: 'link',
        name: 'CSDN',
        url: 'https://www.csdn.net/',
        icon: 'https://g.csdnimg.cn/static/logo/favicon32.ico',
      },
      {
        kind: 'link',
        name: '博客园',
        url: 'https://www.cnblogs.com/',
        // 走主站：assets.cnblogs.com 那份被 Chrome 的 ORB 拦掉（ERR_BLOCKED_BY_ORB），curl 却是 200
        icon: 'https://www.cnblogs.com/favicon.ico',
      },
      { kind: 'link', name: '力扣', url: 'https://leetcode.cn/', icon: 'https://leetcode.cn/favicon.ico' },
      {
        kind: 'link',
        name: 'StackOverflow',
        url: 'https://stackoverflow.com/',
        // 走 cdn.sstatic.net：stackoverflow.com 上的同一路径带机器人拦截，直连返回 403
        icon: 'https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico',
      },
    ],
  },
  {
    title: '视频',
    items: [
      {
        kind: 'link',
        name: 'BiliBili',
        url: 'https://www.bilibili.com/',
        icon: 'https://www.bilibili.com/favicon.ico',
      },
      {
        kind: 'link',
        name: '抖音',
        url: 'https://www.douyin.com/',
        icon: 'https://lf1-cdn-tos.bytegoofy.com/goofy/ies/douyin_web/public/favicon.ico',
      },
      { kind: 'link', name: '优酷', url: 'https://www.youku.com/', icon: 'https://www.youku.com/favicon.ico' },
      { kind: 'link', name: '爱奇艺', url: 'https://www.iqiyi.com/', icon: 'https://www.iqiyi.com/favicon.ico' },
    ],
  },
]
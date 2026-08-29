/**
 * 只接受 #RGB / #RRGGBB。
 *
 * 颜色值会被直接写进 background / backgroundColor，必须挡住任意字符串，
 * 否则 localStorage 里被改过的脏数据就能注入样式。
 * 背景设置与方格底色共用这一处校验。
 */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)
}

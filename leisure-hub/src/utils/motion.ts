/** 基准过渡时长，与 style.css 的 --dur-base 保持一致 */
export const MOTION_BASE_MS = 240

/**
 * 是否跳过动效。
 *
 * 读 <html data-motion> 而不是直接查 matchMedia：设置里的「始终开启 / 关闭」要能
 * 覆盖系统偏好，而该属性已经是设置 store 折算后的结果。属性缺失（首帧）时回落到系统偏好。
 */
export function motionDisabled() {
  const flag = document.documentElement.dataset.motion
  if (flag === 'off') return true
  if (flag === 'on') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 取 --ease 的实际值。
 *
 * Web Animations API 的 easing 只认字面量，不解析 CSS 变量；
 * 现读一次而不是抄一份常量，曲线仍然只在 style.css 里定义一处。
 */
export function motionEasing(fallback = 'ease') {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--ease').trim()
  return value || fallback
}

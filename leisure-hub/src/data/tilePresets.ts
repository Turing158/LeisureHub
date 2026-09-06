/**
 * 方格底色预设。
 *
 * 与设置里的 BG_PRESETS 是两套不同约束的调色板，不能复用：
 * 那些是低明度的页面底色，贴在方格上几乎与玻璃底无异；
 * 方格底色要在深色背景上「跳出来」，取中等明度的饱和色，
 * 同时保证白色图标 / 首字母压在上面仍然清晰。
 */
export const TILE_BG_PRESETS = [
  { value: '#4f46e5', label: '靛蓝' },
  { value: '#2563eb', label: '亮蓝' },
  { value: '#0891b2', label: '青碧' },
  { value: '#059669', label: '翠绿' },
  { value: '#ca8a04', label: '琥珀' },
  { value: '#ea580c', label: '橙红' },
  { value: '#dc2626', label: '朱红' },
  { value: '#db2777', label: '桃红' },
  { value: '#7c3aed', label: '紫罗兰' },
  { value: '#475569', label: '石板' },
] as const

/**
 * 组件内的文字色预设。
 *
 * 与 TILE_BG_PRESETS 的约束正好相反：那些是要「跳出来」的块面色，
 * 而文字是压在块面之上的，必须在中等明度的饱和底色上仍然可读。
 * 因此这里全取高明度的浅色，外加一个近黑用于浅色底（如琥珀、桃红）上的反白场景。
 */
export const TILE_TEXT_PRESETS = [
  { value: '#ffffff', label: '纯白' },
  { value: '#e2e8f0', label: '云白' },
  { value: '#94a3b8', label: '灰蓝' },
  { value: '#fcd34d', label: '暖黄' },
  { value: '#fca5a5', label: '浅红' },
  { value: '#86efac', label: '浅绿' },
  { value: '#93c5fd', label: '浅蓝' },
  { value: '#d8b4fe', label: '浅紫' },
  { value: '#111827', label: '近黑' },
] as const

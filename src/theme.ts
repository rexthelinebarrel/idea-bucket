// 全局主题：墨蓝深色为底，琥珀色作为主色（灵感=灯）
// 高级感原则：发丝边框、克制留白、每屏最多一个实心主按钮、选中态用淡底+描边而非实心色块
export const colors = {
  bg: '#0B0E13',
  card: '#151B24',
  cardBorder: '#242E3B',
  text: '#ECF0F6',
  textDim: '#8B98A9',
  accent: '#FFB020',
  accentSoft: 'rgba(255, 176, 32, 0.12)',
  onAccent: '#1A1206',
  danger: '#E5534B',
  dangerSoft: 'rgba(229, 83, 75, 0.14)',
  primary: '#4C9AFF',
  primarySoft: 'rgba(76, 154, 255, 0.14)',
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
} as const;

// 灵感状态流转：🌱原始 → 🔗已连接 → 🎯待开工 → 🏗️进行中 → ✅完成
// 存储层用英文枚举，emoji 只做显示映射
export const STATUS = {
  raw: { label: '🌱 原始', color: '#8A94A0' },
  connected: { label: '🔗 已连接', color: '#4C9AFF' },
  ready: { label: '🎯 待开工', color: '#F7B731' },
  building: { label: '🏗️ 进行中', color: '#3EBD6E' },
  done: { label: '✅ 完成', color: '#5A6470' },
} as const;

export type IdeaStatus = keyof typeof STATUS;

// 全局主题：深色为底，琥珀色作为主色（灵感=灯）
export const colors = {
  bg: '#0F141A',
  card: '#1A222C',
  cardBorder: '#2A3441',
  text: '#E9EDF2',
  textDim: '#8D99A8',
  accent: '#FFB020',
  danger: '#E5534B',
  primary: '#4C9AFF',
};

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

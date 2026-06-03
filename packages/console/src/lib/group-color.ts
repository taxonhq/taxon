/**
 * 分组配色 —— 单一来源（#109 跨页色彩系统）。
 *
 * 标签分组（TagGroup）在任何出现处都用同一套色：有机体 / 实体图谱的菌核、
 * 治理 / 审核 / 检索表格里的分组色点。让用户一眼把表格里的「菜系」
 * 和图谱里的同色菌核连起来。
 *
 * 按 groupId（或缺省时 groupSlug）哈希到固定色相位，bio/lime/amber 暖谱。
 */

// 18 色 bio 暖谱（teal / lime / amber / 橄榄 / 沙金）。色数越多，分组哈希撞色概率越低。
// 哈希映射规则不变，跨页一致性保留（表格色点 ↔ 图谱菌核同色）。
export const GROUP_PALETTE = [
  "#6ff5c8", // bio teal
  "#c4f85a", // 孢子 lime
  "#eaa066", // 暖琥珀
  "#5fe3b4", // 深 teal
  "#a8d96b", // 橄榄 lime
  "#d98a5a", // 暖橙
  "#8fd9c0", // 浅 teal
  "#e0b87a", // 沙金
  "#b0e85a", // 亮 lime
  "#cf9a6a", // 陶土
  "#4fd6a8", // 翡翠 teal
  "#d6e86a", // 芥末 lime
  "#f0b888", // 杏
  "#7ae0d0", // 薄荷 teal
  "#9cc94e", // 苔绿
  "#c98e5e", // 焦糖
  "#abe3c4", // 雾青
  "#e8c98a", // 浅金
] as const;

/** 把分组 key（groupId 优先）映射到固定色 */
export function groupColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return GROUP_PALETTE[h % GROUP_PALETTE.length];
}

/**
 * 分组配色 —— 单一来源（#109 跨页色彩系统）。
 *
 * 标签分组（TagGroup）在任何出现处都用同一套色：有机体 / 实体图谱的菌核、
 * 治理 / 审核 / 检索表格里的分组色点。让用户一眼把表格里的「菜系」
 * 和图谱里的同色菌核连起来。
 *
 * 按 groupId（或缺省时 groupSlug）哈希到固定色相位，bio/lime/amber 暖谱。
 */

export const GROUP_PALETTE = [
  "#6ff5c8", // bio teal
  "#c4f85a", // 孢子 lime
  "#eaa066", // 暖琥珀
  "#5fe3b4", // 深 teal
  "#a8d96b", // 橄榄 lime
  "#d98a5a", // 暖橙
  "#8fd9c0", // 浅 teal
  "#e0b87a", // 沙金
  "#b0e85a",
  "#cf9a6a",
] as const;

/** 把分组 key（groupId 优先）映射到固定色 */
export function groupColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return GROUP_PALETTE[h % GROUP_PALETTE.length];
}

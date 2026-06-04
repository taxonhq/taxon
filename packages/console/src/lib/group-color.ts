/**
 * 分组配色 —— 单一来源（#109 跨页色彩系统）。
 *
 * 标签分组（TagGroup）在任何出现处都用同一套色：有机体 / 实体图谱的菌核、
 * 治理 / 审核 / 检索表格里的分组色点。让用户一眼把表格里的「菜系」
 * 和图谱里的同色菌核连起来。
 *
 * 按 groupId（或缺省时 groupSlug）哈希到固定色相位。
 *
 * 调色板（v2）：自然有机色，但**色相拉开**——绕色相环铺一圈，每色之间留足间距，
 * 任意两个分组都明显不同（修「组少时几个绿撞成一片」）。整体仍偏暖、低饱和、土质，
 * 不走霓虹彩虹，守住菌丝/大地调性。哈希映射规则不变，跨页一致（表格色点 ↔ 图谱菌核同色）。
 */

export const GROUP_PALETTE = [
  "#4dc8a6", // teal
  "#aacb4e", // 孢子 lime（黄绿）
  "#e3b94f", // 金黄
  "#dd9446", // 琥珀橙
  "#dd7a55", // 陶土 / 珊瑚红
  "#cf7f86", // 灰玫瑰
  "#b483b0", // 梅紫
  "#7a9cc0", // 雾蓝
  "#3fa3a0", // 深青
  "#73c279", // 草绿
  "#cbaa6a", // 沙金 / 卡其
  "#9a8fbf", // 灰紫罗兰
] as const;

/** 把分组 key（groupId 优先）映射到固定色 */
export function groupColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return GROUP_PALETTE[h % GROUP_PALETTE.length];
}

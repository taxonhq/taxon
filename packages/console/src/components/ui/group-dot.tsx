import { groupColor } from "@/lib/group-color";

/**
 * GroupDot — 分组色点（#109 跨页色彩系统）。
 * 与有机体 / 实体图谱的菌核同源（按 groupId 取色），让表格里的分组
 * 和图谱里的同色节点一眼对应。放在分组名之前。
 */
export function GroupDot({ groupKey, size = 8 }: { groupKey: string; size?: number }) {
  const c = groupColor(groupKey);
  return (
    <span
      aria-hidden
      className="inline-block rounded-full shrink-0"
      style={{ width: size, height: size, background: c, boxShadow: `0 0 6px ${c}80` }}
    />
  );
}

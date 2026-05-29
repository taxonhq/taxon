"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Search, X, Tag as TagIcon, GitBranch } from "lucide-react";
import { searchTags, getTagGroups, type Tag, type TagGroup } from "@/lib/api";

interface PickedTag {
  tagId:     string;
  tagName:   string;
  groupName: string;
  groupSlug: string;
}

interface TagPickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (tag: PickedTag) => void;
  /** "tag" 表示选普通标签，"descendantOf" 表示选作为子孙根的标签 */
  mode: "tag" | "descendantOf";
}

export function TagPicker({ open, onClose, onPick, mode }: TagPickerProps) {
  const t = useTranslations("search");
  const tc = useTranslations("common");
  const [groups, setGroups]   = useState<Pick<TagGroup, "id" | "slug" | "name">[]>([]);
  const [filterGroup, setFilterGroup] = useState<string>("");
  const [query, setQuery]     = useState("");
  const [tags, setTags]       = useState<Tag[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 加载 group 列表（一次）
  useEffect(() => {
    if (open && groups.length === 0) {
      getTagGroups({ pageSize: 100 })
        .then(resp => setGroups(resp.items.map(g => ({ id: g.id, slug: g.slug, name: g.name }))))
        .catch(() => {});
    }
  }, [open, groups.length]);

  // 打开时自动 focus + 重置 query
  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // 防抖搜索
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const timer = setTimeout(() => {
      searchTags({
        q: query || undefined,
        groupId: filterGroup || undefined,
        pageSize: 50,
      })
        .then(resp => setTags(resp.items))
        .catch(() => setTags([]))
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(timer);
  }, [query, filterGroup, open]);

  // 按 group 分组展示
  const grouped = useMemo(() => {
    const m = new Map<string, { groupName: string; groupSlug: string; items: Tag[] }>();
    for (const t of tags) {
      const gName = (t as Tag & { group?: { name: string; slug: string } }).group?.name ?? "?";
      const gSlug = (t as Tag & { group?: { name: string; slug: string } }).group?.slug ?? "?";
      if (!m.has(t.groupId)) m.set(t.groupId, { groupName: gName, groupSlug: gSlug, items: [] });
      m.get(t.groupId)!.items.push(t);
    }
    return Array.from(m.values());
  }, [tags]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-bg/80 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="w-[640px] max-h-[70vh] flex flex-col rounded-xl border border-edge bg-card shadow-2xl overflow-hidden"
      >
        {/* 头 */}
        <div className="px-4 py-3 border-b border-edge flex items-center gap-3">
          {mode === "descendantOf" ? (
            <GitBranch className="size-4 text-ink-sub" />
          ) : (
            <TagIcon className="size-4 text-ink-sub" />
          )}
          <span className="text-base font-medium text-ink">
            {mode === "descendantOf" ? t("pickerSelectDescendant") : t("pickerSelectTag")}
          </span>
          <button onClick={onClose} className="ml-auto text-ink-sub hover:text-ink">
            <X className="size-4" />
          </button>
        </div>

        {/* 搜索 + group 过滤 */}
        <div className="px-4 py-3 border-b border-edge flex items-center gap-2">
          <Search className="size-4 text-ink-sub shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t("pickerSearchPlaceholder")}
            className="flex-1 bg-transparent text-base text-ink placeholder:text-ink-faint outline-none"
          />
          <select
            value={filterGroup}
            onChange={e => setFilterGroup(e.target.value)}
            className="px-2 py-1 rounded-md border border-edge bg-input text-sm text-ink"
          >
            <option value="">{t("pickerAllGroups")}</option>
            {groups.map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>

        {/* 标签列表 */}
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="p-6 text-center text-sm text-ink-sub">{tc("loading")}</div>
          )}
          {!loading && tags.length === 0 && (
            <div className="p-10 text-center text-sm text-ink-sub">{t("pickerNoMatch")}</div>
          )}
          {!loading && grouped.map(g => (
            <div key={g.groupSlug} className="border-b border-edge/40 last:border-b-0">
              <div className="sticky top-0 z-10 bg-row-head px-4 py-1.5 text-xs font-medium text-ink-sub">
                {g.groupName}
              </div>
              {g.items.map(tag => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => {
                    onPick({
                      tagId: tag.id,
                      tagName: tag.name,
                      groupName: g.groupName,
                      groupSlug: g.groupSlug,
                    });
                    onClose();
                  }}
                  className="w-full text-left px-4 py-2 flex items-baseline gap-3 hover:bg-row-hover transition-colors"
                >
                  {/* hierarchy 缩进 */}
                  <span style={{ paddingLeft: `${tag.depth * 12}px` }} className="text-ink">
                    {tag.name}
                  </span>
                  <span className="text-xs text-ink-faint font-mono">{tag.slug}</span>
                  {mode === "descendantOf" && (tag.childCount ?? 0) > 0 && (
                    <span className="ml-auto text-xs text-ok">{t("pickerChildCount", { count: tag.childCount ?? 0 })}</span>
                  )}
                  {mode === "tag" && (tag._count?.entityTags ?? 0) > 0 && (
                    <span className="ml-auto text-xs text-ink-faint">{t("pickerEntityCount", { count: tag._count!.entityTags })}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* 底部提示 */}
        <div className="px-4 py-2 border-t border-edge text-xs text-ink-faint">
          {t("pickerEsc")} ·{" "}
          {mode === "descendantOf"
            ? t("pickerFooterDescendant")
            : t("pickerFooterTag")}
        </div>
      </div>
    </div>
  );
}

export type { PickedTag };

"use client";

/**
 * 全局 Cmd+K 命令面板 (#28)
 *
 * - ⌘K / Ctrl+K 唤起，Esc 关闭
 * - 三组结果：导航跳转 / 标签搜索（API，200ms debounce）/ 分组搜索（API）
 * - 操作：切换主题、拨动侧边栏（⌘B）
 */

import {
  useState, useEffect, useRef, useCallback, useDeferredValue,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  LayoutDashboard, Layers, Box, ClipboardCheck, Search,
  KeyRound, Sparkles, Tag, FolderOpen, SunMoon, PanelLeft,
  ArrowRight,
} from "lucide-react";
import { searchTags, getTagGroups, type Tag as TagType, type TagGroup } from "@/lib/api";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CommandPaletteProps {
  /** Whether the palette is visible */
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called when user requests sidebar toggle (⌘B action) */
  onToggleSidebar?: () => void;
}

// ── Static nav items ──────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: "nav-dashboard", label: "仪表盘",  icon: LayoutDashboard, href: "/" },
  { id: "nav-groups",    label: "分组管理", icon: Layers,          href: "/groups" },
  { id: "nav-entities",  label: "实体管理", icon: Box,             href: "/entities" },
  { id: "nav-search",    label: "实体检索", icon: Search,          href: "/search" },
  { id: "nav-audit",     label: "审核队列", icon: ClipboardCheck,  href: "/audit" },
  { id: "nav-llm",       label: "LLM 设置", icon: Sparkles,        href: "/settings/llm" },
  { id: "nav-tokens",    label: "API Tokens",icon: KeyRound,       href: "/settings/tokens" },
] as const;

// ── Sub-components ────────────────────────────────────────────────────────────

function CmdItem({
  onSelect,
  className,
  children,
}: {
  onSelect: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className={cn(
        "relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-ink-dim cursor-pointer transition-colors select-none",
        "data-[selected=true]:bg-tint-strong data-[selected=true]:text-ink",
        className,
      )}
    >
      {children}
    </Command.Item>
  );
}

function ItemIcon({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md bg-surface-alt border border-edge text-ink-faint">
      {children}
    </span>
  );
}

function Hint({ label }: { label: string }) {
  return (
    <kbd className="ml-auto px-1.5 py-0.5 text-2xs font-mono bg-surface-alt border border-edge text-ink-faint rounded shrink-0">
      {label}
    </kbd>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CommandPalette({ open, onOpenChange, onToggleSidebar }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [tags, setTags] = useState<TagType[]>([]);
  const [groups, setGroups] = useState<TagGroup[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state when palette opens
  useEffect(() => {
    if (open) {
      setQuery("");
      setTags([]);
      setGroups([]);
      // Pre-load groups immediately when palette opens
      getTagGroups({ pageSize: 100 })
        .then(res => setGroups(res.items))
        .catch(() => {});
      // Focus input after portal renders
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Debounced tag search
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!deferredQuery.trim()) {
      setTags([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoadingTags(true);
      try {
        const res = await searchTags({ q: deferredQuery.trim(), pageSize: 8 });
        setTags(res.items);
      } catch {
        setTags([]);
      } finally {
        setLoadingTags(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [deferredQuery, open]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const go = useCallback((href: string) => {
    close();
    router.push(href);
  }, [close, router]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, close]);

  // Filtered groups (client-side)
  const filteredGroups = deferredQuery.trim()
    ? groups.filter(g =>
        g.name.toLowerCase().includes(deferredQuery.toLowerCase()) ||
        g.slug.toLowerCase().includes(deferredQuery.toLowerCase())
      ).slice(0, 6)
    : groups.slice(0, 6);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] animate-fade-in"
      onMouseDown={e => { if (e.target === e.currentTarget) close(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />

      {/* Panel */}
      <div className="relative w-full max-w-[620px] mx-4 card-border shadow-2xl shadow-black/60 overflow-hidden animate-scale-in">
        <Command
          shouldFilter={false}
          loop
          className="flex flex-col"
        >
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 border-b border-edge">
            <Search size={14} className="text-ink-faint shrink-0" />
            <Command.Input
              ref={inputRef}
              value={query}
              onValueChange={setQuery}
              placeholder="搜索标签、分组、页面…"
              className="flex-1 py-3.5 text-sm text-ink bg-transparent placeholder:text-ink-faint focus:outline-none"
              aria-label="命令面板搜索"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="text-xs text-ink-faint hover:text-ink px-1.5 py-0.5 rounded border border-edge-mid hover:border-edge-strong transition-colors"
              >
                清空
              </button>
            )}
            <kbd className="hidden sm:flex items-center text-xs text-ink-faint border border-edge-mid rounded px-1.5 py-0.5 font-mono">
              Esc
            </kbd>
          </div>

          {/* Results */}
          <Command.List className="overflow-y-auto max-h-[420px] p-2">
            <Command.Empty className="py-12 text-center text-sm text-ink-faint">
              {loadingTags ? "搜索中…" : "无匹配结果"}
            </Command.Empty>

            {/* ── 导航 ── */}
            <Command.Group
              heading="导航"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-ink-faint [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest mb-1"
            >
              {NAV_ITEMS
                .filter(item =>
                  !query.trim() ||
                  item.label.toLowerCase().includes(query.toLowerCase())
                )
                .map(item => (
                  <CmdItem key={item.id} onSelect={() => go(item.href)}>
                    <ItemIcon><item.icon size={13} /></ItemIcon>
                    <span className="flex-1">{item.label}</span>
                    <ArrowRight size={12} className="text-ink-faint opacity-0 group-data-[selected=true]:opacity-100" />
                  </CmdItem>
                ))
              }
            </Command.Group>

            {/* ── 分组搜索 ── */}
            {filteredGroups.length > 0 && (
              <Command.Group
                heading="分组"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-ink-faint [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest mb-1"
              >
                {filteredGroups.map(group => (
                  <CmdItem key={group.id} onSelect={() => go(`/groups/${group.id}`)}>
                    <ItemIcon><FolderOpen size={13} /></ItemIcon>
                    <div className="flex-1 min-w-0">
                      <span className="block text-sm">{group.name}</span>
                      <span className="block text-xs text-ink-faint truncate">
                        {group.entityScopes.length > 0
                          ? group.entityScopes.join(" · ")
                          : "全部实体类型"
                        }
                        {" · "}
                        {group._count?.tags ?? 0} 个标签
                      </span>
                    </div>
                  </CmdItem>
                ))}
              </Command.Group>
            )}

            {/* ── 标签搜索（API，有查询词时展示）── */}
            {query.trim() && tags.length > 0 && (
              <Command.Group
                heading="标签"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-ink-faint [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest mb-1"
              >
                {tags.map(tag => (
                  <CmdItem key={tag.id} onSelect={() => go(`/groups/${tag.groupId}`)}>
                    <ItemIcon><Tag size={13} /></ItemIcon>
                    <div className="flex-1 min-w-0">
                      <span className="block text-sm">{tag.name}</span>
                      <span className="block text-xs text-ink-faint font-mono">{tag.slug}</span>
                    </div>
                    <span className="text-xs text-ink-faint shrink-0 ml-2">跳转分组</span>
                  </CmdItem>
                ))}
              </Command.Group>
            )}

            {/* ── 操作 ── */}
            {(!query.trim() || "切换主题".includes(query) || "主题".includes(query) || "侧边栏".includes(query)) && (
              <Command.Group
                heading="操作"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-ink-faint [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest"
              >
                {(!query.trim() || "切换主题".includes(query) || "主题".includes(query)) && (
                  <CmdItem
                    onSelect={() => {
                      close();
                      // Toggle theme via data-theme attribute (same logic as ThemeToggle)
                      const current = document.documentElement.getAttribute("data-theme");
                      const next = current === "light" ? "dark" : "light";
                      document.documentElement.setAttribute("data-theme", next);
                      try { localStorage.setItem("taxon-theme", next); } catch {}
                    }}
                  >
                    <ItemIcon><SunMoon size={13} /></ItemIcon>
                    <span className="flex-1">切换主题</span>
                    <Hint label="light / dark" />
                  </CmdItem>
                )}
                {(!query.trim() || "侧边栏".includes(query) || "sidebar".includes(query.toLowerCase())) && (
                  <CmdItem
                    onSelect={() => {
                      close();
                      onToggleSidebar?.();
                    }}
                  >
                    <ItemIcon><PanelLeft size={13} /></ItemIcon>
                    <span className="flex-1">切换侧边栏</span>
                    <Hint label="⌘B" />
                  </CmdItem>
                )}
              </Command.Group>
            )}
          </Command.List>

          {/* Footer hint */}
          <div className="px-4 py-2 border-t border-edge flex items-center gap-4 text-2xs text-ink-faint">
            <span className="flex items-center gap-1">
              <kbd className="px-1 border border-edge rounded font-mono">↑↓</kbd> 导航
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 border border-edge rounded font-mono">↵</kbd> 确认
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 border border-edge rounded font-mono">Esc</kbd> 关闭
            </span>
            <span className="ml-auto flex items-center gap-1">
              <kbd className="px-1 border border-edge rounded font-mono">⌘K</kbd> 再次唤起
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
}

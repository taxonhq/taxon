"use client";

/**
 * 全局 Cmd+K 命令面板 (#28)
 *
 * - ⌘K / Ctrl+K 唤起，Esc 关闭
 * - 三组结果：导航跳转 / 标签搜索（API，200ms debounce）/ 分组搜索（API）
 * - 操作：切换主题
 */

import {
  useState, useEffect, useRef, useCallback, useDeferredValue,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Command } from "cmdk";
import {
  LayoutDashboard, Layers, Box, ClipboardCheck, Search,
  KeyRound, Sparkles, Tag, FolderOpen, SunMoon,
  ArrowRight, ShieldCheck,
} from "lucide-react";
import { searchTags, getTagGroups, type Tag as TagType, type TagGroup } from "@/lib/api";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CommandPaletteProps {
  /** Whether the palette is visible */
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

// ── Static nav items (labels resolved at render time via useTranslations) ─────

const NAV_ITEM_DEFS = [
  { id: "nav-dashboard",  navKey: "dashboard",    icon: LayoutDashboard, href: "/" },
  { id: "nav-groups",     navKey: "groups",       icon: Layers,          href: "/groups" },
  { id: "nav-entities",   navKey: "entities",     icon: Box,             href: "/entities" },
  { id: "nav-search",     navKey: "search",       icon: Search,          href: "/search" },
  { id: "nav-audit",      navKey: "audit",        icon: ClipboardCheck,  href: "/audit" },
  { id: "nav-governance", navKey: "governance",   icon: ShieldCheck,     href: "/governance" },
  { id: "nav-llm",        navKey: "llmSettings",  icon: Sparkles,        href: "/settings/llm" },
  { id: "nav-tokens",     navKey: null,           icon: KeyRound,        href: "/settings/tokens", label: "API Tokens" },
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

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const t = useTranslations("palette");
  const tNav = useTranslations("nav");
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
              placeholder={t("searchPlaceholder")}
              className="flex-1 py-3.5 text-sm text-ink bg-transparent placeholder:text-ink-faint focus:outline-none"
              aria-label={t("searchAriaLabel")}
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="text-xs text-ink-faint hover:text-ink px-1.5 py-0.5 rounded border border-edge-mid hover:border-edge-strong transition-colors"
              >
                {t("clear")}
              </button>
            )}
            <kbd className="hidden sm:flex items-center text-xs text-ink-faint border border-edge-mid rounded px-1.5 py-0.5 font-mono">
              Esc
            </kbd>
          </div>

          {/* Results */}
          <Command.List className="overflow-y-auto max-h-[420px] p-2">
            <Command.Empty className="py-12 text-center text-sm text-ink-faint">
              {loadingTags ? t("searching") : t("noResults")}
            </Command.Empty>

            {/* ── Navigation ── */}
            <Command.Group
              heading={t("navHeading")}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-ink-faint [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest mb-1"
            >
              {NAV_ITEM_DEFS
                .map(item => ({ ...item, label: item.navKey ? tNav(item.navKey as Parameters<typeof tNav>[0]) : item.label }))
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

            {/* ── Groups search ── */}
            {filteredGroups.length > 0 && (
              <Command.Group
                heading={t("groupsHeading")}
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
                          : t("allEntityTypes")
                        }
                        {" · "}
                        {t("tagCount", { count: group._count?.tags ?? 0 })}
                      </span>
                    </div>
                  </CmdItem>
                ))}
              </Command.Group>
            )}

            {/* ── Tag search (API, shown when query is set) ── */}
            {query.trim() && tags.length > 0 && (
              <Command.Group
                heading={t("tagsHeading")}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-ink-faint [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest mb-1"
              >
                {tags.map(tag => (
                  <CmdItem key={tag.id} onSelect={() => go(`/groups/${tag.groupId}`)}>
                    <ItemIcon><Tag size={13} /></ItemIcon>
                    <div className="flex-1 min-w-0">
                      <span className="block text-sm">{tag.name}</span>
                      <span className="block text-xs text-ink-faint font-mono">{tag.slug}</span>
                    </div>
                    <span className="text-xs text-ink-faint shrink-0 ml-2">{t("jumpToGroup")}</span>
                  </CmdItem>
                ))}
              </Command.Group>
            )}

            {/* ── Actions ── */}
            {(!query.trim() || t("toggleTheme").toLowerCase().includes(query.toLowerCase())) && (
              <Command.Group
                heading={t("actionsHeading")}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-ink-faint [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest"
              >
                {(!query.trim() || t("toggleTheme").toLowerCase().includes(query.toLowerCase())) && (
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
                    <span className="flex-1">{t("toggleTheme")}</span>
                    <Hint label="light / dark" />
                  </CmdItem>
                )}
              </Command.Group>
            )}
          </Command.List>

          {/* Footer hint */}
          <div className="px-4 py-2 border-t border-edge flex items-center gap-4 text-2xs text-ink-faint">
            <span className="flex items-center gap-1">
              <kbd className="px-1 border border-edge rounded font-mono">↑↓</kbd> {t("footerNav")}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 border border-edge rounded font-mono">↵</kbd> {t("footerConfirm")}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 border border-edge rounded font-mono">Esc</kbd> {t("footerClose")}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <kbd className="px-1 border border-edge rounded font-mono">⌘K</kbd> {t("footerOpen")}
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
}

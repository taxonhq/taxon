"use client";

/**
 * 审核队列页面
 *
 * 功能：
 *   - 键盘快捷键（J/K 导航，A 通过，R 拒绝，Enter 带备注，Shift+A 全部通过，
 *     X 选中，Shift+X 全选，/ 聚焦筛选，? 显示说明，⌘Z 撤销）
 *   - 快速操作：A/R 直接审核，无需备注弹窗
 *   - 服务端 5 秒撤销：A/R 立即提交并返回 reviewId；5s 内可 ⌘Z 调用
 *     POST /audit/undo 回滚，超时后 batch 清空（已提交状态保留）
 *   - 行 flash 动效：通过→绿，拒绝→红
 *   - 聚焦行左侧蓝色高亮条
 *   - 置信度区间过滤（issue #9）
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { CheckCircle, XCircle, Trash2, RefreshCw, ClipboardCheck, Keyboard, Trophy } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  getAuditItems, updateEntityTagStatus, undoReviews, removeEntityTag, getEntityTypes,
  getReviewerStats, getLeaderboard,
  type AuditItem, type ReviewerStats, type LeaderboardItem,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/field";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const PAGE_SIZE_DEFAULT = 30;

type StatusFilter = "pending" | "active" | "rejected";

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function itemKey(item: AuditItem) {
  return `${item.tagId}:${item.entityType}:${item.entityId}`;
}

// ── 审核操作弹窗（含备注） ────────────────────────────────────────────────────
function ReviewDialog({
  item, action, onConfirm, onCancel,
}: {
  item: AuditItem;
  action: "active" | "rejected";
  onConfirm: (note: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("audit");
  const tCommon = useTranslations("common");
  const [note, setNote] = useState("");
  const isApprove = action === "active";
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => textareaRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Dialog open onClose={onCancel} title={isApprove ? t("approveConfirm") : t("rejectConfirm")} size="md" showClose={false}>
      <p className="text-xs text-ink-sub -mt-1 mb-4">
        {t("colTag")}: <span className="font-medium text-ink">{item.tag.name}</span> ({item.tag.group.name})
        &nbsp;·&nbsp;{item.entityType}/{item.entityId}
      </p>
      <div className="mb-4">
        <label htmlFor="review-note" className="block text-xs text-ink-sub mb-1">
          {t("noteLabel")} <span className="text-ink-faint">({t("noteOptional")})</span>
        </label>
        <textarea
          id="review-note"
          ref={textareaRef}
          className="w-full border border-edge-mid rounded-lg px-3 py-2 text-sm text-ink bg-input focus:outline-none focus:border-edge-strong focus:ring-2 focus:ring-brand-1/30 resize-none"
          rows={3}
          placeholder={isApprove ? t("noteApprove") : t("noteReject")}
          value={note}
          onChange={e => setNote(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onConfirm(note.trim());
            }
          }}
        />
        <p className="text-2xs text-ink-faint mt-1">{t("noteHint")}</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>{tCommon("cancel")}</Button>
        <Button variant={isApprove ? "primary" : "danger"} onClick={() => onConfirm(note.trim())}>
          {isApprove ? t("approveConfirm") : t("rejectConfirm")}
        </Button>
      </div>
    </Dialog>
  );
}

// ── 审核员榜单弹窗 ─────────────────────────────────────────────────────────────
function LeaderboardDialog({
  items,
  period,
  onPeriodChange,
  onClose,
}: {
  items: LeaderboardItem[] | null;
  period: "7d" | "30d" | "all";
  onPeriodChange: (p: "7d" | "30d" | "all") => void;
  onClose: () => void;
}) {
  const t = useTranslations("audit");

  const PERIODS: { value: "7d" | "30d" | "all"; label: string }[] = [
    { value: "7d",  label: t("period7d") },
    { value: "30d", label: t("period30d") },
    { value: "all", label: t("periodAll") },
  ];

  return (
    <Dialog open onClose={onClose} title={t("leaderboard")} size="md">
      {/* Period selector */}
      <div className="flex items-center gap-1 mb-4 p-0.5 bg-surface-alt border border-edge rounded-lg w-fit">
        {PERIODS.map(p => (
          <button
            key={p.value}
            onClick={() => onPeriodChange(p.value)}
            className={`px-3 py-1 text-xs rounded-md transition-all ${
              period === p.value
                ? "bg-overlay text-ink font-medium shadow-sm border border-edge-mid"
                : "text-ink-dim hover:text-ink"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {items === null ? (
        <div className="space-y-2">
          {[1,2,3].map(i => (
            <div key={i} className="h-10 bg-surface-alt rounded-lg animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-center text-sm text-ink-faint py-8">{t("leaderboardNoData")}</p>
      ) : (
        <div className="space-y-1">
          {items.map((item, idx) => (
            <div
              key={item.reviewerId ?? "anon"}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg ${
                item.isCurrentUser ? "bg-brand-1/8 border border-brand-1/20" : "hover:bg-row-hover"
              }`}
            >
              {/* Rank */}
              <span className={`w-5 text-center text-xs font-bold shrink-0 ${
                idx === 0 ? "text-amber" : idx === 1 ? "text-ink-sub" : idx === 2 ? "text-amber/60" : "text-ink-faint"
              }`}>
                {idx + 1}
              </span>
              {/* Name */}
              <span className={`flex-1 text-sm min-w-0 truncate ${item.isCurrentUser ? "font-semibold text-brand-1" : "text-ink"}`}>
                {item.name}
                {item.isCurrentUser && <span className="ml-1.5 text-2xs text-brand-1/70">{t("leaderboardMe")}</span>}
              </span>
              {/* Stats */}
              <div className="flex items-center gap-3 shrink-0 text-xs tabular-nums">
                <span className="text-ok">{item.approved} ✓</span>
                <span className="text-bad">{item.rejected} ✗</span>
                <span className="text-ink-sub w-10 text-right">
                  {item.approveRate !== null ? `${Math.round(item.approveRate * 100)}%` : "—"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-2xs text-ink-faint">{t("leaderboardNote")}</p>
    </Dialog>
  );
}

// ── 键盘快捷键说明面板 ─────────────────────────────────────────────────────────
function CheatsheetDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("audit");

  const shortcuts = [
    { key: "J / ↓",  desc: t("shortcutNavDown") },
    { key: "K / ↑",  desc: t("shortcutNavUp") },
    { key: "A",       desc: t("shortcutApprove") },
    { key: "R",       desc: t("shortcutReject") },
    { key: "Enter",   desc: t("shortcutNote") },
    { key: "Shift+A", desc: t("shortcutBulkApprove") },
    { key: "X",       desc: t("shortcutToggle") },
    { key: "Shift+X", desc: t("shortcutToggleAll") },
    { key: "/",       desc: t("shortcutFocusFilter") },
    { key: "⌘Z",     desc: t("shortcutUndo") },
    { key: "?",       desc: t("shortcutHelp") },
  ];

  return (
    <Dialog open onClose={onClose} title={t("shortcuts")} size="sm">
      <div className="space-y-0.5">
        {shortcuts.map(({ key, desc }) => (
          <div key={key} className="flex items-center justify-between py-1.5 border-b border-edge last:border-0">
            <span className="text-xs text-ink-sub">{desc}</span>
            <kbd className="px-2 py-0.5 text-xs font-mono bg-surface-alt border border-edge-mid rounded text-ink-dim shrink-0 ml-4">
              {key}
            </kbd>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

// ── 主页面 ─────────────────────────────────────────────────────────────────────
type UndoEntry = { key: string; reviewId: string };

export default function AuditPage() {
  const t = useTranslations("audit");
  const tCommon = useTranslations("common");

  const [items, setItems] = useState<AuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>("");
  const [minConfidence, setMinConfidence] = useState("");
  const [maxConfidence, setMaxConfidence] = useState("");
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const [confirmItem, setConfirmItem] = useState<AuditItem | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{ item: AuditItem; action: "active" | "rejected" } | null>(null);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [showCheatsheet, setShowCheatsheet] = useState(false);
  // flash: key → "ok" | "bad" (shows flash animation class on row)
  const [flashItems, setFlashItems] = useState<Map<string, "ok" | "bad">>(new Map());
  // undo banner
  const [undoBannerCount, setUndoBannerCount] = useState(0);
  const [sessionReviewed, setSessionReviewed] = useState(0);
  // reviewer stats (today)
  const [todayStats, setTodayStats] = useState<ReviewerStats | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardItem[] | null>(null);
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<"7d" | "30d" | "all">("7d");

  // Undo mechanism — all via refs to avoid stale closure issues in timer
  const undoBatchRef = useRef<UndoEntry[]>([]);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitUndoFnRef = useRef<() => void>(() => {});
  const quickActionRef  = useRef<(item: AuditItem, newStatus: "active" | "rejected", origIdx: number) => void>(() => {});
  const handleUndoRef   = useRef<() => void | Promise<void>>(() => {});
  // Stable snapshot for the (once-registered) keyboard handler — updated in useEffect below
  const stateRef = useRef<{ items: AuditItem[]; focusedIdx: number; loading: boolean; anyModalOpen: boolean }>({
    items: [], focusedIdx: -1, loading: true, anyModalOpen: false,
  });

  // DOM refs
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const filterSelectRef = useRef<HTMLSelectElement>(null);

  const statusMeta = useCallback((status: string) => {
    const map: Record<string, { label: string; dot: string; text: string }> = {
      pending:  { label: t("statusPending"),  dot: "bg-warn",   text: "text-warn" },
      active:   { label: t("statusActive"),   dot: "bg-ok",     text: "text-ok" },
      rejected: { label: t("statusRejected"), dot: "bg-bad/70", text: "text-bad" },
    };
    return map[status] ?? { label: status, dot: "bg-edge-mid", text: "text-ink-dim" };
  }, [t]);

  const sourceLabel = useCallback((source: string) => {
    const map: Record<string, string> = {
      ai:     t("sourceAi"),
      manual: t("sourceManual"),
      system: t("sourceSystem"),
      import: t("sourceImport"),
    };
    return map[source] ?? source;
  }, [t]);

  useEffect(() => {
    getEntityTypes()
      .then(types => setEntityTypes(types.map(et => et.entityType)))
      .catch(() => {});
  }, []);

  const loadTodayStats = useCallback(() => {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    getReviewerStats({ from: todayStart.toISOString() })
      .then(s => setTodayStats(s))
      .catch(() => {}); // non-critical — silently skip if no auth token configured
  }, []);

  // Load today's stats on mount; refresh whenever the undo banner clears (review committed)
  useEffect(() => { loadTodayStats(); }, [loadTodayStats]);
  useEffect(() => {
    if (undoBannerCount === 0 && sessionReviewed > 0) loadTodayStats();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoBannerCount]);

  const load = useCallback(async (pageNum = 1, ps?: number) => {
    setLoading(true);
    setError("");
    setSelected(new Set());
    setFocusedIdx(-1);
    try {
      const data = await getAuditItems({
        status: statusFilter,
        entityType: entityTypeFilter || undefined,
        minConfidence: minConfidence ? parseFloat(minConfidence) : undefined,
        maxConfidence: maxConfidence ? parseFloat(maxConfidence) : undefined,
        page: pageNum,
        pageSize: ps ?? pageSize,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? tCommon("loadErrorMsg", { message: err.message }) : tCommon("loadError"));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, entityTypeFilter, minConfidence, maxConfidence, pageSize, tCommon]);

  useEffect(() => {
    setPage(1);
    load(1);
  }, [load]);

  // Scroll focused row into view
  useEffect(() => {
    if (focusedIdx < 0) return;
    const key = items[focusedIdx] ? itemKey(items[focusedIdx]) : null;
    if (!key) return;
    rowRefs.current.get(key)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedIdx, items]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const setProcessingKey = (key: string, active: boolean) =>
    setProcessing(prev => {
      const next = new Set(prev);
      if (active) next.add(key); else next.delete(key);
      return next;
    });

  const removeItemFromUI = useCallback((key: string) => {
    setItems(prev => prev.filter(i => itemKey(i) !== key));
    setTotal(prev => prev - 1);
    setSelected(prev => { const n = new Set(prev); n.delete(key); return n; });
  }, []);

  const toggleAll = useCallback(() =>
    setItems(currentItems => {
      setSelected(prev => {
        const allKeys = currentItems.map(itemKey);
        const allSel = allKeys.every(k => prev.has(k));
        return allSel ? new Set() : new Set(allKeys);
      });
      return currentItems;
    }),
  []);

  const toggleOne = useCallback((key: string) =>
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    }),
  []);

  // ── Sync mutable refs after every render (ESLint: no ref writes during render)
  useEffect(() => {
    stateRef.current = {
      items,
      focusedIdx,
      loading,
      anyModalOpen: !!(reviewTarget || confirmItem || showBulkConfirm || showCheatsheet || showLeaderboard),
    };

    commitUndoFnRef.current = () => {
      // 5秒窗口过期：仅清空 batch，API 已在 quickAction 时立即提交
      undoBatchRef.current = [];
      undoTimerRef.current = null;
      setUndoBannerCount(0);
    };

    quickActionRef.current = (item: AuditItem, newStatus: "active" | "rejected", origIdx: number) => {
      const key = itemKey(item);
      // Show flash animation; clear it after 300ms but keep item in list until API confirms
      setFlashItems(prev => new Map(prev).set(key, newStatus === "active" ? "ok" : "bad"));
      setTimeout(() => {
        setFlashItems(prev => { const m = new Map(prev); m.delete(key); return m; });
      }, 300);

      // 立即提交，拿回 reviewId 用于服务端撤销；只有成功后才从 UI 移除
      updateEntityTagStatus(item.entityType, item.entityId, item.tagId, newStatus)
        .then(({ reviewId }) => {
          removeItemFromUI(key);
          setFocusedIdx(prev => {
            if (prev < 0) return -1;
            return prev > origIdx ? prev - 1 : Math.min(prev, stateRef.current.items.length - 2);
          });
          undoBatchRef.current = [...undoBatchRef.current, { key, reviewId }];
          if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
          undoTimerRef.current = setTimeout(() => commitUndoFnRef.current(), 5000);
          setUndoBannerCount(undoBatchRef.current.length);
          setSessionReviewed(prev => prev + 1);
        })
        .catch(() => setError(t("submitFailed")));
    };

    handleUndoRef.current = async () => {
      const batch = undoBatchRef.current;
      if (batch.length === 0) return;
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
      undoBatchRef.current = [];
      setUndoBannerCount(0);
      try {
        const { reverted } = await undoReviews(batch.map(e => e.reviewId));
        setSessionReviewed(prev => Math.max(0, prev - reverted));
      } catch {
        setError(t("undoFailed"));
      }
      load(page);
    };
  }); // intentionally no deps — updates refs after every render

  // ── Standard status change (with review dialog note) ──────────────────────
  const handleStatusChange = async (item: AuditItem, newStatus: "active" | "rejected", note?: string) => {
    const key = itemKey(item);
    setProcessingKey(key, true);
    try {
      await updateEntityTagStatus(item.entityType, item.entityId, item.tagId, newStatus, note);
      removeItemFromUI(key);
      setSessionReviewed(prev => prev + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon("operationFailed"));
    } finally {
      setProcessingKey(key, false);
    }
  };

  const handleReviewConfirm = async (note: string) => {
    if (!reviewTarget) return;
    const { item, action } = reviewTarget;
    setReviewTarget(null);
    await handleStatusChange(item, action, note || undefined);
  };

  const handleRemove = async (item: AuditItem) => {
    setConfirmItem(null);
    const key = itemKey(item);
    setProcessingKey(key, true);
    try {
      await removeEntityTag(item.entityType, item.entityId, item.tagId);
      removeItemFromUI(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("deleteFailed"));
    } finally {
      setProcessingKey(key, false);
    }
  };

  // Bulk status change (from bulk bar or Shift+A confirm)
  const handleBulkStatus = async (newStatus: "active" | "rejected", targets?: AuditItem[]) => {
    const list = targets ?? items.filter(i => selected.has(itemKey(i)));
    if (list.length === 0) return;
    setError("");
    const results = await Promise.allSettled(
      list.map(item =>
        updateEntityTagStatus(item.entityType, item.entityId, item.tagId, newStatus)
          .then(() => itemKey(item))
      )
    );
    const succeeded = results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
      .map(r => r.value);
    succeeded.forEach(key => removeItemFromUI(key));
    setSessionReviewed(prev => prev + succeeded.length);
    const failed = results.filter(r => r.status === "rejected").length;
    if (failed > 0) setError(t("bulkFailed", { count: failed }));
  };

  const allKeys = items.map(itemKey);
  const allSelected = allKeys.length > 0 && allKeys.every(k => selected.has(k));
  const someSelected = selected.size > 0 && !allSelected;
  const selectedItems = items.filter(i => selected.has(itemKey(i)));

  const headerCheckboxRef = (el: HTMLInputElement | null) => {
    if (el) el.indeterminate = someSelected;
  };

  // ── Keyboard handler (registered once, reads live state via stateRef) ──────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const { items: currentItems, focusedIdx: fi, loading: isLoading, anyModalOpen } = stateRef.current;

      // Ignore if typing in input/select/textarea
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      // Ignore if any modal is open
      if (anyModalOpen) return;
      // Ignore while loading
      if (isLoading) return;

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setFocusedIdx(prev => {
            if (prev < 0) return currentItems.length > 0 ? 0 : -1;
            return Math.min(prev + 1, currentItems.length - 1);
          });
          break;

        case "k":
        case "ArrowUp":
          e.preventDefault();
          setFocusedIdx(prev => {
            if (prev < 0) return currentItems.length > 0 ? 0 : -1;
            return Math.max(prev - 1, 0);
          });
          break;

        case "a": // quick approve (no shift)
          if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            if (fi >= 0 && fi < currentItems.length) {
              const item = currentItems[fi];
              if (item.status !== "active") quickActionRef.current(item, "active", fi);
            }
          }
          break;

        case "A": // Shift+A → bulk approve with confirm
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            setShowBulkConfirm(true);
          }
          break;

        case "r": // quick reject
          if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            if (fi >= 0 && fi < currentItems.length) {
              const item = currentItems[fi];
              if (item.status !== "rejected") quickActionRef.current(item, "rejected", fi);
            }
          }
          break;

        case "x": // toggle focused row checkbox
          if (!e.shiftKey) {
            e.preventDefault();
            if (fi >= 0 && fi < currentItems.length) {
              toggleOne(itemKey(currentItems[fi]));
            }
          }
          break;

        case "X": // Shift+X → toggle all
          e.preventDefault();
          toggleAll();
          break;

        case "/":
          e.preventDefault();
          filterSelectRef.current?.focus();
          break;

        case "?":
          e.preventDefault();
          setShowCheatsheet(true);
          break;

        case "Enter":
          e.preventDefault();
          if (fi >= 0 && fi < currentItems.length) {
            setReviewTarget({ item: currentItems[fi], action: "active" });
          }
          break;

        case "z":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            handleUndoRef.current();
          }
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // registered once; reads mutable stateRef for live values

  // Load leaderboard whenever the panel opens or the period changes
  useEffect(() => {
    if (!showLeaderboard) return;
    setLeaderboard(null);
    getLeaderboard({ period: leaderboardPeriod, limit: 10 })
      .then(r => setLeaderboard(r.items))
      .catch(() => setLeaderboard([]));
  }, [showLeaderboard, leaderboardPeriod]);

  const showReviewCols = statusFilter !== "pending";

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        hint={t("description")}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowLeaderboard(true)}
              className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors"
              title={t("leaderboard")}
              aria-label={t("leaderboard")}
            >
              <Trophy size={15} />
            </button>
            <button
              onClick={() => setShowCheatsheet(true)}
              className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors"
              title={`${t("shortcuts")} (?)`}
              aria-label={t("shortcuts")}
            >
              <Keyboard size={15} />
            </button>
            <Button variant="outline" size="sm" onClick={() => load(page)}>
              <RefreshCw size={13} />
              {tCommon("refresh")}
            </Button>
          </div>
        }
      />

      {/* ── Today Stats bar ── */}
      {todayStats !== null && (
        <div className="flex items-center gap-3 animate-fade-in">
          <span className="text-2xs font-semibold text-ink-faint uppercase tracking-[0.12em] shrink-0">{t("todaySection")}</span>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-ok/10 border border-ok/20 text-xs font-semibold tabular-nums text-ok">
              <CheckCircle size={11} strokeWidth={2.5} />
              {todayStats.approved}
              <span className="font-normal opacity-80">{t("todayApproved")}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-bad/10 border border-bad/20 text-xs font-semibold tabular-nums text-bad">
              <XCircle size={11} strokeWidth={2.5} />
              {todayStats.rejected}
              <span className="font-normal opacity-80">{t("todayRejected")}</span>
            </div>
            {(todayStats.approved + todayStats.rejected) > 0 && (
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-alt border border-edge text-xs tabular-nums text-ink-sub">
                {t("todayApproveRate")}
                <span className="font-semibold text-ink">{Math.round((todayStats.approveRate ?? 0) * 100)}%</span>
              </div>
            )}
          </div>
          {sessionReviewed > 0 && (
            <span className="ml-auto text-2xs tabular-nums text-ink-faint">{t("sessionCount", { count: sessionReviewed })}</span>
          )}
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status tabs */}
        <div className="flex items-center p-0.5 bg-surface-alt border border-edge rounded-lg gap-px">
          {(["pending", "active", "rejected"] as StatusFilter[]).map(s => {
            const meta = statusMeta(s);
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-all ${
                  statusFilter === s
                    ? "bg-overlay text-ink font-medium shadow-sm border border-edge-mid"
                    : "text-ink-dim hover:text-ink"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                {meta.label}
              </button>
            );
          })}
        </div>

        {/* Entity type filter */}
        <Select
          ref={filterSelectRef}
          value={entityTypeFilter}
          onChange={e => setEntityTypeFilter(e.target.value)}
          className="!w-36 !text-xs !py-1.5"
        >
          <option value="">{t("filterEntityType")}</option>
          {entityTypes.map(et => <option key={et} value={et}>{et}</option>)}
        </Select>

        {/* Confidence range filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-ink-faint whitespace-nowrap">{t("confidenceRange")}</span>
          <input
            type="number"
            min={0} max={1} step={0.01}
            placeholder="0.00"
            value={minConfidence}
            onChange={e => setMinConfidence(e.target.value)}
            className="w-16 text-xs px-2 py-1.5 bg-input border border-edge-mid rounded-lg text-ink focus:outline-none focus:border-edge-strong focus:ring-2 focus:ring-brand-1/30 tabular-nums"
          />
          <span className="text-xs text-ink-faint">—</span>
          <input
            type="number"
            min={0} max={1} step={0.01}
            placeholder="1.00"
            value={maxConfidence}
            onChange={e => setMaxConfidence(e.target.value)}
            className="w-16 text-xs px-2 py-1.5 bg-input border border-edge-mid rounded-lg text-ink focus:outline-none focus:border-edge-strong focus:ring-2 focus:ring-brand-1/30 tabular-nums"
          />
        </div>

        <span className="ml-auto text-xs text-ink-faint tabular-nums">{tCommon("total", { count: total })}</span>
      </div>

      {/* ── Bulk action bar ── */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-surface-alt border border-edge-mid rounded-lg">
          <span className="text-xs text-ink-dim tabular-nums">
            {tCommon("selected", { count: selected.size })}
          </span>
          <div className="flex gap-2 ml-auto">
            {statusFilter !== "active" && (
              <Button size="sm" variant="ok" onClick={() => handleBulkStatus("active")}>
                <CheckCircle size={12} />
                {t("approveAll")}
              </Button>
            )}
            {statusFilter !== "rejected" && (
              <Button size="sm" variant="danger" onClick={() => handleBulkStatus("rejected")}>
                <XCircle size={12} />
                {t("rejectAll")}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{tCommon("cancel")}</Button>
          </div>
        </div>
      )}

      <ErrorBanner message={error} />

      {/* ── Table / empty state ── */}
      {loading ? (
        <div className="card-border overflow-hidden animate-pulse">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-edge last:border-0">
              <div className="w-4 h-4 bg-edge-mid rounded" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-32 bg-edge-mid rounded" />
                <div className="h-3 w-20 bg-edge rounded" />
              </div>
              <div className="h-3 w-16 bg-edge rounded" />
              <div className="h-3 w-10 bg-edge rounded" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card-border overflow-hidden animate-fade-in">
          <div className="py-28 flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-surface-alt to-surface border border-edge-mid flex items-center justify-center mb-5 shadow-md">
              <ClipboardCheck size={22} className="text-ink-faint" strokeWidth={1.5} />
            </div>
            <p className="text-md font-semibold text-ink-sub">
              {statusFilter === "pending" ? t("emptyPending") : t("emptyOther")}
            </p>
            {statusFilter === "pending" && (
              <p className="text-sm text-ink-faint mt-1.5 max-w-[200px] leading-relaxed">
                {t("emptyPendingDesc")}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="card-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-edge bg-row-head">
                <th className="pl-5 pr-3 py-3">
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="accent-ink w-3.5 h-3.5"
                    aria-label={tCommon("all")}
                  />
                </th>
                {[
                  t("colTag"), t("colEntity"), t("colSource"), t("colConfidence"), t("colStatus"),
                  ...(showReviewCols ? [t("colReviewer"), t("colNote")] : []),
                  t("colTime"), "",
                ].map((h, i, arr) => (
                  <th key={i} className={`py-3 th-label ${i === arr.length - 1 ? "pr-5 text-right" : "px-3 text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {items.map((item, idx) => {
                const key = itemKey(item);
                const busy = processing.has(key);
                const isSelected = selected.has(key);
                const isFocused = focusedIdx === idx;
                const flash = flashItems.get(key);
                const meta = statusMeta(item.status);

                return (
                  <tr
                    key={key}
                    ref={el => { if (el) rowRefs.current.set(key, el); else rowRefs.current.delete(key); }}
                    onClick={() => setFocusedIdx(idx)}
                    className={[
                      "group/row cursor-default select-none",
                      busy ? "opacity-40 pointer-events-none" : "",
                      flash === "ok"  ? "animate-flash-ok"  :
                      flash === "bad" ? "animate-flash-bad" :
                      isSelected ? "bg-overlay" : "hover:bg-row-hover",
                    ].filter(Boolean).join(" ")}
                    style={{
                      // Inset left shadow as focused indicator (reliable across browsers for <tr>)
                      boxShadow: isFocused ? "inset 3px 0 0 var(--color-brand-1)" : undefined,
                    }}
                  >
                    <td className="pl-5 pr-3 py-3" onClick={e => { e.stopPropagation(); toggleOne(key); }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(key)}
                        className="accent-ink w-3.5 h-3.5"
                        aria-label={item.tag.name}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-base font-semibold text-ink">{item.tag.name}</p>
                      <p className="text-xs text-ink-sub mt-0.5">{item.tag.group.name}</p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-xs font-mono text-ink-dim">{item.entityType}</p>
                      <p className="text-2xs font-mono text-ink-sub mt-0.5 max-w-[120px] truncate">{item.entityId}</p>
                    </td>
                    <td className="px-3 py-3 text-sm text-ink-dim">
                      {sourceLabel(item.source)}
                    </td>
                    <td className="px-3 py-3">
                      {item.confidence != null ? (
                        <span className={`text-sm font-medium tabular-nums ${
                          item.confidence >= 0.8 ? "text-ok" :
                          item.confidence >= 0.5 ? "text-warn" : "text-bad"
                        }`}>
                          {Math.round(item.confidence * 100)}%
                        </span>
                      ) : (
                        <span className="text-sm text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${meta.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
                        {meta.label}
                      </span>
                    </td>
                    {showReviewCols && (
                      <>
                        <td className="px-3 py-3 text-xs text-ink-sub max-w-[100px] truncate">
                          {item.reviewerName ?? <span className="text-ink-faint">—</span>}
                        </td>
                        <td className="px-3 py-3 max-w-[160px]">
                          {item.reviewNote ? (
                            <span className="text-xs text-ink-sub truncate block" title={item.reviewNote}>
                              {item.reviewNote}
                            </span>
                          ) : (
                            <span className="text-xs text-ink-faint">—</span>
                          )}
                        </td>
                      </>
                    )}
                    <td className="px-3 py-3 text-xs text-ink-sub tabular-nums">
                      {formatTime(item.taggedAt)}
                    </td>
                    <td className="pr-4 py-3">
                      {/* #108：行内审核操作常显（图标默认 faint，hover 才上色，
                          可发现性优先；原 opacity-0 隐藏导致审核员不知有此操作） */}
                      <div className="flex items-center justify-end gap-0.5 opacity-80 group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity">
                        {item.status !== "active" && (
                          <button
                            disabled={busy}
                            onClick={e => { e.stopPropagation(); setReviewTarget({ item, action: "active" }); }}
                            className="p-1.5 rounded-md text-ink-faint hover:text-ok hover:bg-ok/10 transition-all disabled:opacity-40"
                            aria-label={t("approve")}
                            title={t("approveTitle")}
                          >
                            <CheckCircle size={14} />
                          </button>
                        )}
                        {item.status !== "rejected" && (
                          <button
                            disabled={busy}
                            onClick={e => { e.stopPropagation(); setReviewTarget({ item, action: "rejected" }); }}
                            className="p-1.5 rounded-md text-ink-faint hover:text-warn hover:bg-warn/10 transition-all disabled:opacity-40"
                            aria-label={t("reject")}
                            title={t("rejectTitle")}
                          >
                            <XCircle size={14} />
                          </button>
                        )}
                        <button
                          disabled={busy}
                          onClick={e => { e.stopPropagation(); setConfirmItem(item); }}
                          className="p-1.5 rounded-md text-ink-faint hover:text-bad hover:bg-bad/10 transition-all disabled:opacity-40"
                          aria-label={t("deleteTagLink")}
                          title={t("deleteTagLink")}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onChange={newPage => { setPage(newPage); load(newPage); }}
            onPageSizeChange={size => { setPageSize(size); setPage(1); load(1, size); }}
            pageSizes={[20, 30, 50, 100]}
          />
        </div>
      )}

      {/* ── Dialogs ── */}
      {reviewTarget && (
        <ReviewDialog
          item={reviewTarget.item}
          action={reviewTarget.action}
          onConfirm={handleReviewConfirm}
          onCancel={() => setReviewTarget(null)}
        />
      )}

      {confirmItem && (
        <ConfirmDialog
          open
          title={t("deleteTagTitle")}
          description={`${t("colTag")}: ${confirmItem.tag.name} (${confirmItem.tag.group.name})\n${t("colEntity")}: ${confirmItem.entityType} / ${confirmItem.entityId}`}
          confirmLabel={tCommon("delete")}
          danger
          onConfirm={() => handleRemove(confirmItem)}
          onCancel={() => setConfirmItem(null)}
        />
      )}

      {showBulkConfirm && (
        <ConfirmDialog
          open
          title={t("approveAll")}
          description={
            selectedItems.length > 0
              ? t("bulkApproveDesc", { count: selectedItems.length })
              : t("bulkApproveAllDesc", { count: items.length })
          }
          confirmLabel={t("approveConfirm")}
          onConfirm={async () => {
            setShowBulkConfirm(false);
            await handleBulkStatus("active", selectedItems.length > 0 ? selectedItems : items);
          }}
          onCancel={() => setShowBulkConfirm(false)}
        />
      )}

      {showCheatsheet && <CheatsheetDialog onClose={() => setShowCheatsheet(false)} />}

      {showLeaderboard && (
        <LeaderboardDialog
          items={leaderboard}
          period={leaderboardPeriod}
          onPeriodChange={setLeaderboardPeriod}
          onClose={() => setShowLeaderboard(false)}
        />
      )}

      {/* ── Undo banner (bottom-center, 5s window) ── */}
      {undoBannerCount > 0 && (
        <div
          key={undoBannerCount} // re-trigger animation when count changes
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 bg-overlay border border-edge-mid rounded-full shadow-lg shadow-black/40 animate-slide-up"
        >
          <span className="text-sm text-ink">
            {t("reviewed", { count: undoBannerCount })}
          </span>
          <div className="w-px h-3.5 bg-edge-mid" />
          <button
            onClick={() => handleUndoRef.current()}
            className="text-sm text-brand-1 font-medium hover:text-brand-2 transition-colors"
          >
            {t("undoBanner")}
          </button>
        </div>
      )}

      {/* ── Session counter (bottom-right, visible when undo clears) ── */}
      {sessionReviewed > 0 && undoBannerCount === 0 && (
        <div className="fixed bottom-6 right-6 z-40 flex items-center gap-1.5 px-3 py-1.5 bg-overlay border border-edge-mid rounded-lg shadow text-xs text-ink-sub animate-fade-in">
          <span className="text-ink font-medium tabular-nums">{sessionReviewed}</span>
          <span>{t("sessionReviewed")}</span>
        </div>
      )}
    </div>
  );
}

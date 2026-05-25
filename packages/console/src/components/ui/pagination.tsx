interface Props {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
  /** 可选：允许用户切换每页条数 */
  onPageSizeChange?: (size: number) => void;
  /** 每页条数选项，默认 [20, 50, 100] */
  pageSizes?: number[];
}

export function Pagination({
  page, pageSize, total, onChange,
  onPageSizeChange,
  pageSizes = [20, 50, 100],
}: Props) {
  const totalPages = Math.ceil(total / pageSize);

  // Build page number window: up to 5 pages centred on current
  const window = 2;
  const pages: (number | "…")[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= page - window && p <= page + window)) {
      pages.push(p);
    } else if (pages[pages.length - 1] !== "…") {
      pages.push("…");
    }
  }

  const btnBase =
    "inline-flex items-center justify-center min-w-[32px] h-8 px-2 text-xs rounded-md transition-colors";

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-edge gap-4">
      {/* 左侧：总数 + pageSize 切换 */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-ink-faint tabular-nums shrink-0">共 {total} 条</span>

        {onPageSizeChange && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-ink-faint">每页</span>
            <select
              value={pageSize}
              onChange={e => {
                onPageSizeChange(Number(e.target.value));
              }}
              className="h-7 px-1.5 text-xs rounded-md border border-edge bg-surface text-ink-dim hover:border-edge-strong focus:outline-none focus:border-edge-strong transition-colors cursor-pointer"
              aria-label="每页条数"
            >
              {pageSizes.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <span className="text-xs text-ink-faint">条</span>
          </div>
        )}
      </div>

      {/* 右侧：翻页控件（总页数 ≤ 1 时仍渲染，但按钮不可用） */}
      {totalPages > 1 ? (
        <div className="flex items-center gap-1">
          <button
            disabled={page <= 1}
            onClick={() => onChange(page - 1)}
            className={`${btnBase} border border-edge text-ink-dim hover:border-edge-strong hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            ←
          </button>
          {pages.map((p, i) =>
            p === "…" ? (
              <span key={`ellipsis-${i}`} className="px-1 text-xs text-ink-faint select-none">…</span>
            ) : (
              <button
                key={p}
                onClick={() => onChange(p)}
                className={`${btnBase} ${
                  p === page
                    ? "bg-surface-alt text-ink font-medium border border-edge-strong"
                    : "text-ink-dim hover:text-ink hover:bg-surface-alt border border-transparent"
                }`}
              >
                {p}
              </button>
            )
          )}
          <button
            disabled={page >= totalPages}
            onClick={() => onChange(page + 1)}
            className={`${btnBase} border border-edge text-ink-dim hover:border-edge-strong hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            →
          </button>
        </div>
      ) : (
        <div /> /* 保持左右布局对齐 */
      )}
    </div>
  );
}

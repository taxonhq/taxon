interface Props {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, pageSize, total, onChange }: Props) {
  const totalPages = Math.ceil(total / pageSize);

  if (totalPages <= 1) {
    return (
      <div className="flex items-center justify-between px-4 py-3 border-t border-edge">
        <span className="text-xs text-ink-faint">共 {total} 条</span>
      </div>
    );
  }

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
    <div className="flex items-center justify-between px-4 py-3 border-t border-edge">
      <span className="text-xs text-ink-faint">共 {total} 条</span>
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
    </div>
  );
}

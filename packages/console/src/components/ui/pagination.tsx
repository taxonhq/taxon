interface Props {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, pageSize, total, onChange }: Props) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-2 py-4">
      <span className="text-xs text-ink-faint mr-2">共 {total} 条</span>
      <button
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className="px-3 py-1 text-sm border border-edge disabled:opacity-40 disabled:cursor-not-allowed hover:border-ink-faint transition-colors"
      >
        上一页
      </button>
      <span className="text-sm text-ink-dim">{page} / {totalPages}</span>
      <button
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        className="px-3 py-1 text-sm border border-edge disabled:opacity-40 disabled:cursor-not-allowed hover:border-ink-faint transition-colors"
      >
        下一页
      </button>
    </div>
  );
}

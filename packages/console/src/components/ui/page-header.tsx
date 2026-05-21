interface PageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex items-end justify-between gap-6 pb-7 border-b border-edge animate-fade-in">
      <div className="space-y-1.5">
        {/* No negative letter-spacing here: titles are usually Chinese,
            tight tracking causes stroke clipping on CJK glyphs. */}
        <h1 className="text-[30px] font-extrabold text-ink leading-none">
          {title}
        </h1>
        {description && (
          <p className="text-[13px] text-ink-sub leading-relaxed mt-2">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0 pb-0.5">{action}</div>}
    </div>
  );
}

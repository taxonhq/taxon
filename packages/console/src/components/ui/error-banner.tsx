interface ErrorBannerProps { message: string }

export function ErrorBanner({ message }: ErrorBannerProps) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-3 px-4 py-3 text-sm text-bad border border-bad/20 bg-bad/[.04] rounded-lg animate-slide-up">
      <svg
        className="mt-px shrink-0"
        width="14" height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span className="leading-relaxed">{message}</span>
    </div>
  );
}

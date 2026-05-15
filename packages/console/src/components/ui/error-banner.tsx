interface ErrorBannerProps { message: string }

export function ErrorBanner({ message }: ErrorBannerProps) {
  if (!message) return null;
  return (
    <div className="px-4 py-3 text-sm text-bad border border-bad/20 bg-bad/4">
      {message}
    </div>
  );
}

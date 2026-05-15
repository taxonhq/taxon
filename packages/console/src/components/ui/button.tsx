import { cn } from "@/lib/utils";

type Variant = "primary" | "outline" | "ghost" | "danger" | "ok";
type Size = "sm" | "md" | "lg";

const variantClass: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-ink-dim",
  outline: "border border-edge text-ink-dim hover:border-ink-dim hover:text-ink",
  ghost:   "text-ink-dim hover:text-ink hover:bg-surface-alt",
  danger:  "border border-edge text-bad hover:border-bad/40 hover:bg-bad/5",
  ok:      "border border-edge text-ok hover:border-ok/40 hover:bg-ok/5",
};

const sizeClass: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs gap-1.5",
  md: "px-4 py-2 text-sm gap-2",
  lg: "px-5 py-2.5 text-sm gap-2",
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center rounded-sm font-medium transition-colors",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...props}
    >
      {loading ? "处理中..." : children}
    </button>
  );
}

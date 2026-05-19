import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "outline" | "ghost" | "danger" | "ok";
type Size = "sm" | "md" | "lg";

const variantClass: Record<Variant, string> = {
  primary: [
    "bg-ink text-surface font-semibold",
    "shadow-[0_1px_2px_rgba(0,0,0,.5),inset_0_1px_0_rgba(255,255,255,.08)]",
    "hover:bg-[#FFFFFF] hover:shadow-[0_2px_8px_rgba(0,0,0,.4),inset_0_1px_0_rgba(255,255,255,.12)]",
    "active:bg-[#E8E8E8]",
  ].join(" "),
  outline: [
    "border border-edge-mid text-ink-dim bg-transparent",
    "hover:border-edge-strong hover:text-ink hover:bg-surface-alt",
  ].join(" "),
  ghost: "text-ink-dim hover:text-ink hover:bg-surface-alt bg-transparent",
  danger: [
    "border border-bad/25 text-bad bg-transparent",
    "hover:border-bad/50 hover:bg-bad/8",
  ].join(" "),
  ok: [
    "border border-ok/25 text-ok bg-transparent",
    "hover:border-ok/50 hover:bg-ok/8",
  ].join(" "),
};

const sizeClass: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-xs gap-1.5 rounded-md",
  md: "px-3.5 py-2 text-sm gap-2 rounded-lg",
  lg: "px-5 py-2.5 text-sm gap-2 rounded-lg",
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

function Spinner() {
  return (
    <svg
      className="animate-spin"
      style={{ width: "0.875em", height: "0.875em" }}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12" cy="12" r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-all duration-150",
        "active:scale-[0.97]",
        "disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none",
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...props}
    >
      {loading ? <><Spinner /><span>处理中</span></> : children}
    </button>
  );
});

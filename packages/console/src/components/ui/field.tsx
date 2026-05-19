import { cn } from "@/lib/utils";

const inputBase = [
  "w-full px-3 py-2 text-sm text-ink bg-[#0A0A0A] border border-edge-mid rounded-lg",
  "placeholder:text-ink-faint",
  "focus:outline-none focus:border-edge-strong focus:ring-2 focus:ring-white/[.04]",
  "hover:border-edge-strong/60",
  "transition-all duration-150",
].join(" ");

interface FieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

export function Field({ label, required, hint, children, className }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label className="text-[11px] font-medium text-ink-sub uppercase tracking-[0.08em]">
        {label}
        {required && <span className="text-bad ml-0.5 normal-case">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-ink-faint leading-relaxed">{hint}</p>}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={inputBase} {...props} />;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  children: React.ReactNode;
}

export function Select({ children, ...props }: SelectProps) {
  return (
    <select className={cn(inputBase, "cursor-pointer")} {...props}>
      {children}
    </select>
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputBase, "resize-none leading-relaxed")} {...props} />;
}

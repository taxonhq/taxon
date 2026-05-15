import { cn } from "@/lib/utils";

const inputBase =
  "w-full px-3 py-2 border border-edge bg-surface text-ink text-sm " +
  "placeholder:text-ink-faint focus:outline-none focus:border-ink-faint transition";

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
      <label className="text-xs font-medium text-ink-dim uppercase tracking-wide">
        {label}
        {required && <span className="text-bad ml-0.5 normal-case">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-ink-faint">{hint}</p>}
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
    <select className={inputBase} {...props}>
      {children}
    </select>
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputBase, "resize-none")} {...props} />;
}

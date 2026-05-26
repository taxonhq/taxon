import { useId, cloneElement, isValidElement } from "react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

const inputBase = [
  "w-full px-3 py-2 text-sm text-ink bg-input border border-edge-mid rounded-lg",
  "placeholder:text-ink-faint",
  "focus:outline-none focus:border-edge-strong focus:ring-2 focus:ring-brand-1/40",
  "hover:border-edge-strong/60",
  "transition-all duration-150",
].join(" ");

interface FieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
  className?: string;
  /** Optional explicit id to apply to the input; otherwise a stable one is generated. */
  htmlFor?: string;
}

/**
 * Form field with proper label↔input association for a11y.
 * Clones the first child element to inject an `id` if one isn't already set,
 * so clicking the label focuses the input and screen readers announce them together.
 */
export function Field({ label, required, hint, children, className, htmlFor }: FieldProps) {
  const generatedId = useId();
  const fieldId = htmlFor ?? generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;

  // Inject id + aria-describedby into the first child element if it doesn't have them
  let childWithId = children;
  if (isValidElement(children)) {
    const el = children as ReactElement<{ id?: string; "aria-describedby"?: string }>;
    childWithId = cloneElement(el, {
      id: el.props.id ?? fieldId,
      "aria-describedby": el.props["aria-describedby"] ?? hintId,
    });
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={fieldId} className="text-xs font-medium text-ink-sub tracking-[0.08em]">
        {label}
        {required && <span className="text-bad ml-0.5">*</span>}
      </label>
      {childWithId}
      {hint && <p id={hintId} className="text-xs text-ink-faint leading-relaxed">{hint}</p>}
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

import { cn } from "@/lib/utils";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: boolean;
}

export function Card({ children, className, padding = true }: CardProps) {
  return (
    <div className={cn("card-border overflow-hidden", padding && "p-6", className)}>
      {children}
    </div>
  );
}

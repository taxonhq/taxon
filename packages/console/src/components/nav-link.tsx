"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface NavLinkProps {
  href: string;
  children: React.ReactNode;
  collapsed?: boolean;
  title?: string;
}

export function NavLink({ href, children, collapsed, title }: NavLinkProps) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/" && pathname.startsWith(href));

  return (
    <Link
      href={href}
      title={title}
      className={cn(
        "relative flex items-center py-2 text-[12.5px] rounded-lg transition-all duration-150",
        collapsed ? "justify-center px-2" : "gap-3 px-3",
        active
          ? "bg-overlay text-ink font-medium"
          : "text-ink-faint hover:text-ink-dim hover:bg-surface-alt",
      )}
    >
      {/* left accent — visible only in expanded mode */}
      {active && !collapsed && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-ink rounded-r-full" />
      )}
      {children}
    </Link>
  );
}

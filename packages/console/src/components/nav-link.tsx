"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface NavLinkProps {
  href: string;
  children: React.ReactNode;
}

export function NavLink({ href, children }: NavLinkProps) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/" && pathname.startsWith(href));
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 px-2 py-2 text-sm transition-colors rounded-sm",
        active
          ? "text-ink font-medium bg-surface-alt"
          : "text-ink-faint hover:text-ink-dim hover:bg-surface-alt",
      )}
    >
      {children}
    </Link>
  );
}

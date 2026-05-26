import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 统一的页面头部组件
 *
 * 覆盖控制台所有页面的 H1 节奏，消除此前 4 套并存的标题样式：
 *   - default + back/breadcrumb/meta/sticky/mono 变体组合
 *   - 字号全部走 type scale (--text-display-* / --text-*)
 *   - 描述支持 ReactNode 以承载内联 strong / 数字高亮
 */

export type PageHeaderSize = "default" | "compact";

export interface BreadcrumbItem {
  label: string;
  href?: string;
  /** Render this segment in mono font (entity types, slugs, ids). */
  mono?: boolean;
}

export interface PageHeaderProps {
  title: string;
  /** Subtitle / hint below title. Accepts ReactNode for inline emphasis. */
  description?: React.ReactNode;
  /** Right-aligned action area (typically buttons). */
  action?: React.ReactNode;
  /** Back-arrow link to the parent page. */
  back?: { href: string; label?: string };
  /** Breadcrumb chain rendered above the title. */
  breadcrumb?: BreadcrumbItem[];
  /** "default" 28px page-level; "compact" 20px for detail pages. */
  size?: PageHeaderSize;
  /** Render title in mono font (e.g. entity IDs). */
  mono?: boolean;
  /** Meta slot rendered between title cluster and action (chips/badges). */
  meta?: React.ReactNode;
  /** Stick to viewport top with backdrop blur. Used by Dashboard. */
  sticky?: boolean;
  /** Hide bottom divider — only valid when sticky is false. */
  noDivider?: boolean;
  className?: string;
}

const titleSize: Record<PageHeaderSize, string> = {
  default: "text-[28px]",
  compact: "text-[20px]",
};

const titleWeight: Record<PageHeaderSize, string> = {
  default: "font-extrabold",
  compact: "font-bold",
};

export function PageHeader({
  title,
  description,
  action,
  back,
  breadcrumb,
  size = "default",
  mono,
  meta,
  sticky,
  noDivider,
  className,
}: PageHeaderProps) {
  const hasCrumb = breadcrumb && breadcrumb.length > 0;

  return (
    <header
      className={cn(
        "animate-fade-in",
        sticky
          ? "sticky top-0 z-20 -mx-10 -mt-9 px-10 py-5 bg-surface/85 backdrop-blur-md border-b border-edge"
          : cn("pb-7", !noDivider && "border-b border-edge"),
        className,
      )}
    >
      <div className="flex items-end justify-between gap-6">
        {/* Left cluster: back + (breadcrumb / title / description) */}
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {back && (
            <Link
              href={back.href}
              aria-label={back.label ?? "返回"}
              className="mt-0.5 p-2 -ml-2 rounded-lg hover:bg-surface-alt transition-colors text-ink-faint hover:text-ink shrink-0"
            >
              <ArrowLeft size={15} />
            </Link>
          )}

          <div className="flex-1 min-w-0 space-y-1.5">
            {hasCrumb && (
              <nav aria-label="breadcrumb">
                <ol className="flex items-center gap-1.5 text-xs text-ink-sub min-w-0">
                  {breadcrumb!.map((item, i) => (
                    <li key={`${item.label}-${i}`} className="flex items-center gap-1.5 min-w-0">
                      {item.href ? (
                        <Link
                          href={item.href}
                          className={cn(
                            "hover:text-ink transition-colors truncate",
                            item.mono && "font-mono",
                          )}
                        >
                          {item.label}
                        </Link>
                      ) : (
                        <span className={cn("truncate", item.mono && "font-mono")}>
                          {item.label}
                        </span>
                      )}
                      <ChevronRight size={11} className="text-ink-faint shrink-0" aria-hidden />
                    </li>
                  ))}
                </ol>
              </nav>
            )}

            <h1
              className={cn(
                "text-ink leading-none truncate",
                titleSize[size],
                titleWeight[size],
                mono && "font-mono",
              )}
              style={{ letterSpacing: mono ? "-0.02em" : undefined }}
            >
              {title}
            </h1>

            {description && (
              <p
                className={cn(
                  "text-ink-sub leading-relaxed",
                  size === "default" ? "text-base mt-2" : "text-sm mt-1",
                )}
              >
                {description}
              </p>
            )}
          </div>
        </div>

        {/* Right cluster: meta + action */}
        {(meta || action) && (
          <div className="shrink-0 flex items-center gap-3 pb-0.5">
            {meta && <div className="flex items-center gap-2">{meta}</div>}
            {action}
          </div>
        )}
      </div>
    </header>
  );
}

import type { Metadata } from "next";
import "./globals.css";
import { Tags, ClipboardCheck, Layers } from "lucide-react";
import { NavLink } from "@/components/nav-link";

export const metadata: Metadata = {
  title: "Tag Service Console",
  description: "标签服务管理控制台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="h-full flex bg-surface">
        {/* Sidebar */}
        <aside className="w-52 h-screen fixed left-0 top-0 flex flex-col bg-card border-r border-edge">
          {/* Wordmark */}
          <div className="px-5 pt-6 pb-5 border-b border-edge">
            <div className="flex items-center gap-2">
              <Tags size={16} className="text-ink-dim" />
              <p className="text-sm font-semibold text-ink tracking-tight">Tag Service</p>
            </div>
            <p className="text-xs text-ink-faint mt-1 pl-6">管理控制台</p>
          </div>

          {/* Nav */}
          <nav className="flex-1 px-3 pt-3 space-y-0.5">
            <NavLink href="/groups">
              <Layers size={14} strokeWidth={1.5} />
              分组管理
            </NavLink>
            <NavLink href="/audit">
              <ClipboardCheck size={14} strokeWidth={1.5} />
              审核队列
            </NavLink>
          </nav>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-edge">
            <p className="text-[10px] text-ink-faint">localhost:3300</p>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 ml-52 min-h-screen p-8 max-w-5xl">
          {children}
        </main>
      </body>
    </html>
  );
}

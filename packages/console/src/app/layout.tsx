import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/toast";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "Taxon",
  description: "Taxon 标签平台管理控制台",
};

/** 内联脚本：在 React 水合前读取 localStorage 并写入 data-theme，防止 FOUC */
const themeScript = `
  try {
    var t = localStorage.getItem('taxon-theme');
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
    } else {
      // 首次访问：跟随系统偏好
      var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
  } catch(e) {}
`.trim();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-theme="dark" className={`h-full ${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        {/* 防 FOUC 主题脚本：必须是同步脚本，放在 <head> 最前面 */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-surface font-sans">
        <ThemeProvider>
          <AppShell>{children}</AppShell>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}

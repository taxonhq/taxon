import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Hanken_Grotesk, Space_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/toast";
import { ThemeProvider } from "@/components/theme-provider";

/* ── Mycelial 设计语言字体（#109 阶段 1）─────────────────────────────
   Hanken Grotesk（人文无衬线，主 sans）+ Noto Sans SC（思源黑体，CJK）
   + Space Mono（等宽，外壳标号/读数）。经 CSS 变量暴露，globals.css 接线。 */
const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700", "800"],
  variable: "--font-hanken",
  display: "swap",
});
// CJK 不经 next/font（Noto Sans SC 会生成上千 unicode-range 子集、拖垮构建）；
// 改用系统 CJK 字体栈，见 globals.css --font-sans。
const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Taxon",
  description: "Taxon Tag Platform Console",
};

/** 内联脚本：在 React 水合前读取 localStorage 并写入 data-theme，防止 FOUC */
const themeScript = `
  try {
    var t = localStorage.getItem('taxon-theme');
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
    } else {
      var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
  } catch(e) {}
`.trim();

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale   = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} data-theme="dark" className={`h-full ${GeistSans.variable} ${GeistMono.variable} ${hanken.variable} ${spaceMono.variable}`} suppressHydrationWarning>
      <head>
        {/* 防 FOUC 主题脚本：必须是同步脚本，放在 <head> 最前面 */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-surface font-sans">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>
            <AppShell>{children}</AppShell>
            <Toaster />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

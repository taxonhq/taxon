import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Taxcon",
  description: "Taxcon 标签平台管理控制台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`h-full ${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="bg-surface font-sans">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

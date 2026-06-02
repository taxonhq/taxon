import { redirect } from "next/navigation";

/**
 * /settings 入口 → 默认跳到第一个分节（#122）。
 * 右上角 gear 与 ⌘K 都指向 /settings，由此进入统一设置面。
 */
export default function SettingsIndexPage() {
  redirect("/settings/llm");
}

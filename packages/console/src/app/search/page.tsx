"use client";

import { useState } from "react";
import { Wrench, Grid3x3, Sparkles, Braces } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { WorkbenchMode } from "./workbench/workbench-mode";
import { PivotMode } from "./pivot-mode";
import { DslMode } from "./dsl-mode";
import type { SearchEntitiesRequest } from "@/lib/api";

type Mode = "workbench" | "pivot" | "nl" | "dsl";

const MODES: { id: Mode; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { id: "workbench", label: "查询工作台", icon: Wrench,   hint: "可视化 BoolExpr 构建器 — 标签 / 子孙 / 别名 / 元数据 任意组合" },
  { id: "pivot",     label: "Pivot 透视",  icon: Grid3x3,  hint: "二维标签交叉 + 切片 + 前置过滤" },
  { id: "nl",        label: "自然语言",    icon: Sparkles, hint: "用中文描述，AI 自动翻译为 BoolExpr" },
  { id: "dsl",       label: "JSON DSL",    icon: Braces,   hint: "直接编辑布尔表达式，开发者精确控制" },
];

export default function SearchPage() {
  const [mode, setMode] = useState<Mode>("workbench");
  const [dslPrefill, setDslPrefill] = useState<{ body: SearchEntitiesRequest; ts: number } | null>(null);

  const drillToDsl = (body: SearchEntitiesRequest) => {
    setDslPrefill({ body, ts: Date.now() });
    setMode("dsl");
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="实体检索"
        description="基于标签的多维查询 — BoolExpr 工作台 / Pivot 透视 / 自然语言 / 原生 DSL"
      />

      {/* Tab 切换 */}
      <div className="border-b border-edge flex items-end gap-1">
        {MODES.map(({ id, label, icon: Icon, hint }) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            title={hint}
            className={cn(
              "relative flex items-center gap-2 px-4 py-3 text-base transition-colors",
              "border-b-2 -mb-px",
              mode === id
                ? "border-ink text-ink font-semibold"
                : "border-transparent text-ink-sub hover:text-ink"
            )}
          >
            <Icon className="size-4" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div>
        {mode === "workbench" && <WorkbenchMode onDrillToDsl={drillToDsl} />}
        {mode === "pivot"     && <PivotMode onDrill={drillToDsl} />}
        {mode === "nl"        && <NlPlaceholder />}
        {mode === "dsl"       && <DslMode prefill={dslPrefill} />}
      </div>
    </div>
  );
}

function NlPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="size-16 rounded-full bg-overlay flex items-center justify-center">
        <Sparkles className="size-7 text-ink-sub" />
      </div>
      <div className="space-y-2">
        <p className="text-lg font-semibold text-ink">自然语言查询</p>
        <p className="text-base text-ink-sub max-w-md">
          用中文描述你想找的东西（例如：「川菜餐厅但不要素食的，AI 高置信度」），
          系统会自动翻译为 BoolExpr。即将上线。
        </p>
      </div>
    </div>
  );
}

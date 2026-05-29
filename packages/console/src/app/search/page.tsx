"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Wrench, Grid3x3, Sparkles, Braces } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { WorkbenchMode } from "./workbench/workbench-mode";
import { PivotMode } from "./pivot-mode";
import { DslMode } from "./dsl-mode";
import { NlMode } from "./nl-mode";
import type { SearchEntitiesRequest, BoolExpr } from "@/lib/api";

type Mode = "workbench" | "pivot" | "nl" | "dsl";

const MODE_DEFS: { id: Mode; labelKey: "tabWorkbench" | "tabPivot" | "tabNl" | "tabDsl"; hintKey: "tabWorkbenchHint" | "tabPivotHint" | "tabNlHint" | "tabDslHint"; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "workbench", labelKey: "tabWorkbench", hintKey: "tabWorkbenchHint", icon: Wrench },
  { id: "pivot",     labelKey: "tabPivot",     hintKey: "tabPivotHint",     icon: Grid3x3 },
  { id: "nl",        labelKey: "tabNl",        hintKey: "tabNlHint",        icon: Sparkles },
  { id: "dsl",       labelKey: "tabDsl",       hintKey: "tabDslHint",       icon: Braces },
];

export default function SearchPage() {
  const t = useTranslations("search");
  const [mode, setMode] = useState<Mode>("workbench");
  const [dslPrefill, setDslPrefill] = useState<{ body: SearchEntitiesRequest; ts: number } | null>(null);
  const [workbenchPrefill, setWorkbenchPrefill] = useState<{ boolExpr: BoolExpr; entityType: string; ts: number } | null>(null);

  const drillToDsl = (body: SearchEntitiesRequest) => {
    setDslPrefill({ body, ts: Date.now() });
    setMode("dsl");
  };

  const sendToWorkbench = (boolExpr: BoolExpr, entityType: string) => {
    setWorkbenchPrefill({ boolExpr, entityType, ts: Date.now() });
    setMode("workbench");
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("title")}
        hint={t("description")}
      />

      {/* Tab 切换 */}
      <div className="border-b border-edge flex items-end gap-1">
        {MODE_DEFS.map(({ id, labelKey, icon: Icon, hintKey }) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            title={t(hintKey)}
            className={cn(
              "relative flex items-center gap-2 px-4 py-3 text-base transition-colors",
              "border-b-2 -mb-px",
              mode === id
                ? "border-ink text-ink font-semibold"
                : "border-transparent text-ink-sub hover:text-ink"
            )}
          >
            <Icon className="size-4" />
            <span>{t(labelKey)}</span>
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div>
        {mode === "workbench" && <WorkbenchMode onDrillToDsl={drillToDsl} prefill={workbenchPrefill} />}
        {mode === "pivot"     && <PivotMode onDrill={drillToDsl} />}
        {mode === "nl"        && <NlMode onApplyToDsl={drillToDsl} onApplyToWorkbench={sendToWorkbench} />}
        {mode === "dsl"       && <DslMode prefill={dslPrefill} />}
      </div>
    </div>
  );
}

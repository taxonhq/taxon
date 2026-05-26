"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { X, ChevronRight, ChevronLeft, Terminal, Layers, Tag, Box, ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "taxon.onboarding.completed";
const STEPS = [
  {
    id: "groups",
    title: "分组管理",
    description: "先建分组，定义你的标签维度。例如「菜系」「饮食偏好」等",
    icon: Layers,
    href: "/groups",
  },
  {
    id: "tags",
    title: "标签",
    description: "在分组内创建标签值，如「川菜」「素食」",
    icon: Tag,
    href: "/groups",
  },
  {
    id: "entities",
    title: "实体管理",
    description: "给业务实体打标签，支持手动和 API 两种方式",
    icon: Box,
    href: "/entities",
  },
  {
    id: "audit",
    title: "审核队列",
    description: "AI 生成的标签需要人工审核，在这里完成审核工作流",
    icon: ClipboardCheck,
    href: "/audit",
  },
] as const;

interface OnboardingTourProps {
  onComplete: () => void;
}

export function OnboardingTour({ onComplete }: OnboardingTourProps) {
  const [step, setStep] = useState(0);
  const currentStep = STEPS[step];
  const Icon = currentStep.icon;

  const handleNext = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      onComplete();
    }
  }, [step, onComplete]);

  const handlePrev = useCallback(() => {
    if (step > 0) {
      setStep(step - 1);
    }
  }, [step]);

  const handleSkip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleSkip();
      if (e.key === "ArrowRight" || e.key === "Enter") handleNext();
      if (e.key === "ArrowLeft") handlePrev();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleNext, handlePrev, handleSkip]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      {/* Card */}
      <div className="relative z-10 w-full max-w-md mx-4 card-border p-6 space-y-6 animate-scale-in">
        {/* Progress */}
        <div className="flex items-center gap-2">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i <= step ? "bg-brand-1" : "bg-edge",
              )}
            />
          ))}
        </div>

        {/* Content */}
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-brand-1/20 flex items-center justify-center shrink-0">
            <Icon size={20} className="text-brand-1" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-semibold text-ink">{currentStep.title}</p>
            <p className="text-sm text-ink-sub mt-1 leading-relaxed">{currentStep.description}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={handleSkip}
            className="text-sm text-ink-faint hover:text-ink transition-colors"
          >
            跳过引导
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={handlePrev}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-ink-dim hover:text-ink transition-colors"
              >
                <ChevronLeft size={14} />
                上一步
              </button>
            )}
            <button
              onClick={handleNext}
              className="flex items-center gap-1 px-4 py-1.5 text-sm font-medium bg-ink text-surface rounded-lg hover:bg-ink-dim transition-colors"
            >
              {step === STEPS.length - 1 ? "完成" : "下一步"}
              {step < STEPS.length - 1 && <ChevronRight size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Hook: useOnboarding ─────────────────────────────────────────────────────

export function useOnboarding() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const completed = localStorage.getItem(STORAGE_KEY);
    if (!completed) {
      // Delay to avoid flash on load
      const t = setTimeout(() => setShowOnboarding(true), 500);
      return () => clearTimeout(t);
    }
  }, []);

  const completeOnboarding = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "true");
    setShowOnboarding(false);
  }, []);

  const resetOnboarding = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setShowOnboarding(true);
  }, []);

  return {
    showOnboarding,
    completeOnboarding,
    resetOnboarding,
    mounted,
  };
}

// ── Empty State CTA ────────────────────────────────────────────────────────

interface EmptyStateCTAProps {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function EmptyStateCTA({
  title = "还没有数据",
  description,
  actions,
  className,
}: EmptyStateCTAProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 text-center", className)}>
      <div className="w-16 h-16 rounded-2xl bg-edge/40 flex items-center justify-center mb-4">
        <Box size={24} className="text-ink-faint" />
      </div>
      <p className="text-lg font-medium text-ink mb-1">{title}</p>
      {description && (
        <p className="text-sm text-ink-sub mb-4 max-w-sm">{description}</p>
      )}
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── Quick Seed CTA for Dashboard ───────────────────────────────────────────

interface SeedCTAProps {
  onDismiss: () => void;
}

export function SeedCTA({ onDismiss }: SeedCTAProps) {
  const handleCopy = () => {
    navigator.clipboard.writeText("pnpm seed:demo");
  };

  return (
    <div className="card-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink">快速填充示例数据</p>
        <button
          onClick={onDismiss}
          className="p-1 text-ink-faint hover:text-ink transition-colors"
        >
          <X size={12} />
        </button>
      </div>
      <p className="text-xs text-ink-sub">
        运行以下命令填充示例数据，快速体验系统功能
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 px-3 py-2 bg-input rounded-lg text-sm font-mono text-ink border border-edge">
          pnpm seed:demo
        </code>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-ink-dim hover:text-ink bg-surface-alt rounded-lg border border-edge transition-colors"
        >
          <Terminal size={12} />
          复制
        </button>
      </div>
      <div className="flex items-center gap-3 pt-1">
        <Link
          href="/groups?new"
          className="text-xs text-brand-1 hover:underline"
        >
          创建第一个分组 →
        </Link>
      </div>
    </div>
  );
}

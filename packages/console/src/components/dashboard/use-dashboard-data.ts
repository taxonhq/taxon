/**
 * Dashboard 数据 hook
 *
 * 聚合所有 widget 所需数据，统一刷新调度：
 *  - 静态聚合：getTagGroups + getEntityTypes + getAuditItems + getHealth
 *  - 时序数据：getMetricsTrend (7d) + getMetricsToday + getMetricsActivity
 *
 * 展示模式下每 10s 自动刷新；编辑模式下暂停（避免数据跳变干扰拖拽）。
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTagGroups, getEntityTypes, getAuditItems, getHealth,
  getMetricsTrend, getMetricsToday, getMetricsActivity,
  type HealthInfo, type TrendResult, type TodayResult, type ActivityEvent,
} from "@/lib/api";

export interface DashStats {
  groups: number; tags: number; entities: number; pending: number;
}
export interface EntityTypeStat { entityType: string; count: number }
export interface GroupStat { id: string; name: string; tags: number }

export interface DashboardData {
  stats:       DashStats;
  entityTypes: EntityTypeStat[];
  topGroups:   GroupStat[];
  health:      HealthInfo | null;
  trend:       TrendResult | null;
  today:       TodayResult | null;
  activity:    ActivityEvent[];
}

interface UseDashboardOpts { autoRefreshMs?: number; paused?: boolean }

export function useDashboardData(opts: UseDashboardOpts = {}) {
  const { autoRefreshMs = 10_000, paused = false } = opts;
  const [data,       setData]       = useState<DashboardData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt,  setUpdatedAt]  = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);

    const [groupsRes, typesRes, auditRes, healthRes, trendRes, todayRes, activityRes] = await Promise.allSettled([
      getTagGroups({ pageSize: 100 }),
      getEntityTypes(),
      getAuditItems({ status: "pending", pageSize: 1 }),
      getHealth(),
      getMetricsTrend("7d"),
      getMetricsToday(),
      getMetricsActivity(15),
    ]);

    const groups    = groupsRes.status   === "fulfilled" ? groupsRes.value   : null;
    const types     = typesRes.status    === "fulfilled" ? typesRes.value    : [];
    const auditPage = auditRes.status    === "fulfilled" ? auditRes.value    : null;
    const health    = healthRes.status   === "fulfilled" ? healthRes.value   : null;
    const trend     = trendRes.status    === "fulfilled" ? trendRes.value    : null;
    const today     = todayRes.status    === "fulfilled" ? todayRes.value    : null;
    const activity  = activityRes.status === "fulfilled" ? activityRes.value : [];

    const totalTags     = groups?.items.reduce((s, g) => s + (g._count?.tags ?? 0), 0) ?? 0;
    const totalEntities = types.reduce((s, t) => s + t.count, 0);
    const topGroups     = (groups?.items ?? [])
      .map(g => ({ id: g.id, name: g.name, tags: g._count?.tags ?? 0 }))
      .sort((a, b) => b.tags - a.tags)
      .slice(0, 10);

    setData({
      stats:       { groups: groups?.total ?? 0, tags: totalTags, entities: totalEntities, pending: auditPage?.total ?? 0 },
      entityTypes: [...types].sort((a, b) => b.count - a.count),
      topGroups,
      health,
      trend,
      today,
      activity,
    });
    setUpdatedAt(new Date());
    setLoading(false);
    setRefreshing(false);
  }, []);

  // 初始加载
  useEffect(() => { load(); }, [load]);

  // 自动刷新（暂停时清掉定时器）
  useEffect(() => {
    if (paused || autoRefreshMs <= 0) return;
    const tick = () => {
      load(true).finally(() => {
        timerRef.current = setTimeout(tick, autoRefreshMs);
      });
    };
    timerRef.current = setTimeout(tick, autoRefreshMs);
    return () => clearTimeout(timerRef.current);
  }, [autoRefreshMs, paused, load]);

  return { data, loading, refreshing, updatedAt, refresh: () => load(true) };
}

/**
 * API client for the Taxon tag service.
 *
 * Types are kept in sync with the OpenAPI spec via:
 *  1. packages/service: `pnpm gen:spec`  — regenerates openapi.json
 *  2. packages/console: `pnpm gen:types` — regenerates api-types.gen.ts
 *
 * The generated SchemaTypes alias below acts as a compile-time anchor:
 * if the generated schema drifts from the manual types here, TypeScript
 * will flag mismatches in the functions that use them.
 */

// Re-export generated types for consumers that prefer spec-aligned shapes
export type { components as ApiSchemas } from "@/lib/api-types.gen";

const BASE  = process.env.NEXT_PUBLIC_TAG_SERVICE_URL   || "http://localhost:3300";
const TOKEN = process.env.NEXT_PUBLIC_TAG_SERVICE_TOKEN || "";

function authHeaders(): HeadersInit {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
}

/** Thrown by {@link req} on non-zero API responses. Carries the HTTP status code. */
export class ApiError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  const data = await res.json();
  if (data.code !== 0) throw new ApiError(data.code as number, data.message || `Request failed ${res.status}`);
  return data.data as T;
}

// ── 公共类型 ──────────────────────────────────────────────────────

export interface HealthInfo {
  status:      "ok" | "degraded";
  db:          "ok" | "error";
  timestamp:   string;
  version:     string;
  nodeVersion: string;
}

export interface RegisteredEntity {
  entityType: string;
  entityId: string;
  registeredAt: string;
  /** withTags=true 时一并返回的 active 标签（避免 N+1） */
  tags?: EntityTagItem[];
}

export interface EntityTagItem {
  id: string;
  slug: string;
  name: string;
  groupId: string;
  group: { id: string; slug: string; name: string };
  source: string;
  confidence: number | null;
  status: string;
  taggedAt: string;
}

export interface TagGroupEntityRule {
  groupId: string;
  entityType: string;
  allowMultiple: boolean;
}

export interface TagGroup {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  entityScopes: string[];
  allowMultiple: boolean;
  sortOrder: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  entityRules: TagGroupEntityRule[];
  _count?: { tags: number };
}

export interface Tag {
  id: string;
  groupId: string;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  parentId: string | null;
  path: string;
  depth: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { entityTags: number };
  /** 仅 list API 返回，用于判断叶节点；tree API 使用 TagTreeNode */
  childCount?: number;
}

export interface TagAlias {
  id: string;
  tagId: string;
  alias: string;
  source: string;
  createdAt: string;
}

export interface TagTreeNode extends Tag {
  children: TagTreeNode[];
  aliases?: TagAlias[];
}

export interface AuditItem {
  tagId: string;
  entityType: string;
  entityId: string;
  source: string;
  confidence: number | null;
  status: string;
  taggedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  reviewerName: string | null;
  tag: {
    id: string;
    slug: string;
    name: string;
    group: { id: string; slug: string; name: string };
  };
}

export interface TagReviewHistory {
  id: string;
  fromStatus: string;
  toStatus: string;
  note: string | null;
  reviewedAt: string;
  reviewer: { id: string; name: string; role: string } | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Tag Groups ────────────────────────────────────────────────────

export async function getTagGroups(params?: {
  scope?: string[];
  page?: number;
  pageSize?: number;
  withPreviewTags?: boolean;
  previewSize?: number;
  onlyDeleted?: boolean;
}): Promise<Paginated<TagGroup & { tags?: Tag[] }>> {
  const q = new URLSearchParams();
  params?.scope?.forEach(s => q.append("scope", s));
  if (params?.page)            q.set("page",            String(params.page));
  if (params?.pageSize)        q.set("pageSize",        String(params.pageSize));
  if (params?.withPreviewTags) q.set("withPreviewTags", "true");
  if (params?.previewSize)     q.set("previewSize",     String(params.previewSize));
  if (params?.onlyDeleted)     q.set("onlyDeleted",     "true");
  return req<Paginated<TagGroup & { tags?: Tag[] }>>(`/tag-groups${q.size ? `?${q}` : ""}`);
}

export async function getTagGroup(groupId: string): Promise<TagGroup> {
  return req<TagGroup>(`/tag-groups/${groupId}`);
}

export async function createTagGroup(body: {
  slug: string;
  name: string;
  description?: string;
  entityScopes?: string[];
  allowMultiple?: boolean;
  sortOrder?: number;
}): Promise<TagGroup> {
  return req<TagGroup>("/tag-groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function updateTagGroup(groupId: string, body: {
  slug?: string;
  name?: string;
  description?: string | null;
  entityScopes?: string[];
  allowMultiple?: boolean;
  sortOrder?: number;
}): Promise<TagGroup> {
  return req<TagGroup>(`/tag-groups/${groupId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteTagGroup(groupId: string, opts: { force?: boolean; permanent?: boolean } = {}): Promise<void> {
  const q = new URLSearchParams();
  if (opts.force)     q.set("force",     "true");
  if (opts.permanent) q.set("permanent", "true");
  await req<unknown>(`/tag-groups/${groupId}${q.size ? `?${q}` : ""}`, { method: "DELETE" });
}

export async function restoreTagGroup(groupId: string): Promise<TagGroup> {
  return req<TagGroup>(`/tag-groups/${groupId}/restore`, { method: "POST" });
}

// ── Entity Rules ──────────────────────────────────────────────────

export async function setEntityRules(
  groupId: string,
  rules: { entityType: string; allowMultiple: boolean }[]
): Promise<TagGroupEntityRule[]> {
  return req<TagGroupEntityRule[]>(`/tag-groups/${groupId}/entity-rules`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules }),
  });
}

// ── Tags ──────────────────────────────────────────────────────────

export async function getGroupTags(
  groupId: string,
  params?: { page?: number; pageSize?: number; onlyDeleted?: boolean }
): Promise<Paginated<Tag>> {
  const q = new URLSearchParams();
  if (params?.page)        q.set("page",        String(params.page));
  if (params?.pageSize)    q.set("pageSize",    String(params.pageSize));
  if (params?.onlyDeleted) q.set("onlyDeleted", "true");
  return req<Paginated<Tag>>(`/tag-groups/${groupId}/tags${q.size ? `?${q}` : ""}`);
}

export async function createTag(body: {
  groupId: string;
  name: string;
  slug?: string;
  description?: string;
  sortOrder?: number;
  parentId?: string | null;
}): Promise<Tag> {
  return req<Tag>("/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function updateTag(tagId: string, body: {
  name?: string;
  slug?: string;
  description?: string | null;
  sortOrder?: number;
  parentId?: string | null;
}): Promise<Tag> {
  return req<Tag>(`/tags/${tagId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function getTagGroupTree(groupId: string): Promise<TagTreeNode[]> {
  return req<TagTreeNode[]>(`/tag-groups/${groupId}/tree`);
}

/** 跨分组搜索标签（用于全局选择器 / 工作台 tag picker）。
 *  q: 名称模糊匹配；groupId: 限定分组（可选） */
export async function searchTags(params?: {
  q?: string;
  groupId?: string;
  page?: number;
  pageSize?: number;
}): Promise<Paginated<Tag>> {
  const qs = new URLSearchParams();
  if (params?.q)        qs.set("q",        params.q);
  if (params?.groupId)  qs.set("groupId",  params.groupId);
  if (params?.page)     qs.set("page",     String(params.page));
  if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
  return req<Paginated<Tag>>(`/tags${qs.size ? `?${qs}` : ""}`);
}

// ── Tag Aliases ───────────────────────────────────────────────────

export async function getTagAliases(tagId: string): Promise<TagAlias[]> {
  return req<TagAlias[]>(`/tags/${tagId}/aliases`);
}

export async function createTagAlias(tagId: string, alias: string, source = "manual"): Promise<TagAlias> {
  return req<TagAlias>(`/tags/${tagId}/aliases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alias, source }),
  });
}

export async function deleteTagAlias(tagId: string, aliasId: string): Promise<void> {
  await req<unknown>(`/tags/${tagId}/aliases/${aliasId}`, { method: "DELETE" });
}

export async function resolveTag(q: string, groupId?: string): Promise<{
  tag: Tag;
  matchedBy: "name" | "slug" | "alias";
}> {
  const params = new URLSearchParams({ q });
  if (groupId) params.set("groupId", groupId);
  return req<{ tag: Tag; matchedBy: "name" | "slug" | "alias" }>(`/tags/resolve?${params}`);
}

export async function getTagDescendants(tagId: string): Promise<{ items: Tag[]; total: number }> {
  return req<{ items: Tag[]; total: number }>(`/tags/${tagId}/descendants`);
}

export async function getTagAncestors(tagId: string): Promise<{ id: string; slug: string; name: string; depth: number }[]> {
  return req<{ id: string; slug: string; name: string; depth: number }[]>(`/tags/${tagId}/ancestors`);
}

export async function mergeTag(
  targetId: string,
  sourceIds: string[]
): Promise<{ entityTagsMoved: number; aliasesMoved: number }> {
  return req<{ entityTagsMoved: number; aliasesMoved: number }>(`/tags/${targetId}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceIds }),
  });
}

export async function moveTagToGroup(
  tagId: string,
  targetGroupId: string
): Promise<{ tag: Tag; tagsMoved: number }> {
  return req<{ tag: Tag; tagsMoved: number }>(`/tags/${tagId}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetGroupId }),
  });
}

export async function deleteTag(tagId: string, opts: { force?: boolean; permanent?: boolean } | boolean = {}): Promise<void> {
  // Backwards compat: deleteTag(id, true) === deleteTag(id, { force: true })
  const o = typeof opts === "boolean" ? { force: opts } : opts;
  const q = new URLSearchParams();
  if (o.force)     q.set("force",     "true");
  if (o.permanent) q.set("permanent", "true");
  await req<unknown>(`/tags/${tagId}${q.size ? `?${q}` : ""}`, { method: "DELETE" });
}

export async function restoreTag(tagId: string): Promise<Tag> {
  return req<Tag>(`/tags/${tagId}/restore`, { method: "POST" });
}

// ── Entity Types ──────────────────────────────────────────────────

export async function getEntityTypes(): Promise<{ entityType: string; count: number }[]> {
  return req<{ entityType: string; count: number }[]>("/entity-types");
}

// ── Entity Registration ───────────────────────────────────────────

export interface EntityDetail {
  entityType:   string;
  entityId:     string;
  registeredAt: string;
  metadata:     Record<string, unknown> | null;
}
/** 取单个实体（含 metadata）；404 时 throw */
export async function getEntity(entityType: string, entityId: string): Promise<EntityDetail> {
  return req<EntityDetail>(`/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`);
}

export async function getEntitiesByType(
  entityType: string,
  params?: { page?: number; pageSize?: number; search?: string; withTags?: boolean }
): Promise<Paginated<RegisteredEntity>> {
  const q = new URLSearchParams();
  if (params?.page)     q.set("page",     String(params.page));
  if (params?.pageSize) q.set("pageSize", String(params.pageSize));
  if (params?.search)   q.set("search",   params.search);
  if (params?.withTags) q.set("withTags", "true");
  return req<Paginated<RegisteredEntity>>(
    `/entities/${encodeURIComponent(entityType)}${q.size ? `?${q}` : ""}`
  );
}

export async function registerEntity(entityType: string, entityId: string): Promise<void> {
  await req<unknown>(
    `/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
    { method: "POST" }
  );
}

export async function unregisterEntity(entityType: string, entityId: string): Promise<void> {
  await req<unknown>(
    `/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
    { method: "DELETE" }
  );
}

// ── Entity Tags ───────────────────────────────────────────────────

export async function getEntityTags(
  entityType: string,
  entityId: string
): Promise<EntityTagItem[]> {
  return req<EntityTagItem[]>(
    `/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/tags?status=all`
  );
}

export async function addEntityTag(
  entityType: string,
  entityId: string,
  tagId: string,
  source = "manual"
): Promise<void> {
  await req<unknown>(
    `/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/tags/${tagId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    }
  );
}

// ── Audit ─────────────────────────────────────────────────────────

export async function getAuditItems(params?: {
  status?: "pending" | "active" | "rejected";
  entityType?: string;
  /** 最低置信度 0–1（可选） */
  minConfidence?: number;
  /** 最高置信度 0–1（可选） */
  maxConfidence?: number;
  page?: number;
  pageSize?: number;
}): Promise<Paginated<AuditItem>> {
  const q = new URLSearchParams();
  if (params?.status)        q.set("status",        params.status);
  if (params?.entityType)    q.set("entityType",    params.entityType);
  if (params?.minConfidence != null) q.set("minConfidence", String(params.minConfidence));
  if (params?.maxConfidence != null) q.set("maxConfidence", String(params.maxConfidence));
  if (params?.page)          q.set("page",          String(params.page));
  if (params?.pageSize)      q.set("pageSize",      String(params.pageSize));
  return req<Paginated<AuditItem>>(`/entities/audit${q.size ? `?${q}` : ""}`);
}

export async function updateEntityTagStatus(
  entityType: string,
  entityId: string,
  tagId: string,
  status: "active" | "rejected" | "pending",
  note?: string
): Promise<{ reviewId: string }> {
  return req<{ reviewId: string }>(`/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/tags/${tagId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, ...(note ? { note } : {}) }),
  });
}

export async function undoReviews(
  reviewIds: string[]
): Promise<{ reverted: number; skipped: number }> {
  return req<{ reverted: number; skipped: number }>("/entities/audit/undo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reviewIds }),
  });
}

export async function getTagHistory(
  entityType: string,
  entityId: string,
  tagId: string
): Promise<TagReviewHistory[]> {
  return req<TagReviewHistory[]>(
    `/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/tags/${tagId}/history`
  );
}

export async function removeEntityTag(
  entityType: string,
  entityId: string,
  tagId: string
): Promise<void> {
  await req<unknown>(
    `/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/tags/${tagId}`,
    { method: "DELETE" }
  );
}

// ── Dashboard 布局 ────────────────────────────────────────────────

export interface DashboardLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
}

export interface PersistedDashboardLayout {
  version: number;
  items: DashboardLayoutItem[];
}

export async function getDashboardLayout(): Promise<PersistedDashboardLayout | DashboardLayoutItem[] | null> {
  return req<PersistedDashboardLayout | DashboardLayoutItem[] | null>("/dashboard/layout");
}

export async function saveDashboardLayout(layout: PersistedDashboardLayout): Promise<void> {
  await req<unknown>("/dashboard/layout", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout }),
  });
}

// ── System Config ─────────────────────────────────────────────────

export interface SystemConfig {
  locale: "zh-CN" | "en-US";
}

export async function getSystemConfig(): Promise<SystemConfig> {
  return req<SystemConfig>("/settings/system");
}

export async function updateSystemConfig(data: Partial<SystemConfig>): Promise<void> {
  await req<unknown>("/settings/system", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

// ── Health ────────────────────────────────────────────────────────

export async function getHealth(): Promise<HealthInfo> {
  const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(4000) });
  return res.json() as Promise<HealthInfo>;
}

// ── Dashboard Metrics ─────────────────────────────────────────────

export interface TrendPoint  { date: string; tags: number; entities: number; reviews: number }
export interface TrendResult { period: string; series: TrendPoint[] }

export interface TodayMetric { today: number; comparePct: number }
export interface TodayResult { tags: TodayMetric; entities: TodayMetric; audits: TodayMetric }

export type ActivityEvent =
  | { kind: "tag-added"; time: string; source: string; entityType: string; entityId: string; tagName: string; groupName: string }
  | { kind: "review";    time: string; fromStatus: string; toStatus: string; entityType: string; entityId: string; tagName: string };

export async function getMetricsTrend(period: "7d" | "14d" | "30d" = "7d"): Promise<TrendResult> {
  return req<TrendResult>(`/metrics/trend?period=${period}`);
}
export async function getMetricsToday(): Promise<TodayResult> {
  return req<TodayResult>("/metrics/today");
}
export async function getMetricsActivity(limit = 10): Promise<ActivityEvent[]> {
  return req<ActivityEvent[]>(`/metrics/activity?limit=${limit}`);
}

// ── Reviewer Stats ────────────────────────────────────────────────

export interface ReviewerStats {
  reviewerId:   string | null;
  totalReviews: number;
  approved:     number;
  rejected:     number;
  reverted:     number;
  approveRate:  number | null;
}

export interface LeaderboardItem {
  reviewerId:   string | null;
  name:         string;
  total:        number;
  approved:     number;
  rejected:     number;
  approveRate:  number | null;
  isCurrentUser: boolean;
}

export async function getReviewerStats(params?: {
  reviewerId?: string;
  from?: string;
  to?: string;
}): Promise<ReviewerStats> {
  const q = new URLSearchParams();
  if (params?.reviewerId) q.set("reviewerId", params.reviewerId);
  if (params?.from)       q.set("from",       params.from);
  if (params?.to)         q.set("to",         params.to);
  const qs = q.toString();
  return req<ReviewerStats>(`/metrics/reviewer-stats${qs ? `?${qs}` : ""}`);
}

export async function getLeaderboard(params?: {
  period?: "7d" | "30d" | "all";
  limit?:  number;
}): Promise<{ period: string; items: LeaderboardItem[] }> {
  const q = new URLSearchParams();
  if (params?.period) q.set("period", params.period);
  if (params?.limit)  q.set("limit",  String(params.limit));
  const qs = q.toString();
  return req<{ period: string; items: LeaderboardItem[] }>(`/metrics/leaderboard${qs ? `?${qs}` : ""}`);
}

// ── 多维检索 / 透视 ───────────────────────────────────────────────

// BoolExpr DSL 类型，对齐 service/src/lib/schemas.ts
export type BoolExpr =
  | { tag: string }
  | { tagSlug: string; groupSlug?: string }
  | { tagAlias: string; groupSlug?: string }
  | { descendantOf: string }
  | { text: string }
  | { source: ("manual" | "ai" | "system" | "import")[] }
  | { confidence: { gte?: number; lte?: number } }
  | { status: ("active" | "pending" | "rejected")[] }
  | { and: BoolExpr[] }
  | { or:  BoolExpr[] }
  | { not: BoolExpr };

export interface SearchEntitiesRequest {
  entityType: string;
  filter?:    BoolExpr;
  page?:      number;
  pageSize?:  number;
  sort?:      "registeredAt:desc" | "registeredAt:asc" | "taggedAt:desc" | "taggedAt:asc";
  include?:   ("tags")[];
  facets?:    ("groupId")[];
}

export interface FacetTagItem {
  tagId:    string;
  tagSlug:  string;
  tagName:  string;
  groupId:  string;
  count:    number;
}

export interface SearchEntitiesResult {
  items:    RegisteredEntity[];
  total:    number;
  page:     number;
  pageSize: number;
  facets?:  Record<string, Record<string, FacetTagItem[]>>;
}

export async function searchEntities(body: SearchEntitiesRequest): Promise<SearchEntitiesResult> {
  return req<SearchEntitiesResult>("/search/entities", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
}

export interface PivotAxisItem {
  tagId: string;
  slug:  string;
  name:  string;
  total: number;
}

export interface PivotRequest {
  entityType:   string;
  rowGroupSlug: string;
  colGroupSlug: string;
  filter?:      BoolExpr;
  topN?:        number;
}

export interface PivotResult {
  rows:           PivotAxisItem[];
  cols:           PivotAxisItem[];
  cells:          Record<string, number>;
  grandTotal:     number;
  uncategorized:  { row: number; col: number };
}

export async function searchPivot(body: PivotRequest): Promise<PivotResult> {
  return req<PivotResult>("/search/pivot", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
}

// 共现矩阵
export interface CooccurrenceTag {
  tagId:     string;
  slug:      string;
  name:      string;
  groupSlug: string;
  groupName: string;
  total:     number;
}

export interface CooccurrenceCell {
  count: number;
  lift:  number;
}

export interface CooccurrenceRequest {
  entityType: string;
  filter?:    BoolExpr;
  topN?:      number;
}

export interface CooccurrenceResult {
  tags:          CooccurrenceTag[];
  cooccurrence:  Record<string, CooccurrenceCell>;
  totalEntities: number;
}

export async function searchCooccurrence(body: CooccurrenceRequest): Promise<CooccurrenceResult> {
  return req<CooccurrenceResult>("/search/co-occurrence", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
}

// ── 实体关系图谱（#100）────────────────────────────────────────────
export interface GraphNode {
  id:    string;
  kind:  "entity" | "tag";
  label: string;
  // tag 节点
  groupId?:     string;
  groupSlug?:   string;
  entityCount?: number;
  // entity 节点
  entityType?: string;
  entityId?:   string;
  tagCount?:   number;
}
export interface GraphLink { source: string; target: string }
export interface GraphData {
  focus:     string | null;
  nodes:     GraphNode[];
  links:     GraphLink[];
  truncated: boolean;
}

/** 某 entityType 的推荐起始焦点（最热标签）+ 其邻居 */
export async function getGraphFocus(entityType: string, limit = 50): Promise<GraphData> {
  return req<GraphData>(`/entity-graph/focus?entityType=${encodeURIComponent(entityType)}&limit=${limit}`);
}
/** 展开某节点（tag:<id> 或 entity:<type>:<id>）的邻居 */
export async function getGraphNeighbors(node: string, limit = 50): Promise<GraphData> {
  return req<GraphData>(`/entity-graph/neighbors?node=${encodeURIComponent(node)}&limit=${limit}`);
}

// ── 标签星系聚合视图（#101）────────────────────────────────────────
export interface GraphAggNode {
  id:          string; // "tag:<tagId>"
  label:       string;
  groupId:     string;
  groupSlug:   string;
  entityCount: number;
}
export interface GraphAggLink {
  source: string; // "tag:<tagId>"
  target: string; // "tag:<tagId>"
  weight: number; // 共现实体数
}
export interface GraphAggregateData {
  nodes: GraphAggNode[];
  links: GraphAggLink[];
}

/** 标签宇宙聚合：节点=标签，边=共现强度（节点上限 200，边上限 1000） */
export async function getGraphAggregate(entityType: string, minCooccurrence = 2): Promise<GraphAggregateData> {
  return req<GraphAggregateData>(
    `/entity-graph/aggregate?entityType=${encodeURIComponent(entityType)}&minCooccurrence=${minCooccurrence}`
  );
}

// ── LLM 配置 + 自然语言查询 ───────────────────────────────────────

export type LlmProvider = "anthropic" | "openai";

export interface LlmConfigPublic {
  provider?:   LlmProvider;
  model?:      string;
  baseUrl?:    string;
  hasApiKey:   boolean;
  apiKeyMask?: string;
  enabled:     boolean;
}

export interface LlmConfigUpdate {
  provider: LlmProvider;
  model:    string;
  /** 缺省=保持原值；空字符串=清空 */
  apiKey?:  string;
  baseUrl?: string;
  enabled:  boolean;
}

export async function getLlmConfig(): Promise<LlmConfigPublic> {
  return req<LlmConfigPublic>("/settings/llm");
}

export async function updateLlmConfig(body: LlmConfigUpdate): Promise<LlmConfigPublic> {
  return req<LlmConfigPublic>("/settings/llm", {
    method:  "PUT",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
}

export interface NlToDslResult {
  boolExpr?:   BoolExpr;
  explanation: string;
  model:       string;
}

export async function nlToDsl(text: string, entityType?: string): Promise<NlToDslResult> {
  return req<NlToDslResult>("/search/nl-to-dsl", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ text, entityType }),
  });
}

// ── Token 管理 ────────────────────────────────────────────────────

export interface ApiToken {
  id:         string;
  name:       string;
  role:       "reader" | "writer" | "reviewer" | "admin";
  scopes:     string[];
  createdAt:  string;
  lastUsedAt: string | null;
  revokedAt:  string | null;
}

export interface CreatedToken extends ApiToken {
  token: string; // 仅创建时返回一次
}

export async function listTokens(): Promise<ApiToken[]> {
  return req<ApiToken[]>("/tokens");
}

export async function createToken(body: {
  name:    string;
  role:    ApiToken["role"];
  scopes?: string[];
}): Promise<CreatedToken> {
  return req<CreatedToken>("/tokens", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
}

export async function revokeToken(id: string): Promise<void> {
  await req<unknown>(`/tokens/${id}`, { method: "DELETE" });
}

// ── 标签治理 ──────────────────────────────────────────────────────

export interface TagUsageItem {
  tagId:      string;
  name:       string;
  slug:       string;
  groupId:    string;
  groupName:  string;
  groupSlug:  string;
  usageCount: number;
  lastUsedAt: string | null;
}

export interface DeadTagItem {
  tagId:       string;
  name:        string;
  slug:        string;
  groupId:     string;
  groupName:   string;
  groupSlug:   string;
  depth:       number;
  activeCount: number;
  lastUsedAt:  string | null;
}

export interface DuplicatePair {
  sourceId:          string;
  sourceName:        string;
  sourceSlug:        string;
  targetId:          string;
  targetName:        string;
  targetSlug:        string;
  groupId:           string;
  groupName:         string;
  groupSlug:         string;
  similarity:        number;
  reason:            string;
  sharedEntityCount: number;
}

export async function getTagUsage(params?: {
  groupId?: string;
  period?:  "7d" | "14d" | "30d" | "90d" | "180d" | "1y" | "all";
  order?:   "asc" | "desc";
  limit?:   number;
}): Promise<{ period: string; items: TagUsageItem[] }> {
  const qs = new URLSearchParams();
  if (params?.groupId) qs.set("groupId", params.groupId);
  if (params?.period)  qs.set("period",  params.period);
  if (params?.order)   qs.set("order",   params.order);
  if (params?.limit)   qs.set("limit",   String(params.limit));
  const q = qs.toString();
  return req(`/governance/tag-usage${q ? `?${q}` : ""}`);
}

export async function getDeadTags(params?: {
  groupId?: string;
  period?:  "30d" | "90d" | "180d" | "1y";
  limit?:   number;
}): Promise<{ period: string; cutoff: string; items: DeadTagItem[] }> {
  const qs = new URLSearchParams();
  if (params?.groupId) qs.set("groupId", params.groupId);
  if (params?.period)  qs.set("period",  params.period);
  if (params?.limit)   qs.set("limit",   String(params.limit));
  const q = qs.toString();
  return req(`/governance/dead-tags${q ? `?${q}` : ""}`);
}

export async function getDuplicateSuggestions(params?: {
  groupId?:   string;
  threshold?: number;
  limit?:     number;
}): Promise<{ items: DuplicatePair[] }> {
  const qs = new URLSearchParams();
  if (params?.groupId)   qs.set("groupId",   params.groupId);
  if (params?.threshold) qs.set("threshold", String(params.threshold));
  if (params?.limit)     qs.set("limit",     String(params.limit));
  const q = qs.toString();
  return req(`/governance/duplicate-suggestions${q ? `?${q}` : ""}`);
}

export async function mergeTags(targetId: string, sourceIds: string[]): Promise<{ entityTagsMoved: number; aliasesMoved: number }> {
  return req(`/tags/${targetId}/merge`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ sourceIds }),
  });
}

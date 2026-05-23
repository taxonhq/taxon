const BASE  = process.env.NEXT_PUBLIC_TAG_SERVICE_URL   || "http://localhost:3300";
const TOKEN = process.env.NEXT_PUBLIC_TAG_SERVICE_TOKEN || "";

function authHeaders(): HeadersInit {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.message || `请求失败 ${res.status}`);
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
}): Promise<Paginated<TagGroup>> {
  const q = new URLSearchParams();
  params?.scope?.forEach(s => q.append("scope", s));
  if (params?.page) q.set("page", String(params.page));
  if (params?.pageSize) q.set("pageSize", String(params.pageSize));
  return req<Paginated<TagGroup>>(`/tag-groups${q.size ? `?${q}` : ""}`);
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

export async function deleteTagGroup(groupId: string, force = false): Promise<void> {
  await req<unknown>(`/tag-groups/${groupId}${force ? "?force=true" : ""}`, { method: "DELETE" });
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
  params?: { page?: number; pageSize?: number }
): Promise<Paginated<Tag>> {
  const q = new URLSearchParams();
  if (params?.page) q.set("page", String(params.page));
  if (params?.pageSize) q.set("pageSize", String(params.pageSize));
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

export async function deleteTag(tagId: string, force = false): Promise<void> {
  await req<unknown>(`/tags/${tagId}${force ? "?force=true" : ""}`, { method: "DELETE" });
}

// ── Entity Types ──────────────────────────────────────────────────

export async function getEntityTypes(): Promise<{ entityType: string; count: number }[]> {
  return req<{ entityType: string; count: number }[]>("/entity-types");
}

// ── Entity Registration ───────────────────────────────────────────

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
  page?: number;
  pageSize?: number;
}): Promise<Paginated<AuditItem>> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.entityType) q.set("entityType", params.entityType);
  if (params?.page) q.set("page", String(params.page));
  if (params?.pageSize) q.set("pageSize", String(params.pageSize));
  return req<Paginated<AuditItem>>(`/entities/audit${q.size ? `?${q}` : ""}`);
}

export async function updateEntityTagStatus(
  entityType: string,
  entityId: string,
  tagId: string,
  status: "active" | "rejected" | "pending",
  note?: string
): Promise<void> {
  await req<unknown>(`/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/tags/${tagId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, ...(note ? { note } : {}) }),
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

// ── Health ────────────────────────────────────────────────────────

export async function getHealth(): Promise<HealthInfo> {
  const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(4000) });
  return res.json() as Promise<HealthInfo>;
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

const BASE = process.env.NEXT_PUBLIC_TAG_SERVICE_URL || "http://localhost:3300";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.message || `请求失败 ${res.status}`);
  return data.data as T;
}

// ── 公共类型 ──────────────────────────────────────────────────────

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
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { entityTags: number };
}

export interface AuditItem {
  tagId: string;
  entityType: string;
  entityId: string;
  source: string;
  confidence: number | null;
  status: string;
  taggedAt: string;
  tag: {
    id: string;
    slug: string;
    name: string;
    group: { id: string; slug: string; name: string };
  };
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
  const res = await fetch(`${BASE}/tag-groups/${groupId}${force ? "?force=true" : ""}`, {
    method: "DELETE",
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.message);
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
}): Promise<Tag> {
  return req<Tag>(`/tags/${tagId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteTag(tagId: string, force = false): Promise<void> {
  const res = await fetch(`${BASE}/tags/${tagId}${force ? "?force=true" : ""}`, {
    method: "DELETE",
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.message);
}

// ── Entity Types ──────────────────────────────────────────────────

export async function getEntityTypes(): Promise<{ entityType: string; count: number }[]> {
  const res = await fetch(`${BASE}/entity-types`);
  const data = await res.json();
  return data.data ?? [];
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
  status: "active" | "rejected" | "pending"
): Promise<void> {
  const res = await fetch(`${BASE}/entities/${entityType}/${entityId}/tags/${tagId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.message);
}

export async function removeEntityTag(
  entityType: string,
  entityId: string,
  tagId: string
): Promise<void> {
  const res = await fetch(`${BASE}/entities/${entityType}/${entityId}/tags/${tagId}`, {
    method: "DELETE",
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.message);
}

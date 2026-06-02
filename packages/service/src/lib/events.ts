/**
 * 领域事件定义 + Outbox 写入助手（#34 Webhook + outbox pattern）。
 *
 * 业务变更在「同事务」内通过 emitEvent 写入 EventOutbox，由 webhook-worker
 * 异步 fan-out 到匹配的 Webhook。保证「业务提交则事件必达」（至少一次语义）。
 *
 * 约定：带 entityType 的事件，payload 顶层须含 `entityType` 字段，供 webhook
 * 的 scopes（entityType 白名单）匹配。
 */
import type { Prisma } from '@prisma/client'
import type { Tx } from './db.js'

// ── 事件清单（v1）────────────────────────────────────────────────
export const WEBHOOK_EVENTS = [
  'entity_tag.created',
  'entity_tag.status_changed',
  'entity_tag.deleted',
  'tag.created',
  'tag.updated',
  'tag.deleted',
  'tag.merged',
  'tag.moved',
  'tag_group.created',
  'tag_group.updated',
  'tag_group.deleted',
  'entity.registered',
  'entity.unregistered',
] as const

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

const EVENT_SET = new Set<string>(WEBHOOK_EVENTS)
export function isValidEvent(e: string): e is WebhookEvent {
  return EVENT_SET.has(e)
}

/**
 * 写入一条领域事件到 outbox。不发送 HTTP——只持久化，worker 负责投递。
 * 须在业务事务内调用（传入 tx）以保证「业务提交则事件必达」一致性。
 * payload 会原样存库；带 entityType 的事件请在 payload 顶层带上 entityType。
 */
export async function emitEvent(
  db: Tx,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.eventOutbox.create({
    data: { event, payload: payload as Prisma.InputJsonValue },
  })
}

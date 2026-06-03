/**
 * Webhook 投递 worker（#34 outbox pattern）。
 *
 * 两阶段：
 *   1. fan-out：未发布的 EventOutbox → 匹配的 Webhook → 生成 WebhookDelivery（pending），
 *      并标记 outbox 已发布。fan-out 与标记在同事务内，避免重复 fan-out。
 *   2. deliver：取到期的 pending 投递 → HMAC 签名 POST → 成功标 success；
 *      失败按指数退避重排（封顶 24h），超过最大次数标 failed。
 *
 * 至少一次语义：业务事务提交即写 outbox；fan-out 幂等（publishedAt 标记）；
 * 投递可能重复（接收方应按 X-Taxon-Delivery 去重）。
 */
import { createHmac } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import prisma from './db.js'
import logger from './logger.js'

// 指数退避（秒）：约 1m → 5m → 30m → 2h → 6h → 24h，共 6 次重试后判定 failed。
// MAX_ATTEMPTS = 初次投递 + 6 次重试 = length + 1，确保最后一档 24h 退避会被真正用到
// （#136：原 MAX_ATTEMPTS = length 导致 24h 档永不命中）。
export const RETRY_DELAYS_SEC = [60, 300, 1800, 7200, 21600, 86400] as const
export const MAX_ATTEMPTS = RETRY_DELAYS_SEC.length + 1

// 单轮投递的并发上限：避免逐条串行时单个慢/挂起端点造成队头阻塞（#136）。
const DELIVER_CONCURRENCY = 10

const FANOUT_BATCH = 200
const DELIVER_BATCH = 100
const REQUEST_TIMEOUT_MS = 10_000

type FetchImpl = typeof fetch

/** HMAC-SHA256 签名，返回 `sha256=<hex>` 形式（对标 GitHub）。 */
export function signBody(secret: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

/** 序列化投递请求体（签名对象与发送对象一致）。 */
export function buildDeliveryBody(event: string, deliveryId: string, payload: unknown, createdAt: Date): string {
  return JSON.stringify({ id: deliveryId, event, createdAt: createdAt.toISOString(), data: payload })
}

/** 事件是否命中某 webhook 的 scopes（entityType 白名单；空=全部）。 */
function scopeMatches(scopes: string[], payload: unknown): boolean {
  if (scopes.length === 0) return true
  const et = (payload as { entityType?: unknown } | null)?.entityType
  return typeof et === 'string' && scopes.includes(et)
}

/**
 * 阶段 1：把未发布的 outbox 事件 fan-out 成 WebhookDelivery。
 * @returns 生成的投递条数
 */
export async function fanOutOnce(): Promise<number> {
  const pending = await prisma.eventOutbox.findMany({
    where: { publishedAt: null },
    orderBy: { createdAt: 'asc' },
    take: FANOUT_BATCH,
  })
  if (pending.length === 0) return 0

  const webhooks = await prisma.webhook.findMany({ where: { active: true } })
  let created = 0
  const now = new Date()

  for (const ev of pending) {
    const matched = webhooks.filter(w => w.events.includes(ev.event) && scopeMatches(w.scopes, ev.payload))
    // 原子化：生成投递 + 标记 outbox 已发布在同一事务，崩溃不会重复 fan-out（#136，对齐文件头注释）
    await prisma.$transaction(async (tx) => {
      if (matched.length > 0) {
        await tx.webhookDelivery.createMany({
          data: matched.map(w => ({
            webhookId: w.id,
            event: ev.event,
            payload: ev.payload as Prisma.InputJsonValue,
            status: 'pending',
            nextRetryAt: now,
          })),
        })
      }
      await tx.eventOutbox.update({ where: { id: ev.id }, data: { publishedAt: now } })
    })
    created += matched.length
  }
  return created
}

/** 单条投递发送 + 状态落库。导出供 replay 复用。 */
export async function deliverOne(
  delivery: { id: string; webhookId: string; event: string; payload: unknown; attempts: number; createdAt: Date },
  webhook: { url: string; secret: string },
  fetchImpl: FetchImpl = fetch,
): Promise<boolean> {
  const body = buildDeliveryBody(delivery.event, delivery.id, delivery.payload, delivery.createdAt)
  const attempt = delivery.attempts + 1
  let code: number | null = null
  let respText: string | null = null
  let ok = false

  try {
    const res = await fetchImpl(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Taxon-Webhook/1.0',
        'X-Taxon-Event': delivery.event,
        'X-Taxon-Delivery': delivery.id,
        'X-Taxon-Signature': signBody(webhook.secret, body),
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    code = res.status
    respText = (await res.text().catch(() => '')).slice(0, 1000)
    ok = res.status >= 200 && res.status < 300
  } catch (e) {
    respText = `request error: ${(e as Error).message}`.slice(0, 1000)
  }

  if (ok) {
    await prisma.$transaction([
      prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'success', attempts: attempt, responseCode: code, responseBody: respText, deliveredAt: new Date(), nextRetryAt: null },
      }),
      prisma.webhook.update({ where: { id: delivery.webhookId }, data: { lastFiredAt: new Date() } }),
    ])
    return true
  }

  // 失败：重排或判死
  const exhausted = attempt >= MAX_ATTEMPTS
  const delaySec = RETRY_DELAYS_SEC[Math.min(delivery.attempts, RETRY_DELAYS_SEC.length - 1)]
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status: exhausted ? 'failed' : 'pending',
      attempts: attempt,
      responseCode: code,
      responseBody: respText,
      nextRetryAt: exhausted ? null : new Date(Date.now() + delaySec * 1000),
    },
  })
  return false
}

/**
 * 阶段 2：投递所有到期的 pending 投递。
 * @returns { delivered, failed } 本轮成功/失败计数
 */
export async function deliverPendingOnce(fetchImpl: FetchImpl = fetch): Promise<{ delivered: number; failed: number }> {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: 'pending', nextRetryAt: { lte: new Date() } },
    orderBy: { nextRetryAt: 'asc' },
    take: DELIVER_BATCH,
    include: { webhook: { select: { url: true, secret: true } } },
  })

  let delivered = 0
  let failed = 0
  // 有界并发：分片 DELIVER_CONCURRENCY 条一组并行，单个慢端点只拖累同组，不阻塞全批（#136）
  for (let i = 0; i < due.length; i += DELIVER_CONCURRENCY) {
    const slice = due.slice(i, i + DELIVER_CONCURRENCY)
    const results = await Promise.all(slice.map(d =>
      deliverOne(
        { id: d.id, webhookId: d.webhookId, event: d.event, payload: d.payload, attempts: d.attempts, createdAt: d.createdAt },
        d.webhook,
        fetchImpl,
      ),
    ))
    for (const ok of results) {
      if (ok) delivered++
      else failed++
    }
  }
  return { delivered, failed }
}

/** 跑一轮完整流程（fan-out + deliver）。测试直接调用此函数。 */
export async function processOutboxOnce(fetchImpl: FetchImpl = fetch): Promise<{ fannedOut: number; delivered: number; failed: number }> {
  const fannedOut = await fanOutOnce()
  const { delivered, failed } = await deliverPendingOnce(fetchImpl)
  return { fannedOut, delivered, failed }
}

let timer: ReturnType<typeof setInterval> | null = null
let running = false

/** 启动后台 worker（生产环境）。返回 stop 函数。 */
export function startWebhookWorker(intervalMs = 5_000): () => void {
  if (timer) return () => {}
  timer = setInterval(async () => {
    if (running) return // 防重入
    running = true
    try {
      const r = await processOutboxOnce()
      if (r.fannedOut || r.delivered || r.failed) {
        logger.debug({ ...r }, 'webhook worker tick')
      }
    } catch (e) {
      logger.error({ err: e }, 'webhook worker error')
    } finally {
      running = false
    }
  }, intervalMs)
  logger.info({ intervalMs }, 'webhook worker started')
  return () => { if (timer) { clearInterval(timer); timer = null } }
}

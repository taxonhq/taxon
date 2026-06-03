/**
 * In-memory sliding-window rate limiter.
 *
 * Usage:
 *   import { rateLimit } from './middleware/rate-limit.js'
 *
 *   // 100 requests per minute per IP
 *   app.use('/api/*', rateLimit({ windowMs: 60_000, max: 100 }))
 *
 * Implementation notes:
 * - Uses a sliding window (timestamp list per key) — more accurate than
 *   fixed-window but bounded to `max` timestamps per key in memory.
 * - Key is derived from X-Forwarded-For (first IP in the chain), falling
 *   back to the raw remote address.  Trust only when behind a known proxy.
 * - NOT cluster-safe: each Node.js process maintains its own counter.
 *   For multi-process deployments, replace with Redis-backed sliding window.
 */

import type { MiddlewareHandler } from 'hono'
import logger from '../lib/logger.js'

interface RateLimitOptions {
  /** Time window in milliseconds. Default: 60 000 (1 minute). */
  windowMs?: number
  /** Maximum requests allowed per window per key. Default: 120. */
  max?: number
  /**
   * If provided, only these HTTP methods are subject to rate limiting.
   * Other methods pass through without consuming quota.
   * Example: ['POST', 'PUT', 'PATCH', 'DELETE']
   */
  methods?: string[]
  /**
   * Function to derive the rate-limit key from the request.
   * Defaults to the client's IP address.
   */
  keyFn?: (c: Parameters<MiddlewareHandler>[0]) => string
  /**
   * Optional label shown in log messages and the Retry-After header comment.
   * Useful when multiple limiters are applied to different route groups.
   */
  label?: string
}

/** Sliding-window bucket: array of request timestamps (ms since epoch). */
const buckets = new Map<string, number[]>()

/**
 * Trusted-proxy hop count. X-Forwarded-For is only honored when running behind
 * a known reverse proxy; otherwise the header is client-controlled and trivially
 * spoofable to bypass the limiter (#135). Set TRUST_PROXY_HOPS=N to the number of
 * trusted proxies appending to XFF (the real client IP is the Nth-from-last entry).
 * Default 0 = ignore XFF, use the socket peer address.
 */
const TRUST_PROXY_HOPS = Math.max(0, Math.floor(Number(process.env.TRUST_PROXY_HOPS) || 0))

/** Hard cap on distinct keys to bound memory against spoofed-IP key explosion (#135). */
const MAX_BUCKETS = 50_000

function socketAddr(c: Parameters<MiddlewareHandler>[0]): string {
  return (
    (c.env as { incoming?: { socket?: { remoteAddress?: string } } })?.incoming?.socket?.remoteAddress ||
    'unknown'
  )
}

/** Derive the client IP, trusting XFF only when explicitly configured. */
function clientIp(c: Parameters<MiddlewareHandler>[0]): string {
  if (TRUST_PROXY_HOPS > 0) {
    const chain = (c.req.header('x-forwarded-for') ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const idx = chain.length - TRUST_PROXY_HOPS
    if (idx >= 0 && chain[idx]) return chain[idx]
  }
  return socketAddr(c)
}

/** Periodic cleanup — drop empty buckets to prevent unbounded memory growth. */
setInterval(() => {
  const now = Date.now()
  for (const [key, ts] of buckets) {
    // Keep only entries that are still in any potential window (use max 1 hour)
    const pruned = ts.filter(t => now - t < 3_600_000)
    if (pruned.length === 0) buckets.delete(key)
    else buckets.set(key, pruned)
  }
}, 5 * 60_000) // run every 5 minutes

/**
 * Returns a Hono middleware that enforces a sliding-window rate limit.
 */
export function rateLimit({
  windowMs = 60_000,
  max = 120,
  methods,
  keyFn,
  label = 'default',
}: RateLimitOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    // If a method filter is set, let non-matching methods pass through freely.
    if (methods && !methods.includes(c.req.method)) return next()

    const key = keyFn ? keyFn(c) : clientIp(c)

    const now = Date.now()
    const cutoff = now - windowMs
    const prev = buckets.get(key)
    // Bound memory: evict the oldest-inserted bucket when at cap and seeing a new key.
    if (prev === undefined && buckets.size >= MAX_BUCKETS) {
      const oldest = buckets.keys().next().value
      if (oldest !== undefined) buckets.delete(oldest)
    }
    // Slide the window: drop timestamps older than cutoff
    const current = (prev ?? []).filter(t => t > cutoff)

    if (current.length >= max) {
      const oldestInWindow = current[0]
      const retryAfterMs = Math.ceil((oldestInWindow + windowMs - now) / 1000)

      logger.warn({ key, count: current.length, max, label }, 'Rate limit exceeded')

      c.header('Retry-After', String(retryAfterMs))
      c.header('X-RateLimit-Limit', String(max))
      c.header('X-RateLimit-Remaining', '0')
      c.header('X-RateLimit-Reset', String(Math.ceil((oldestInWindow + windowMs) / 1000)))
      return c.json({ code: 429, message: '请求过于频繁，请稍后再试' }, 429)
    }

    // Record this request
    current.push(now)
    buckets.set(key, current)

    c.header('X-RateLimit-Limit', String(max))
    c.header('X-RateLimit-Remaining', String(max - current.length))
    c.header('X-RateLimit-Reset', String(Math.ceil((current[0] + windowMs) / 1000)))

    return next()
  }
}

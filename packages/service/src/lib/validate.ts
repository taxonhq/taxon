/**
 * zParse — thin wrapper around Zod for Hono route handlers.
 *
 * Usage:
 *   const body = await zParse(c, CreateTagGroupBody)
 *   if (!body.ok) return body.error   // c.json(400) already returned
 *   const { slug, name } = body.data
 */

import type { Context } from 'hono'
import type { ZodType } from 'zod'
import { ZodError } from 'zod'

type ParseSuccess<T> = { ok: true;  data: T }
type ParseFailure    = { ok: false; error: Response }

/**
 * Parse and validate the JSON request body using a Zod schema.
 * Returns `{ ok: true, data }` on success or `{ ok: false, error }` on failure.
 * The `error` is a ready-to-return Hono `Response` (HTTP 400).
 */
export async function zParse<T>(
  c: Context,
  schema: ZodType<T>,
): Promise<ParseSuccess<T> | ParseFailure> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return {
      ok: false,
      error: c.json({ code: 400, message: '请求体必须为合法的 JSON' }, 400) as unknown as Response,
    }
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    const message = formatZodError(result.error)
    return {
      ok: false,
      error: c.json({ code: 400, message }, 400) as unknown as Response,
    }
  }

  return { ok: true, data: result.data }
}

/**
 * Format the first Zod issue into a human-friendly Chinese error message.
 */
function formatZodError(error: ZodError): string {
  const issue = error.issues[0]
  if (!issue) return '请求体格式不合法'

  const field = issue.path.join('.')
  const prefix = field ? `${field}: ` : ''

  // Zod v4 issue codes
  switch (issue.code) {
    case 'invalid_type':
      return `${prefix}类型不合法`
    case 'too_small':
      return (issue as { minimum?: number }).minimum === 1
        ? `${prefix}不能为空`
        : `${prefix}最小长度/值为 ${(issue as { minimum?: number }).minimum ?? ''}`
    case 'too_big':
      return `${prefix}最大长度/值为 ${(issue as { maximum?: number }).maximum ?? ''}`
    case 'invalid_format':  // Zod v4: replaces 'invalid_string'
      return `${prefix}${issue.message}`
    case 'invalid_value':   // Zod v4: replaces 'invalid_enum_value'
      return `${prefix}${issue.message}`
    case 'invalid_union':
      return `${prefix}格式不合法`
    default:
      return `${prefix}${issue.message}`
  }
}

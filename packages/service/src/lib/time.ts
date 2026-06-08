/**
 * 应用级「日界」时区处理（#148）。
 *
 * 后端所有「今日 / 趋势」原本写死按 UTC 日切，但前端按本地时区展示，导致非 UTC
 * 用户的统计口径与界面日期错位。这里统一按 APP_TZ_OFFSET_MIN 指定的固定时区偏移做日切。
 *
 * APP_TZ_OFFSET_MIN：相对 UTC 的分钟偏移（东区为正）。默认 0 = UTC（保持原行为）。
 *   例：中国标准时间 UTC+8 → 480。
 * 注：采用固定偏移、不处理夏令时；对无 DST 的时区（如中国）完全精确。
 */
export const APP_TZ_OFFSET_MIN = Math.trunc(Number(process.env.APP_TZ_OFFSET_MIN) || 0)

const OFFSET_MS = APP_TZ_OFFSET_MIN * 60_000
const DAY_MS = 86_400_000

/** 本地（按偏移）某日 0 点对应的 UTC 时刻；daysAgo 向前推 N 天。 */
export function localDayStartUTC(daysAgo = 0, now: Date = new Date()): Date {
  const shifted = now.getTime() + OFFSET_MS
  const dayStartShifted = Math.floor(shifted / DAY_MS) * DAY_MS - daysAgo * DAY_MS
  return new Date(dayStartShifted - OFFSET_MS)
}

/** 给定 UTC 时刻，返回其在本地时区（按偏移）的 YYYY-MM-DD。 */
export function localDayKey(d: Date): string {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10)
}

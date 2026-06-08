export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * 应用级时区偏移（分钟，东区为正），与后端 APP_TZ_OFFSET_MIN 对齐（#148）。
 * 默认 0 = UTC，保持原行为；UTC+8 配 480。
 */
export const APP_TZ_OFFSET_MIN = Math.trunc(
  Number(process.env.NEXT_PUBLIC_APP_TZ_OFFSET_MIN) || 0
);

/** 本地（按偏移）某日 0 点对应的 UTC 时刻；daysAgo 向前推 N 天。与后端 localDayStartUTC 一致。 */
export function localDayStartUTC(daysAgo = 0, now: Date = new Date()): Date {
  const offsetMs = APP_TZ_OFFSET_MIN * 60_000;
  const dayMs = 86_400_000;
  const shifted = now.getTime() + offsetMs;
  const dayStartShifted = Math.floor(shifted / dayMs) * dayMs - daysAgo * dayMs;
  return new Date(dayStartShifted - offsetMs);
}

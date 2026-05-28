import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { LOCALES, type Locale } from './routing';

const DEFAULT: Locale = 'zh-CN';

export default getRequestConfig(async () => {
  // 1. Read from cookie (user / session preference)
  const cookieStore = await cookies();
  const raw = cookieStore.get('taxon-locale')?.value;
  let locale: Locale = (LOCALES as readonly string[]).includes(raw ?? '') ? (raw as Locale) : DEFAULT;

  // 2. If no cookie, try system-level default from service
  if (!raw) {
    try {
      const base = process.env.NEXT_PUBLIC_TAG_SERVICE_URL ?? 'http://localhost:3300';
      const token = process.env.NEXT_PUBLIC_TAG_SERVICE_TOKEN ?? '';
      const res = await fetch(`${base}/settings/system`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal:  AbortSignal.timeout(500),
        cache:   'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        const sysLocale = data?.data?.locale;
        if ((LOCALES as readonly string[]).includes(sysLocale)) locale = sysLocale as Locale;
      }
    } catch { /* fall through to default */ }
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});

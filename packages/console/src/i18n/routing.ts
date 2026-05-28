import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales:       ['zh-CN', 'en-US'] as const,
  defaultLocale: 'zh-CN',
  localePrefix:  'never', // no URL prefix — locale determined by cookie
});

export type Locale = (typeof routing.locales)[number];
export const LOCALES = routing.locales;

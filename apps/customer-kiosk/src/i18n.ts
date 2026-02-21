import { en } from './locales/en';
import { es } from './locales/es';
import { createContext, useContext, useMemo, createElement, type ReactNode } from 'react';

/**
 * Customer Kiosk i18n
 *
 * - Locale files live in `src/locales/en.ts` and `src/locales/es.ts`
 * - Add new keys to `en.ts` first, then add the same key to `es.ts`
 * - Runtime fallback behavior: if a key is missing in ES, we fall back to EN, then to the key
 * - Placeholders: use `{param}` and pass `{ param: value }` to `t()`
 */

export type Language = 'EN' | 'ES';

export const translations: Record<Language, Record<string, string>> = {
  EN: en,
  ES: es,
};

type I18nContextValue = {
  lang: Language;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue>({
  lang: 'EN',
  t: (key, params) => t('EN', key, params),
});

export function I18nProvider({
  lang,
  children,
}: {
  lang: Language | null | undefined;
  children: ReactNode;
}) {
  const language: Language = lang || 'EN';
  const value = useMemo<I18nContextValue>(
    () => ({
      lang: language,
      t: (key, params) => t(language, key, params),
    }),
    [language]
  );
  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n() {
  return useContext(I18nContext);
}

export function t(
  lang: Language | null | undefined,
  key: string,
  params?: Record<string, string | number>
): string {
  const language = lang || 'EN';
  let text = translations[language][key] || translations.EN[key] || key;

  if (params) {
    Object.entries(params).forEach(([paramKey, value]) => {
      text = text.replace(`{${paramKey}}`, String(value));
    });
  }

  return text;
}

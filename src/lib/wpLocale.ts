export type WpLocale = 'ar' | 'en';

export const WP_LOCALE_KEY = 'rakWp.locale';

export function getStoredWpLocale(): WpLocale {
  try {
    return localStorage.getItem(WP_LOCALE_KEY) === 'en' ? 'en' : 'ar';
  } catch {
    return 'ar';
  }
}

export function storeWpLocale(locale: WpLocale) {
  try {
    localStorage.setItem(WP_LOCALE_KEY, locale);
  } catch {}
}

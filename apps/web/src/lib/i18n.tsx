'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Locale = 'en' | 'ar';

const en = {
  'nav.free': '🚚 Free delivery on orders over AED 100',
  'nav.tagline': 'Track prices · Get alerts · Buy at the right time',
  'nav.search': 'Search electronics: laptops, phones, headphones…',
  'nav.hello': 'Hello',
  'nav.account': 'Account',
  'nav.wishlist': 'Wishlist',
  'nav.alerts': 'Alerts',
  'nav.cart': 'Cart',
  'nav.signin': 'Sign in',
  'nav.create': 'Create account',
  'nav.signout': 'Sign out',
  'nav.browse': 'Browse products',
  'nav.yourWishlists': 'Your wishlists',
  'nav.notifications': 'Notifications',
  'nav.settings': 'Notification settings',
  'nav.yourCart': 'Your cart',
  'nav.lang': 'العربية',
  'cart.add': 'Add to cart',
  'cart.adding': 'Adding…',
  'cart.inCart': 'in cart',
  'cart.out': 'Out of stock',
  'cart.goto': 'Go to cart',
  'pred.title': 'Buy now or wait?',
  'pred.buy': 'Good time to buy',
  'pred.wait': 'Consider waiting',
  'pred.none': 'Not enough data yet',
  'pred.note': 'Based on past prices. Not financial advice.',
  'similar.title': 'Similar products',
  'share.btn': 'Share',
  'share.copied': 'Share link copied',
  'settings.title': 'Notification settings',
  'settings.save': 'Save settings',
  'settings.saved': 'Settings saved',
} as const;

type Key = keyof typeof en;

const ar: Record<Key, string> = {
  'nav.free': '🚚 توصيل مجاني للطلبات فوق 100 درهم',
  'nav.tagline': 'تتبّع الأسعار · استلم التنبيهات · اشترِ في الوقت المناسب',
  'nav.search': 'ابحث في الإلكترونيات: لابتوبات، هواتف، سماعات…',
  'nav.hello': 'مرحباً',
  'nav.account': 'الحساب',
  'nav.wishlist': 'المفضلة',
  'nav.alerts': 'التنبيهات',
  'nav.cart': 'السلة',
  'nav.signin': 'تسجيل الدخول',
  'nav.create': 'إنشاء حساب',
  'nav.signout': 'تسجيل الخروج',
  'nav.browse': 'تصفّح المنتجات',
  'nav.yourWishlists': 'قوائم أمنياتي',
  'nav.notifications': 'الإشعارات',
  'nav.settings': 'إعدادات الإشعارات',
  'nav.yourCart': 'سلتي',
  'nav.lang': 'English',
  'cart.add': 'أضف إلى السلة',
  'cart.adding': 'جارٍ الإضافة…',
  'cart.inCart': 'في السلة',
  'cart.out': 'نفد من المخزون',
  'cart.goto': 'اذهب إلى السلة',
  'pred.title': 'اشترِ الآن أم انتظر؟',
  'pred.buy': 'وقت جيد للشراء',
  'pred.wait': 'يُفضّل الانتظار',
  'pred.none': 'لا توجد بيانات كافية بعد',
  'pred.note': 'بناءً على الأسعار السابقة. ليست نصيحة مالية.',
  'similar.title': 'منتجات مشابهة',
  'share.btn': 'مشاركة',
  'share.copied': 'تم نسخ رابط المشاركة',
  'settings.title': 'إعدادات الإشعارات',
  'settings.save': 'حفظ الإعدادات',
  'settings.saved': 'تم حفظ الإعدادات',
};

const DICT: Record<Locale, Record<Key, string>> = { en, ar };

interface Ctx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (k: Key) => string;
}

const I18nContext = createContext<Ctx>({ locale: 'en', setLocale: () => undefined, t: (k) => en[k] });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  // restore the saved language after the first render (avoids a server/client mismatch)
  useEffect(() => {
    const saved = window.localStorage.getItem('locale');
    if (saved === 'ar' || saved === 'en') void Promise.resolve().then(() => setLocaleState(saved));
  }, []);

  // flip the whole page direction for Arabic
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    window.localStorage.setItem('locale', l);
  }, []);

  const t = useCallback((k: Key) => DICT[locale][k] ?? en[k], [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
export const useT = () => useContext(I18nContext).t;
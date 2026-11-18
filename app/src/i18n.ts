import { useSyncExternalStore } from 'react';
import { AR } from './i18n.ar';

/* English / Arabic.
   Strings are written in English in the code and wrapped in t(); the Arabic dictionary (i18n.ar.ts)
   maps each English string to its Arabic. Anything missing falls back to English, and
   `npm run check:i18n` lists strings that still need a translation.
   {name} in a string is filled from the second argument: t('Hello {name}', { name }). */

export type Lang = 'en' | 'ar';
const KEY = 'cm-lang';

function initial(): Lang {
  try { const v = localStorage.getItem(KEY); if (v === 'en' || v === 'ar') return v; } catch { /* private mode */ }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

let current: Lang = initial();
const listeners = new Set<() => void>();

function apply() {
  document.documentElement.lang = current;
  document.documentElement.dir = current === 'ar' ? 'rtl' : 'ltr';
}
apply();

export const lang = () => current;
export const isRtl = () => current === 'ar';
/** Locale for dates and numbers. Arabic uses the Gregorian calendar and Western digits, to match amounts and the week layout. */
export const locale = () => (current === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-GB');

export function setLang(l: Lang) {
  if (l === current) return;
  current = l;
  try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
  apply();
  listeners.forEach(f => f());
}

/** Run fn whenever the language changes. Returns an unsubscribe function. */
export function subscribeLang(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

export function useLang(): Lang {
  return useSyncExternalStore(f => { listeners.add(f); return () => listeners.delete(f); }, () => current);
}

export function t(s: string, vars?: Record<string, string | number | undefined | null>): string {
  let out = current === 'ar' ? (AR[s] ?? s) : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (_: string, k: string) => (vars[k] == null ? '' : String(vars[k])));
  return out;
}

/** Counted nouns. English: one/many. Arabic: 1, 2, 3–10, 11+ (e.g. إدخال واحد، إدخالان، ٣ إدخالات، ١١ إدخالاً). */
const NOUNS: Record<string, { en: [string, string]; ar: [string, string, string, string] }> = {
  entry: { en: ['{n} entry', '{n} entries'], ar: ['إدخال واحد', 'إدخالان', '{n} إدخالات', '{n} إدخالاً'] },
  slot: { en: ['{n} open slot', '{n} open slots'], ar: ['خانة متاحة واحدة', 'خانتان متاحتان', '{n} خانات متاحة', '{n} خانة متاحة'] },
  child: { en: ['{n} child', '{n} children'], ar: ['طفل واحد', 'طفلان', '{n} أطفال', '{n} طفلاً'] },
  item: { en: ['{n} to confirm', '{n} to confirm'], ar: ['دفعة واحدة للتأكيد', 'دفعتان للتأكيد', '{n} دفعات للتأكيد', '{n} دفعة للتأكيد'] },
};
export function count(noun: keyof typeof NOUNS, n: number): string {
  const f = NOUNS[noun];
  const s = current === 'ar' ? f.ar[n === 1 ? 0 : n === 2 ? 1 : n >= 3 && n <= 10 ? 2 : 3] : f.en[n === 1 ? 0 : 1];
  return s.replace('{n}', String(n));
}

/** Toggle shown in the header: names the other language in its own script. */
export const otherLangLabel = () => (current === 'ar' ? 'English' : 'العربية');

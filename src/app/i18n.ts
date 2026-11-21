/**
 * Minimal i18n: English source strings are the keys, translations live in src/content/i18n.cs.ts.
 * Missing translations fall back to English. Placeholders: t('Hello {name}', { name }).
 * Changing the language remounts the app (see App.tsx), so components need no subscriptions.
 */
import { CS } from '../content/i18n.cs';
import { createStore, storage } from './store';

export type Lang = 'en' | 'cs';
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'cs', label: 'Čeština' },
];

const initial = (): Lang => {
  const saved = storage.read<Lang | null>('cas.lang', null);
  if (saved === 'en' || saved === 'cs') return saved;
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('cs') ? 'cs' : 'en';
};

export const langStore = createStore<Lang>(typeof window === 'undefined' ? 'en' : initial());

export function setLang(lang: Lang) {
  storage.write('cas.lang', lang);
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  langStore.set(() => lang);
}

export function t(source: string, vars?: Record<string, string | number>): string {
  let s = langStore.get() === 'cs' ? (CS[source] ?? source) : source;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/**
 * Singular/plural with English keys: plural(n, '{n} project', '{n} projects').
 * Czech uses the "other" translation for 2–4 and the key "<other>|many" for 0 and 5+.
 */
export function plural(n: number, one: string, other: string): string {
  if (langStore.get() === 'cs' && n !== 1 && !(n >= 2 && n <= 4)) {
    const many = CS[`${other}|many`];
    if (many) return many.split('{n}').join(String(n));
  }
  return t(n === 1 ? one : other, { n });
}

export const locale = () => (langStore.get() === 'cs' ? 'cs-CZ' : 'en-GB');

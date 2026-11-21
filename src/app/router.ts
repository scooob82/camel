import { useSyncExternalStore } from 'react';

/**
 * Hash router. Hash URLs work on plain static hosting (Apache, no rewrites).
 * Routes: /, /dashboard, /builder/:id, /kb, /kb/:slug, /terms, /privacy,
 *         /login, /register, /forgot, /reset/:token, /verify/:token, /account, /s/:token
 */
export type Route =
  | { name: 'landing' }
  | { name: 'dashboard' }
  | { name: 'builder'; id: string }
  | { name: 'kb' }
  | { name: 'recipe'; slug: string }
  | { name: 'terms' }
  | { name: 'privacy' }
  | { name: 'login' }
  | { name: 'register' }
  | { name: 'forgot' }
  | { name: 'reset'; token: string }
  | { name: 'verify'; token: string }
  | { name: 'account' }
  | { name: 'shared'; token: string }
  | { name: 'notFound'; path: string };

export function parse(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return { name: 'landing' };
  const [a, b] = parts;
  if (a === 'dashboard' && !b) return { name: 'dashboard' };
  if (a === 'builder' && b) return { name: 'builder', id: decodeURIComponent(b) };
  if (a === 'kb' && !b) return { name: 'kb' };
  if (a === 'kb' && b) return { name: 'recipe', slug: decodeURIComponent(b) };
  if (a === 'terms') return { name: 'terms' };
  if (a === 'privacy') return { name: 'privacy' };
  if (a === 'login') return { name: 'login' };
  if (a === 'register') return { name: 'register' };
  if (a === 'forgot') return { name: 'forgot' };
  if (a === 'account') return { name: 'account' };
  if (a === 'reset' && b) return { name: 'reset', token: b };
  if (a === 'verify' && b) return { name: 'verify', token: b };
  if (a === 's' && b) return { name: 'shared', token: b };
  return { name: 'notFound', path };
}

const subscribe = (l: () => void) => {
  window.addEventListener('hashchange', l);
  return () => window.removeEventListener('hashchange', l);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parse(hash);
}

export function navigate(path: string) {
  const next = `#${path}`;
  if (window.location.hash !== next) window.location.hash = next;
  window.scrollTo({ top: 0 });
}

export const href = (path: string) => `#${path}`;

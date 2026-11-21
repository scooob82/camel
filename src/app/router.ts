import { useSyncExternalStore } from 'react';

/**
 * Hash router. Hash URLs work on plain static hosting (Apache, no rewrites).
 * Routes: /, /dashboard, /builder/:id, /kb, /kb/:slug, /terms, /privacy
 */
export type Route =
  | { name: 'landing' }
  | { name: 'dashboard' }
  | { name: 'builder'; id: string }
  | { name: 'kb' }
  | { name: 'recipe'; slug: string }
  | { name: 'terms' }
  | { name: 'privacy' }
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

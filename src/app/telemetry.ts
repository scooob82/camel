/**
 * Privacy-friendly telemetry:
 * - page views → daily counters per path on our own API (no cookies, nothing personal)
 * - client errors → /api/v1/telemetry/error (visible in the admin)
 * Optional third-party tools (configure in public/config.js): Sentry loader script, Plausible.
 */
import { api } from './api';
import { authStore } from './session';

declare global {
  interface Window {
    CAS_CONFIG?: { sentryLoader?: string; plausibleDomain?: string; plausibleSrc?: string; telemetry?: boolean };
  }
}

const enabled = () => window.CAS_CONFIG?.telemetry !== false;
const apiReady = () => {
  const s = authStore.get().status;
  return s === 'anonymous' || s === 'authenticated';
};

let lastPath = '';
export function trackPageview() {
  if (!enabled() || !apiReady()) return;
  const path = (window.location.hash.replace(/^#/, '') || '/').split('?')[0];
  if (path === lastPath) return;
  lastPath = path;
  api('POST', '/telemetry/pageview', { path }).catch(() => undefined);
}

let reported = 0;
const seen = new Set<string>();
function report(message: string, stack?: string) {
  if (!enabled() || !apiReady() || reported >= 5 || seen.has(message)) return;
  seen.add(message);
  reported++;
  api('POST', '/telemetry/error', { message: message.slice(0, 500), stack: stack?.slice(0, 4000), url: window.location.hash.replace(/^#/, '') || '/' }).catch(() => undefined);
}

function addScript(src: string, attrs: Record<string, string> = {}) {
  const s = document.createElement('script');
  s.src = src;
  s.defer = true;
  s.crossOrigin = 'anonymous';
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  document.head.appendChild(s);
}

export function initTelemetry() {
  window.addEventListener('error', (e) => report(e.message || 'Script error', e.error?.stack));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string; stack?: string; status?: number } | undefined;
    if (r && typeof r.status === 'number') return; // API errors are handled in the UI
    report(r?.message ?? String(e.reason), r?.stack);
  });
  window.addEventListener('hashchange', trackPageview);
  authStore.subscribe(trackPageview);
  const cfg = window.CAS_CONFIG ?? {};
  if (cfg.sentryLoader) addScript(cfg.sentryLoader);
  if (cfg.plausibleDomain) addScript(cfg.plausibleSrc ?? 'https://plausible.io/js/script.hash.js', { 'data-domain': cfg.plausibleDomain });
}

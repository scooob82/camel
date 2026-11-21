import { api, ApiError } from './api';
import { loadAccountSnippets, loadBrowserSnippets } from './snippets';
import { createStore, switchToLocal, switchToRemote, toast, type Project } from './store';

export interface User {
  id: string;
  email: string;
  name: string;
  plan: 'free' | 'pro' | 'team';
  role: string;
  emailVerified: boolean;
  createdAt: number;
}

export interface AuthState {
  /** unavailable = static hosting / dev server without the PHP API → browser-only mode */
  status: 'loading' | 'anonymous' | 'authenticated' | 'unavailable';
  user?: User;
}

export const authStore = createStore<AuthState>({ status: 'loading' });

async function signedIn(user: User) {
  const r = await api<{ projects: Project[] }>('GET', '/projects');
  switchToRemote(r.projects);
  authStore.set(() => ({ status: 'authenticated', user }));
  loadAccountSnippets().catch(() => undefined);
}

export async function initAuth() {
  try {
    const r = await api<{ user: User | null }>('GET', '/auth/me');
    if (r.user) await signedIn(r.user);
    else authStore.set(() => ({ status: 'anonymous' }));
  } catch (e) {
    const err = e as ApiError;
    authStore.set(() => ({ status: err.code === 'unavailable' ? 'unavailable' : 'anonymous' }));
    if (err.code === 'offline') toast('Server not reachable — working with projects in this browser.', 'error');
  }
}

export async function login(email: string, password: string) {
  const r = await api<{ user: User }>('POST', '/auth/login', { email, password });
  await signedIn(r.user);
}

export async function register(name: string, email: string, password: string) {
  const r = await api<{ user: User }>('POST', '/auth/register', { name, email, password });
  await signedIn(r.user);
}

export async function logout() {
  try {
    await api('POST', '/auth/logout', {});
  } finally {
    switchToLocal();
    loadBrowserSnippets();
    authStore.set(() => ({ status: 'anonymous' }));
  }
}

export async function resetPassword(token: string, password: string) {
  const r = await api<{ user: User }>('POST', '/auth/reset', { token, password });
  await signedIn(r.user);
}

export function setUser(user: User) {
  authStore.set((s) => ({ ...s, user }));
}

/** Account was deleted or session ended elsewhere. */
export function signedOut() {
  switchToLocal();
  loadBrowserSnippets();
  authStore.set(() => ({ status: 'anonymous' }));
}

export { ApiError };

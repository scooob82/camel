import { useSyncExternalStore } from 'react';
import { uid, type CamelFile } from '../core/model';
import { api, type ApiError } from './api';

// ---------------------------------------------------------------- tiny store

export interface Store<T> {
  get(): T;
  set(fn: (s: T) => T): void;
  subscribe(l: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(fn) {
      state = fn(state);
      listeners.forEach((l) => l());
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

/** Subscribe to a slice. The selector must return a stable reference (no new objects). */
export function useStore<T, R>(store: Store<T>, select: (s: T) => R): R {
  return useSyncExternalStore(store.subscribe, () => select(store.get()), () => select(store.get()));
}

// ---------------------------------------------------------------- safe storage

export const storage = {
  read<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  write(key: string, value: unknown): boolean {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
};

// ---------------------------------------------------------------- projects

export interface Version {
  id: string;
  at: number;
  label: string;
  file: CamelFile;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  openedAt: number;
  file: CamelFile;
  versions: Version[];
  /** Server revision (remote mode only). */
  revision?: number;
  /** Read-only share token (remote mode only). */
  shareToken?: string | null;
}

/** Persistence boundary for browser storage (anonymous use). Signed-in users sync through the API. */
export interface ProjectRepository {
  load(): Project[];
  save(projects: Project[]): boolean;
}

const KEY = 'cas.projects.v1';
export const localRepository: ProjectRepository = {
  load: () => storage.read<Project[]>(KEY, []),
  save: (projects) => storage.write(KEY, projects),
};

const MAX_VERSIONS = 30;

export type StorageMode = 'local' | 'remote';

export interface AppState {
  projects: Project[];
  mode: StorageMode;
  /** Number of API writes in flight. */
  pending: number;
  saveFailed: boolean;
}

export const appStore = createStore<AppState>({ projects: localRepository.load(), mode: 'local', pending: 0, saveFailed: false });

const isRemote = () => appStore.get().mode === 'remote';

// ---- local persistence

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persistLocal() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (isRemote()) return;
    const ok = localRepository.save(appStore.get().projects);
    if (ok === appStore.get().saveFailed) appStore.set((s) => ({ ...s, saveFailed: !ok }));
  }, 250);
}

// ---- remote sync: one serial queue keeps create → update → delete ordering

let chain: Promise<unknown> = Promise.resolve();
const dirty = new Map<string, Record<string, unknown>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function setPending(delta: number) {
  appStore.set((s) => ({ ...s, pending: Math.max(0, s.pending + delta) }));
}

function enqueue(op: () => Promise<unknown>) {
  setPending(1);
  chain = chain
    .then(op)
    .then(() => appStore.get().saveFailed && appStore.set((s) => ({ ...s, saveFailed: false })))
    .catch((e: ApiError) => {
      appStore.set((s) => ({ ...s, saveFailed: true }));
      toast(e.message || 'Saving failed', 'error');
    })
    .finally(() => setPending(-1));
}

function patchLocal(id: string, patch: Partial<Project>) {
  appStore.set((s) => ({ ...s, projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
}

function flush(id: string, keepalive = false) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const fields = dirty.get(id);
  if (!fields) return;
  dirty.delete(id);
  enqueue(async () => {
    const current = projects.get(id);
    if (!current) return;
    const body = { ...fields, ...(fields.file || fields.name !== undefined || fields.description !== undefined ? { baseRevision: current.revision } : {}) };
    try {
      const r = await api<{ revision: number; updatedAt: number }>('PUT', `/projects/${id}`, body, { keepalive });
      patchLocal(id, { revision: r.revision });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409) {
        const fresh = await api<{ project: Project }>('GET', `/projects/${id}`);
        appStore.set((s) => ({ ...s, projects: s.projects.map((p) => (p.id === id ? fresh.project : p)) }));
        toast('This project was changed in another tab or device — loaded the latest version.', 'error');
        return;
      }
      if (err.status === 0 || err.status >= 500) {
        // keep the change and retry later
        dirty.set(id, { ...fields, ...(dirty.get(id) ?? {}) });
        timers.set(id, setTimeout(() => flush(id), 5000));
      }
      throw err;
    }
  });
}

function scheduleUpdate(id: string, fields: Record<string, unknown>, delay = 800) {
  dirty.set(id, { ...(dirty.get(id) ?? {}), ...fields });
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => flush(id), delay));
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (!isRemote()) {
      localRepository.save(appStore.get().projects);
      return;
    }
    for (const id of [...dirty.keys()]) flush(id, true);
    if (appStore.get().pending > 0) e.preventDefault();
  });
}

function remoteCreate(p: Project) {
  enqueue(async () => {
    const r = await api<{ project: Project }>('POST', '/projects', p);
    if (r.project.id !== p.id) {
      // server assigned a new id (client id was taken)
      appStore.set((s) => ({ ...s, projects: s.projects.map((x) => (x.id === p.id ? { ...x, id: r.project.id, revision: r.project.revision } : x)) }));
      if (window.location.hash === `#/builder/${p.id}`) window.location.hash = `#/builder/${r.project.id}`;
    } else patchLocal(p.id, { revision: r.project.revision });
  });
}

function mutate(fn: (projects: Project[]) => Project[]) {
  appStore.set((s) => ({ ...s, projects: fn(s.projects) }));
  persistLocal();
}

export const projects = {
  create(name: string, file: CamelFile, description = ''): Project {
    const now = Date.now();
    const p: Project = { id: uid('p'), name: name.trim() || 'Untitled project', description, createdAt: now, updatedAt: now, openedAt: now, file, versions: [] };
    mutate((list) => [p, ...list]);
    if (isRemote()) remoteCreate(p);
    return p;
  },
  get(id: string): Project | undefined {
    return appStore.get().projects.find((p) => p.id === id);
  },
  update(id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'file'>>) {
    mutate((list) => list.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: patch.file || patch.name ? Date.now() : p.updatedAt } : p)));
    if (isRemote()) {
      const fields: Record<string, unknown> = { ...patch };
      if (typeof fields.name === 'string' && !fields.name.trim()) delete fields.name; // wait for a non-empty name
      if (Object.keys(fields).length) scheduleUpdate(id, fields);
    }
  },
  touch(id: string) {
    const openedAt = Date.now();
    mutate((list) => list.map((p) => (p.id === id ? { ...p, openedAt } : p)));
    if (isRemote()) scheduleUpdate(id, { openedAt }, 2000);
  },
  remove(id: string) {
    mutate((list) => list.filter((p) => p.id !== id));
    if (isRemote()) {
      clearTimeout(timers.get(id));
      dirty.delete(id);
      enqueue(() => api('DELETE', `/projects/${id}`));
    }
  },
  duplicate(id: string): Project | undefined {
    const src = projects.get(id);
    if (!src) return undefined;
    return projects.create(`${src.name} (copy)`, structuredClone(src.file), src.description);
  },
  saveVersion(id: string, label: string) {
    const src = projects.get(id);
    if (!src) return;
    const v: Version = { id: uid('v'), at: Date.now(), label, file: structuredClone(src.file) };
    mutate((list) => list.map((p) => (p.id === id ? { ...p, versions: [v, ...p.versions].slice(0, MAX_VERSIONS) } : p)));
    if (isRemote()) enqueue(() => api('POST', `/projects/${id}/versions`, v));
  },
  deleteVersion(id: string, versionId: string) {
    mutate((list) => list.map((p) => (p.id === id ? { ...p, versions: p.versions.filter((v) => v.id !== versionId) } : p)));
    if (isRemote()) enqueue(() => api('DELETE', `/projects/${id}/versions/${versionId}`));
  },
  setShareToken(id: string, token: string | null) {
    patchLocal(id, { shareToken: token });
  },
};

/** Switch to browser storage (signed out / no API). */
export function switchToLocal() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  dirty.clear();
  appStore.set((s) => ({ ...s, mode: 'local', projects: localRepository.load(), saveFailed: false }));
}

/** Switch to the signed-in user's projects from the API. */
export function switchToRemote(list: Project[]) {
  appStore.set((s) => ({ ...s, mode: 'remote', projects: list, saveFailed: false }));
}

/** Projects still stored in this browser (shown as "import to your account"). */
export function localProjects(): Project[] {
  return localRepository.load();
}

/** Upload browser projects to the account, then remove them from the browser. */
export async function importLocalProjects(): Promise<number> {
  const list = localRepository.load();
  let done = 0;
  const remaining: Project[] = [];
  for (const p of list) {
    try {
      const r = await api<{ project: Project }>('POST', '/projects', p);
      appStore.set((s) => ({ ...s, projects: [r.project, ...s.projects.filter((x) => x.id !== r.project.id)] }));
      done++;
    } catch (e) {
      remaining.push(p);
      if ((e as ApiError).code === 'limit_reached') {
        remaining.push(...list.slice(list.indexOf(p) + 1));
        toast((e as ApiError).message, 'error');
        break;
      }
    }
  }
  localRepository.save(remaining);
  return done;
}

// ---------------------------------------------------------------- theme

export type Theme = 'dark' | 'light';
export const themeStore = createStore<Theme>(storage.read<Theme>('cas.theme', 'dark'));
export function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('light', t === 'light');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#f4f6fa' : '#0c1018');
}
export function toggleTheme() {
  themeStore.set((t) => {
    const next: Theme = t === 'dark' ? 'light' : 'dark';
    storage.write('cas.theme', next);
    applyTheme(next);
    return next;
  });
}

// ---------------------------------------------------------------- toasts

export interface Toast {
  id: string;
  message: string;
  kind: 'info' | 'success' | 'error';
}
export const toastStore = createStore<Toast[]>([]);
export function toast(message: string, kind: Toast['kind'] = 'info') {
  const t: Toast = { id: uid('t'), message, kind };
  toastStore.set((list) => [...list.slice(-3), t]);
  setTimeout(() => toastStore.set((list) => list.filter((x) => x.id !== t.id)), 3200);
}

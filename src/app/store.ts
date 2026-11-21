import { useSyncExternalStore } from 'react';
import { uid, type CamelFile } from '../core/model';

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
}

/**
 * Persistence boundary. The MVP keeps projects in the browser; the planned
 * backend (/api/v1/projects) will provide another implementation of this interface.
 */
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

export interface AppState {
  projects: Project[];
  saveFailed: boolean;
}

export const appStore = createStore<AppState>({ projects: localRepository.load(), saveFailed: false });

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const ok = localRepository.save(appStore.get().projects);
    if (ok === appStore.get().saveFailed) appStore.set((s) => ({ ...s, saveFailed: !ok }));
  }, 250);
}
if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => localRepository.save(appStore.get().projects));

function mutate(fn: (projects: Project[]) => Project[]) {
  appStore.set((s) => ({ ...s, projects: fn(s.projects) }));
  persist();
}

export const projects = {
  create(name: string, file: CamelFile, description = ''): Project {
    const now = Date.now();
    const p: Project = { id: uid('p'), name: name.trim() || 'Untitled project', description, createdAt: now, updatedAt: now, openedAt: now, file, versions: [] };
    mutate((list) => [p, ...list]);
    return p;
  },
  get(id: string): Project | undefined {
    return appStore.get().projects.find((p) => p.id === id);
  },
  update(id: string, patch: Partial<Omit<Project, 'id'>>) {
    mutate((list) => list.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: patch.file || patch.name ? Date.now() : p.updatedAt } : p)));
  },
  touch(id: string) {
    mutate((list) => list.map((p) => (p.id === id ? { ...p, openedAt: Date.now() } : p)));
  },
  remove(id: string) {
    mutate((list) => list.filter((p) => p.id !== id));
  },
  duplicate(id: string): Project | undefined {
    const src = projects.get(id);
    if (!src) return undefined;
    return projects.create(`${src.name} (copy)`, structuredClone(src.file), src.description);
  },
  saveVersion(id: string, label: string) {
    mutate((list) =>
      list.map((p) => (p.id === id ? { ...p, versions: [{ id: uid('v'), at: Date.now(), label, file: structuredClone(p.file) }, ...p.versions].slice(0, MAX_VERSIONS) } : p)),
    );
  },
  deleteVersion(id: string, versionId: string) {
    mutate((list) => list.map((p) => (p.id === id ? { ...p, versions: p.versions.filter((v) => v.id !== versionId) } : p)));
  },
};

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

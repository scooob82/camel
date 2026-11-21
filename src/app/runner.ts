import { api } from './api';
import { createStore } from './store';
import type { RunRequest, RunResult, TransformRequest, TransformResult } from '../core/runner';

export interface RunnerStatus {
  available: boolean;
  signedIn: boolean;
  plan: string | null;
  dailyRuns: number | null;
}

/** undefined = not checked yet, null = API not reachable (browser-only mode). */
export const runnerStatus = createStore<RunnerStatus | null | undefined>(undefined);

export async function checkRunner(): Promise<RunnerStatus | null> {
  try {
    const s = await api<RunnerStatus>('GET', '/runner/status');
    runnerStatus.set(() => s);
    return s;
  } catch {
    runnerStatus.set(() => null);
    return null;
  }
}

export const runRoutes = (req: RunRequest) => api<RunResult>('POST', '/runner/run', req);
export const runTransform = (req: TransformRequest) => api<TransformResult>('POST', '/runner/transform', req);

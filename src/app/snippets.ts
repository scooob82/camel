import { EIP_BY_TYPE } from '../core/eip';
import { isKnown, uid, type Step } from '../core/model';
import { createStore, storage } from './store';

/** Personal library of reusable steps ("snippets"), stored in this browser. */
export interface Snippet {
  id: string;
  name: string;
  createdAt: number;
  step: Step;
}

const KEY = 'cas.snippets.v1';
export const snippetStore = createStore<Snippet[]>(storage.read<Snippet[]>(KEY, []));

function save(list: Snippet[]) {
  snippetStore.set(() => list);
  storage.write(KEY, list);
}

export function snippetName(step: Step): string {
  if (!isKnown(step)) return step.name;
  const def = EIP_BY_TYPE[step.type];
  const detail = step.props.uri ?? step.props.message ?? step.props.name ?? step.expression?.expression ?? '';
  return `${def?.label ?? step.type}${detail ? ` · ${detail}` : ''}`.slice(0, 60);
}

export const snippets = {
  add(step: Step, name = snippetName(step)): Snippet {
    const s: Snippet = { id: uid('snip'), name, createdAt: Date.now(), step: structuredClone(step) };
    save([s, ...snippetStore.get()].slice(0, 100));
    return s;
  },
  remove(id: string) {
    save(snippetStore.get().filter((s) => s.id !== id));
  },
  rename(id: string, name: string) {
    save(snippetStore.get().map((s) => (s.id === id ? { ...s, name: name.slice(0, 60) } : s)));
  },
  get(id: string): Snippet | undefined {
    return snippetStore.get().find((s) => s.id === id);
  },
};

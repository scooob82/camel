/** Immutable editing operations on the canonical model. */
import { isKnown, type Branch, type CamelFile, type Container, type KnownStep, type OnException, type RestDef, type Route, type Step } from './model';

export type NodeRef =
  | { kind: 'route'; node: Route }
  | { kind: 'onException'; node: OnException }
  | { kind: 'rest'; node: RestDef }
  | { kind: 'step'; node: Step; parent: Container }
  | { kind: 'branch'; node: Branch; parent: KnownStep };

export function findNode(file: CamelFile, id: string): NodeRef | undefined {
  for (const r of file.routes) if (r.id === id) return { kind: 'route', node: r };
  for (const e of file.onExceptions) if (e.id === id) return { kind: 'onException', node: e };
  for (const r of file.rests ?? []) if (r.id === id) return { kind: 'rest', node: r };
  let found: NodeRef | undefined;
  const visit = (owner: Container): boolean => {
    for (const s of owner.steps) {
      if (s.id === id) {
        found = { kind: 'step', node: s, parent: owner };
        return true;
      }
      if (isKnown(s)) {
        if (s.steps && visit(s as Container)) return true;
        for (const b of s.branches ?? []) {
          if (b.id === id) {
            found = { kind: 'branch', node: b, parent: s };
            return true;
          }
          if (visit(b)) return true;
        }
      }
    }
    return false;
  };
  for (const r of file.routes) if (visit(r)) return found;
  for (const e of file.onExceptions) if (visit(e)) return found;
  return undefined;
}

/** Container (anything with `steps`) by id. */
function container(file: CamelFile, id: string): Container | undefined {
  const ref = findNode(file, id);
  if (!ref) return undefined;
  if (ref.kind === 'rest') return undefined;
  if (ref.kind === 'route' || ref.kind === 'onException' || ref.kind === 'branch') return ref.node;
  if (isKnown(ref.node) && ref.node.steps) return ref.node as Container;
  return undefined;
}

const clone = <T,>(v: T): T => structuredClone(v);

export function insertStep(file: CamelFile, containerId: string, index: number, step: Step): CamelFile {
  const next = clone(file);
  const c = container(next, containerId);
  if (!c) return file;
  c.steps.splice(Math.max(0, Math.min(index, c.steps.length)), 0, step);
  return next;
}

export function removeNode(file: CamelFile, id: string): CamelFile {
  const next = clone(file);
  const ref = findNode(next, id);
  if (!ref) return file;
  if (ref.kind === 'route') next.routes = next.routes.filter((r) => r.id !== id);
  else if (ref.kind === 'onException') next.onExceptions = next.onExceptions.filter((e) => e.id !== id);
  else if (ref.kind === 'rest') next.rests = (next.rests ?? []).filter((r) => r.id !== id);
  else if (ref.kind === 'step') ref.parent.steps = ref.parent.steps.filter((s) => s.id !== id);
  else ref.parent.branches = (ref.parent.branches ?? []).filter((b) => b.id !== id);
  return next;
}

function contains(step: Step, id: string): boolean {
  if (step.id === id) return true;
  if (!isKnown(step)) return false;
  return (step.steps ?? []).some((s) => contains(s, id)) || (step.branches ?? []).some((b) => b.id === id || b.steps.some((s) => contains(s, id)));
}

export function moveStep(file: CamelFile, stepId: string, containerId: string, index: number): CamelFile {
  const ref = findNode(file, stepId);
  if (!ref || ref.kind !== 'step') return file;
  if (contains(ref.node, containerId)) return file; // cannot move into itself
  const sameParent = ref.parent.id === containerId;
  const oldIndex = ref.parent.steps.findIndex((s) => s.id === stepId);
  const without = removeNode(file, stepId);
  const target = sameParent && oldIndex < index ? index - 1 : index;
  return insertStep(without, containerId, target, ref.node);
}

export function duplicateStep(file: CamelFile, stepId: string, reid: (s: Step) => Step): CamelFile {
  const ref = findNode(file, stepId);
  if (!ref || ref.kind !== 'step') return file;
  const i = ref.parent.steps.findIndex((s) => s.id === stepId);
  return insertStep(file, ref.parent.id, i + 1, reid(clone(ref.node)));
}

/** Apply a mutation to a node (route, onException, step or branch) by id. */
export function updateNode(file: CamelFile, id: string, mutate: (node: Route | OnException | RestDef | Step | Branch) => void): CamelFile {
  const next = clone(file);
  const ref = findNode(next, id);
  if (!ref) return file;
  mutate(ref.node);
  return next;
}

export function addBranch(file: CamelFile, stepId: string, branch: Branch): CamelFile {
  return updateNode(file, stepId, (n) => {
    const s = n as KnownStep;
    const list = s.branches ?? (s.branches = []);
    if (branch.kind === 'when') {
      const oi = list.findIndex((b) => b.kind === 'otherwise');
      list.splice(oi >= 0 ? oi : list.length, 0, branch);
    } else if (branch.kind === 'doCatch') {
      const fi = list.findIndex((b) => b.kind === 'doFinally');
      list.splice(fi >= 0 ? fi : list.length, 0, branch);
    } else list.push(branch);
  });
}

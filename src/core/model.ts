/**
 * Canonical route model.
 *
 * This is the single source of truth for the builder. The canvas, the YAML/XML
 * editors and the Java export are all *views* of this model. Its shape follows
 * the Camel YAML DSL closely so that YAML round-trips are lossless.
 */

export const LANGUAGES = ['simple', 'constant', 'header', 'jsonpath', 'xpath'] as const;
export type Language = (typeof LANGUAGES)[number];

export interface Expression {
  language: Language;
  expression: string;
}

export const STEP_TYPES = [
  'to',
  'toD',
  'wireTap',
  'log',
  'setBody',
  'transform',
  'setHeader',
  'setProperty',
  'removeHeader',
  'convertBodyTo',
  'marshal',
  'unmarshal',
  'bean',
  'process',
  'filter',
  'choice',
  'split',
  'aggregate',
  'multicast',
  'loop',
  'idempotentConsumer',
  'delay',
  'doTry',
  'transacted',
  'stop',
] as const;
export type StepType = (typeof STEP_TYPES)[number];

export type BranchKind = 'when' | 'otherwise' | 'doCatch' | 'doFinally';

export interface Branch {
  id: string;
  kind: BranchKind;
  expression?: Expression;
  exceptions?: string[];
  steps: Step[];
}

export interface KnownStep {
  id: string;
  type: StepType;
  props: Record<string, string>;
  expression?: Expression;
  steps?: Step[];
  branches?: Branch[];
}

/** A step the model does not understand. Preserved verbatim so imports are not lossy. */
export interface UnknownStep {
  id: string;
  type: 'unknown';
  name: string;
  /** Original YAML value (when imported from YAML). */
  yaml?: unknown;
  /** Original XML markup (when imported from XML). */
  xml?: string;
}

export type Step = KnownStep | UnknownStep;

export interface Route {
  id: string;
  kind: 'route';
  routeId: string;
  description?: string;
  from: { uri: string };
  steps: Step[];
}

export interface OnException {
  id: string;
  kind: 'onException';
  exceptions: string[];
  handled: boolean;
  maximumRedeliveries?: string;
  redeliveryDelay?: string;
  steps: Step[];
}

export interface CamelFile {
  routes: Route[];
  onExceptions: OnException[];
  /** Top-level YAML elements we do not model (beans, rest, ...). Re-emitted untouched in YAML. */
  extras?: unknown[];
}

let counter = 0;
export function uid(prefix = 'n'): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function isKnown(step: Step): step is KnownStep {
  return step.type !== 'unknown';
}

export function emptyFile(): CamelFile {
  return { routes: [], onExceptions: [] };
}

export function newRoute(routeId = 'route-1', uri = 'timer:tick?period=5000'): Route {
  return { id: uid('r'), kind: 'route', routeId, from: { uri }, steps: [] };
}

export function newOnException(): OnException {
  return {
    id: uid('ex'),
    kind: 'onException',
    exceptions: ['java.lang.Exception'],
    handled: true,
    maximumRedeliveries: '3',
    redeliveryDelay: '1000',
    steps: [],
  };
}

/** Anything that owns a `steps` array: route, onException, container step or branch. */
export type Container = { id: string; steps: Step[] };

/** Visit every step (depth first). */
export function walkSteps(file: CamelFile, fn: (step: Step, parent: Container) => void): void {
  const visit = (owner: Container) => {
    for (const s of owner.steps) {
      fn(s, owner);
      if (isKnown(s)) {
        if (s.steps) visit(s as Container);
        for (const b of s.branches ?? []) visit(b);
      }
    }
  };
  file.routes.forEach(visit);
  file.onExceptions.forEach(visit);
}

/** All endpoint URIs used in the file (from + to/toD/wireTap). */
export function endpoints(file: CamelFile): { routeId: string; direction: 'consumer' | 'producer'; type: string; uri: string }[] {
  const out: { routeId: string; direction: 'consumer' | 'producer'; type: string; uri: string }[] = [];
  const visit = (routeId: string, steps: Step[]) => {
    for (const s of steps) {
      if (!isKnown(s)) continue;
      if ((s.type === 'to' || s.type === 'toD' || s.type === 'wireTap') && s.props.uri) {
        out.push({ routeId, direction: 'producer', type: s.type, uri: s.props.uri });
      }
      if (s.steps) visit(routeId, s.steps);
      for (const b of s.branches ?? []) visit(routeId, b.steps);
    }
  };
  for (const r of file.routes) {
    out.push({ routeId: r.routeId, direction: 'consumer', type: 'from', uri: r.from.uri });
    visit(r.routeId, r.steps);
  }
  for (const ex of file.onExceptions) visit(`onException(${ex.exceptions.join(', ')})`, ex.steps);
  return out;
}

export function schemeOf(uri: string): string {
  const i = uri.indexOf(':');
  return i > 0 ? uri.slice(0, i) : uri;
}

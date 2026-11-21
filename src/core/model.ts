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
  'throttle',
  'circuitBreaker',
  'enrich',
  'pollEnrich',
  'recipientList',
  'routingSlip',
  'dynamicRouter',
  'threads',
  'saga',
  'onCompletion',
] as const;
export type StepType = (typeof STEP_TYPES)[number];

export type BranchKind = 'when' | 'otherwise' | 'doCatch' | 'doFinally' | 'onFallback';

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
  /** Applies the error handling of a routeConfiguration with this id. */
  routeConfigurationId?: string;
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
  useExponentialBackOff?: boolean;
  backOffMultiplier?: string;
  maximumRedeliveryDelay?: string;
  steps: Step[];
}

export const HTTP_VERBS = ['get', 'post', 'put', 'patch', 'delete', 'head'] as const;
export type HttpVerb = (typeof HTTP_VERBS)[number];

export interface RestVerb {
  id: string;
  method: HttpVerb;
  path: string;
  to: string;
  consumes?: string;
  produces?: string;
  description?: string;
}

/** REST DSL block: maps HTTP operations to routes (usually direct: endpoints). */
export interface RestDef {
  id: string;
  kind: 'rest';
  path: string;
  description?: string;
  verbs: RestVerb[];
}

/** Bean created by Camel (YAML/XML DSL "beans"). */
export interface BeanDef {
  id: string;
  name: string;
  type: string;
  properties: [string, string][];
}

/** Reusable error handling that routes opt into with routeConfigurationId. */
export interface RouteConfigDef {
  id: string;
  kind: 'routeConfiguration';
  configId: string;
  description?: string;
  onExceptions: OnException[];
}

export interface CamelFile {
  routes: Route[];
  onExceptions: OnException[];
  rests?: RestDef[];
  beans?: BeanDef[];
  routeConfigurations?: RouteConfigDef[];
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

export function newRest(): RestDef {
  return { id: uid('rest'), kind: 'rest', path: '/api', verbs: [{ id: uid('verb'), method: 'get', path: '/hello', to: 'direct:hello' }] };
}

export function newBean(): BeanDef {
  return { id: uid('bean'), name: 'myBean', type: 'com.example.MyBean', properties: [] };
}

export function newRouteConfiguration(configId = 'errorHandling'): RouteConfigDef {
  return { id: uid('rc'), kind: 'routeConfiguration', configId, onExceptions: [] };
}

/** All onException blocks: global ones and those inside routeConfigurations. */
export function allOnExceptions(file: CamelFile): OnException[] {
  return [...file.onExceptions, ...(file.routeConfigurations ?? []).flatMap((c) => c.onExceptions)];
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
  allOnExceptions(file).forEach(visit);
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
  for (const ex of allOnExceptions(file)) visit(`onException(${ex.exceptions.join(', ')})`, ex.steps);
  for (const r of file.rests ?? []) for (const v of r.verbs) out.push({ routeId: `rest ${v.method.toUpperCase()} ${joinPath(r.path, v.path)}`, direction: 'producer', type: 'rest', uri: v.to });
  return out;
}

export function schemeOf(uri: string): string {
  const i = uri.indexOf(':');
  return i > 0 ? uri.slice(0, i) : uri;
}

export function joinPath(a: string, b: string): string {
  const x = `/${a}/${b}`.replace(/\/+/g, '/');
  return x.length > 1 ? x.replace(/\/$/, '') : x;
}

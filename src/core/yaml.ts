import YAML from 'yaml';
import { EIP_BY_TYPE } from './eip';
import {
  HTTP_VERBS,
  LANGUAGES,
  STEP_TYPES,
  isKnown,
  uid,
  type Branch,
  type CamelFile,
  type Expression,
  type KnownStep,
  type Language,
  type OnException,
  type RestDef,
  type RestVerb,
  type Route,
  type Step,
  type StepType,
} from './model';

type Obj = Record<string, unknown>;

export class DslParseError extends Error {
  constructor(message: string, public line?: number) {
    super(message);
  }
}

// ---------------------------------------------------------------- serialize

function exprObj(e?: Expression): Obj {
  return e ? { [e.language]: e.expression } : {};
}

function typed(type: StepType, name: string, value: string): unknown {
  const def = EIP_BY_TYPE[type]?.props.find((p) => p.name === name);
  if (def?.kind === 'boolean') return value === 'true';
  if (def?.kind === 'number' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

function propsObj(step: KnownStep, exclude: string[] = []): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(step.props)) {
    if (exclude.includes(k) || v === '' || v === undefined) continue;
    const t = typed(step.type, k, v);
    if (t === false) continue;
    out[k] = t;
  }
  return out;
}

function stepsArr(steps: Step[] | undefined): Obj[] {
  return (steps ?? []).map(stepToYaml);
}

export function stepToYaml(step: Step): Obj {
  if (!isKnown(step)) return { [step.name]: step.yaml ?? {} };
  const p = step.props;
  switch (step.type) {
    case 'to':
    case 'toD':
    case 'wireTap':
      return { [step.type]: { uri: p.uri ?? '' } };
    case 'log':
      return { log: propsObj(step) };
    case 'setBody':
    case 'transform':
    case 'delay':
      return { [step.type]: exprObj(step.expression) };
    case 'setHeader':
    case 'setProperty':
      return { [step.type]: { name: p.name ?? '', ...exprObj(step.expression) } };
    case 'removeHeader':
      return { removeHeader: { name: p.name ?? '' } };
    case 'convertBodyTo':
      return { convertBodyTo: { type: p.type ?? '' } };
    case 'marshal':
    case 'unmarshal':
      return { [step.type]: { [p.format || 'json']: {} } };
    case 'bean':
    case 'process':
      return { [step.type]: propsObj(step) };
    case 'filter':
    case 'loop':
    case 'split':
    case 'idempotentConsumer':
      return { [step.type]: { ...exprObj(step.expression), ...propsObj(step), steps: stepsArr(step.steps) } };
    case 'aggregate':
      return { aggregate: { correlationExpression: exprObj(step.expression), ...propsObj(step), steps: stepsArr(step.steps) } };
    case 'multicast':
      return { multicast: { ...propsObj(step), steps: stepsArr(step.steps) } };
    case 'choice': {
      const whens = (step.branches ?? []).filter((b) => b.kind === 'when');
      const otherwise = (step.branches ?? []).find((b) => b.kind === 'otherwise');
      const body: Obj = { when: whens.map((w) => ({ ...exprObj(w.expression), steps: stepsArr(w.steps) })) };
      if (otherwise) body.otherwise = { steps: stepsArr(otherwise.steps) };
      return { choice: body };
    }
    case 'doTry': {
      const body: Obj = { steps: stepsArr(step.steps) };
      const catches = (step.branches ?? []).filter((b) => b.kind === 'doCatch');
      const fin = (step.branches ?? []).find((b) => b.kind === 'doFinally');
      if (catches.length) body.doCatch = catches.map((c) => ({ exception: c.exceptions ?? [], steps: stepsArr(c.steps) }));
      if (fin) body.doFinally = { steps: stepsArr(fin.steps) };
      return { doTry: body };
    }
    case 'transacted':
    case 'stop':
      return { [step.type]: {} };
    case 'throttle':
    case 'enrich':
    case 'pollEnrich':
    case 'recipientList':
    case 'routingSlip':
    case 'dynamicRouter':
      return { [step.type]: { ...exprObj(step.expression), ...propsObj(step) } };
    case 'threads':
      return { threads: propsObj(step) };
    case 'circuitBreaker': {
      const body: Obj = { steps: stepsArr(step.steps) };
      const fb = (step.branches ?? []).find((b) => b.kind === 'onFallback');
      if (fb) body.onFallback = { steps: stepsArr(fb.steps) };
      return { circuitBreaker: body };
    }
  }
}

function routeToYaml(r: Route): Obj {
  const route: Obj = { id: r.routeId };
  if (r.description) route.description = r.description;
  route.from = { uri: r.from.uri, steps: stepsArr(r.steps) };
  return { route };
}

function onExceptionToYaml(ex: OnException): Obj {
  const body: Obj = { exception: ex.exceptions };
  if (ex.handled) body.handled = { constant: 'true' };
  const rp: Obj = {};
  if (ex.maximumRedeliveries) rp.maximumRedeliveries = Number(ex.maximumRedeliveries) || ex.maximumRedeliveries;
  if (ex.redeliveryDelay) rp.redeliveryDelay = Number(ex.redeliveryDelay) || ex.redeliveryDelay;
  if (ex.useExponentialBackOff) rp.useExponentialBackOff = true;
  if (ex.backOffMultiplier) rp.backOffMultiplier = Number(ex.backOffMultiplier) || ex.backOffMultiplier;
  if (ex.maximumRedeliveryDelay) rp.maximumRedeliveryDelay = Number(ex.maximumRedeliveryDelay) || ex.maximumRedeliveryDelay;
  if (Object.keys(rp).length) body.redeliveryPolicy = rp;
  body.steps = stepsArr(ex.steps);
  return { onException: body };
}

function restToYaml(r: RestDef): Obj {
  const body: Obj = { path: r.path };
  if (r.description) body.description = r.description;
  for (const m of HTTP_VERBS) {
    const verbs = r.verbs.filter((v) => v.method === m);
    if (!verbs.length) continue;
    body[m] = verbs.map((v) => {
      const o: Obj = { path: v.path };
      if (v.description) o.description = v.description;
      if (v.consumes) o.consumes = v.consumes;
      if (v.produces) o.produces = v.produces;
      o.to = v.to;
      return o;
    });
  }
  return { rest: body };
}

export function toYaml(file: CamelFile): string {
  const items: unknown[] = [
    ...file.onExceptions.map(onExceptionToYaml),
    ...(file.rests ?? []).map(restToYaml),
    ...file.routes.map(routeToYaml),
    ...(file.extras ?? []),
  ];
  if (!items.length) return '# Empty file — drag a component onto the canvas to start\n';
  return YAML.stringify(items, { lineWidth: 0, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' });
}

// ---------------------------------------------------------------- parse

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

/** Extract an expression from a YAML object (`{simple: ..}`, `{expression: {simple: {expression: ..}}}`). */
export function parseExpression(o: unknown): Expression | undefined {
  if (!isObj(o)) return undefined;
  if (isObj(o.expression)) return parseExpression(o.expression);
  for (const lang of LANGUAGES) {
    if (lang in o) {
      const v = o[lang];
      if (isObj(v)) return { language: lang as Language, expression: str(v.expression) };
      return { language: lang as Language, expression: str(v) };
    }
  }
  return undefined;
}

function parseSteps(v: unknown, path: string): Step[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new DslParseError(`${path}: "steps" must be a list`);
  return v.map((s, i) => parseStep(s, `${path}[${i}]`));
}

const KNOWN_KEYS: Record<string, string[]> = {
  split: ['parallelProcessing', 'streaming', 'stopOnException'],
  multicast: ['parallelProcessing', 'stopOnException'],
  aggregate: ['aggregationStrategy', 'completionSize', 'completionTimeout'],
  idempotentConsumer: ['idempotentRepository'],
  throttle: ['asyncDelayed', 'rejectExecution'],
  enrich: ['aggregationStrategy'],
  pollEnrich: ['timeout', 'aggregationStrategy'],
  recipientList: ['delimiter', 'parallelProcessing', 'stopOnException'],
  routingSlip: ['uriDelimiter'],
  dynamicRouter: [],
  threads: ['poolSize', 'maxPoolSize'],
  log: ['message', 'loggingLevel', 'logName'],
  bean: ['ref', 'method'],
  process: ['ref'],
};

function pickProps(type: string, o: Obj): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of KNOWN_KEYS[type] ?? []) if (o[k] !== undefined) out[k] = str(o[k]);
  return out;
}

export function parseStep(raw: unknown, path = 'step'): Step {
  if (!isObj(raw)) throw new DslParseError(`${path}: expected a step object`);
  const keys = Object.keys(raw);
  if (keys.length !== 1) throw new DslParseError(`${path}: a step must have exactly one key, got ${keys.join(', ') || 'none'}`);
  const type = keys[0];
  const v = raw[type];
  if (!(STEP_TYPES as readonly string[]).includes(type)) {
    return { id: uid('u'), type: 'unknown', name: type, yaml: v };
  }
  const t = type as StepType;
  const o: Obj = isObj(v) ? v : {};
  const step: KnownStep = { id: uid('s'), type: t, props: {} };

  switch (t) {
    case 'to':
    case 'toD':
    case 'wireTap':
      step.props.uri = typeof v === 'string' ? v : str(o.uri);
      break;
    case 'log':
      if (typeof v === 'string') step.props.message = v;
      else step.props = pickProps('log', o);
      break;
    case 'setBody':
    case 'transform':
    case 'delay':
      step.expression = parseExpression(o);
      break;
    case 'setHeader':
    case 'setProperty':
      step.props.name = str(o.name);
      step.expression = parseExpression(o);
      break;
    case 'removeHeader':
      step.props.name = typeof v === 'string' ? v : str(o.name);
      break;
    case 'convertBodyTo':
      step.props.type = typeof v === 'string' ? v : str(o.type);
      break;
    case 'marshal':
    case 'unmarshal': {
      const fmt = Object.keys(o).find((k) => k !== 'id');
      step.props.format = fmt ?? 'json';
      break;
    }
    case 'bean':
    case 'process':
      step.props = typeof v === 'string' ? { ref: v } : pickProps(t, o);
      break;
    case 'filter':
    case 'loop':
    case 'split':
    case 'idempotentConsumer':
      step.expression = parseExpression(o);
      step.props = pickProps(t, o);
      step.steps = parseSteps(o.steps, `${path}.${t}`);
      break;
    case 'aggregate':
      step.expression = parseExpression(o.correlationExpression);
      step.props = pickProps(t, o);
      step.steps = parseSteps(o.steps, `${path}.aggregate`);
      break;
    case 'multicast':
      step.props = pickProps(t, o);
      step.steps = parseSteps(o.steps, `${path}.multicast`);
      break;
    case 'choice': {
      const branches: Branch[] = [];
      const whens = Array.isArray(o.when) ? o.when : [];
      whens.forEach((w, i) => {
        branches.push({ id: uid('b'), kind: 'when', expression: parseExpression(w), steps: parseSteps(isObj(w) ? w.steps : [], `${path}.when[${i}]`) });
      });
      if (isObj(o.otherwise)) branches.push({ id: uid('b'), kind: 'otherwise', steps: parseSteps(o.otherwise.steps, `${path}.otherwise`) });
      step.branches = branches;
      break;
    }
    case 'doTry': {
      step.steps = parseSteps(o.steps, `${path}.doTry`);
      const branches: Branch[] = [];
      const catches = Array.isArray(o.doCatch) ? o.doCatch : isObj(o.doCatch) ? [o.doCatch] : [];
      catches.forEach((c, i) => {
        const co: Obj = isObj(c) ? c : {};
        const ex = Array.isArray(co.exception) ? co.exception.map(str) : co.exception ? [str(co.exception)] : [];
        branches.push({ id: uid('b'), kind: 'doCatch', exceptions: ex, steps: parseSteps(co.steps, `${path}.doCatch[${i}]`) });
      });
      if (isObj(o.doFinally)) branches.push({ id: uid('b'), kind: 'doFinally', steps: parseSteps(o.doFinally.steps, `${path}.doFinally`) });
      step.branches = branches;
      break;
    }
    case 'transacted':
    case 'stop':
      break;
    case 'throttle':
    case 'enrich':
    case 'pollEnrich':
    case 'recipientList':
    case 'routingSlip':
    case 'dynamicRouter':
      step.expression = typeof v === 'string' ? { language: 'constant', expression: v } : parseExpression(o);
      step.props = pickProps(t, o);
      break;
    case 'threads':
      step.props = pickProps(t, o);
      break;
    case 'circuitBreaker': {
      step.steps = parseSteps(o.steps, `${path}.circuitBreaker`);
      step.branches = isObj(o.onFallback) ? [{ id: uid('b'), kind: 'onFallback', steps: parseSteps(o.onFallback.steps, `${path}.onFallback`) }] : [];
      break;
    }
  }
  return step;
}

function parseRoute(o: Obj, shorthand: boolean, index: number): Route {
  const fromRaw = shorthand ? o : o.from;
  if (!isObj(fromRaw)) throw new DslParseError(`route[${index}]: missing "from"`);
  return {
    id: uid('r'),
    kind: 'route',
    routeId: str(shorthand ? fromRaw.id : o.id) || `route-${index + 1}`,
    description: str(o.description) || undefined,
    from: { uri: str(fromRaw.uri) },
    steps: parseSteps(fromRaw.steps, `route[${index}]`),
  };
}

function parseOnException(o: Obj, index: number): OnException {
  const rp: Obj = isObj(o.redeliveryPolicy) ? o.redeliveryPolicy : {};
  const handled = parseExpression(o.handled);
  const ex = Array.isArray(o.exception) ? o.exception.map(str) : o.exception ? [str(o.exception)] : [];
  return {
    id: uid('ex'),
    kind: 'onException',
    exceptions: ex,
    handled: handled ? handled.expression === 'true' : false,
    maximumRedeliveries: rp.maximumRedeliveries !== undefined ? str(rp.maximumRedeliveries) : undefined,
    redeliveryDelay: rp.redeliveryDelay !== undefined ? str(rp.redeliveryDelay) : undefined,
    useExponentialBackOff: rp.useExponentialBackOff === true || rp.useExponentialBackOff === 'true' ? true : undefined,
    backOffMultiplier: rp.backOffMultiplier !== undefined ? str(rp.backOffMultiplier) : undefined,
    maximumRedeliveryDelay: rp.maximumRedeliveryDelay !== undefined ? str(rp.maximumRedeliveryDelay) : undefined,
    steps: parseSteps(o.steps, `onException[${index}]`),
  };
}

function parseRest(o: Obj): RestDef {
  const verbs: RestVerb[] = [];
  for (const m of HTTP_VERBS) {
    const list = Array.isArray(o[m]) ? (o[m] as unknown[]) : isObj(o[m]) ? [o[m]] : [];
    for (const raw of list) {
      if (!isObj(raw)) continue;
      const to = isObj(raw.to) ? str(raw.to.uri) : str(raw.to);
      verbs.push({ id: uid('verb'), method: m, path: str(raw.path) || '/', to, consumes: str(raw.consumes) || undefined, produces: str(raw.produces) || undefined, description: str(raw.description) || undefined });
    }
  }
  return { id: uid('rest'), kind: 'rest', path: str(o.path) || '/', description: str(o.description) || undefined, verbs };
}

export function fromYaml(text: string): CamelFile {
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch (e) {
    const err = e as { message: string; linePos?: { line: number }[] };
    throw new DslParseError(err.message.split('\n')[0], err.linePos?.[0]?.line);
  }
  const file: CamelFile = { routes: [], onExceptions: [], extras: [] };
  if (doc === null || doc === undefined) return file;
  if (!Array.isArray(doc)) throw new DslParseError('Camel YAML DSL must be a list (each item starts with "- ")');
  doc.forEach((item, i) => {
    if (!isObj(item) || Object.keys(item).length !== 1) throw new DslParseError(`item ${i + 1}: expected a single key like "route" or "from"`);
    const key = Object.keys(item)[0];
    const v = item[key];
    if (key === 'route' && isObj(v)) file.routes.push(parseRoute(v, false, file.routes.length));
    else if (key === 'from' && isObj(v)) file.routes.push(parseRoute(v, true, file.routes.length));
    else if (key === 'onException' && isObj(v)) file.onExceptions.push(parseOnException(v, file.onExceptions.length));
    else if (key === 'rest' && isObj(v) && HTTP_VERBS.some((m) => m in v) && !('verb' in v)) (file.rests ??= []).push(parseRest(v));
    else file.extras!.push(item);
  });
  if (!file.extras!.length) delete file.extras;
  return file;
}

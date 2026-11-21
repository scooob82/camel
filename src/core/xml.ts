import { HTTP_VERBS, LANGUAGES, STEP_TYPES, isKnown, uid, type Branch, type CamelFile, type Expression, type HttpVerb, type KnownStep, type Language, type OnException, type RestDef, type Route, type Step, type StepType } from './model';
import { escapeXml, parseXml, type XmlNode } from './xmlparse';
import { DslParseError } from './yaml';

// ---------------------------------------------------------------- serialize

const pad = (n: number) => '    '.repeat(n);

function attrs(o: Record<string, string | undefined>): string {
  return Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== '' && v !== 'false')
    .map(([k, v]) => ` ${k}="${escapeXml(v!, true)}"`)
    .join('');
}

function exprXml(e: Expression | undefined, depth: number): string[] {
  if (!e) return [];
  return [`${pad(depth)}<${e.language}>${escapeXml(e.expression)}</${e.language}>`];
}

function stepsXml(steps: Step[] | undefined, depth: number): string[] {
  return (steps ?? []).flatMap((s) => stepXml(s, depth));
}

function block(tag: string, attrStr: string, inner: string[], depth: number): string[] {
  if (!inner.length) return [`${pad(depth)}<${tag}${attrStr}/>`];
  return [`${pad(depth)}<${tag}${attrStr}>`, ...inner, `${pad(depth)}</${tag}>`];
}

function stepXml(step: Step, depth: number): string[] {
  if (!isKnown(step)) {
    if (step.xml) return [pad(depth) + step.xml.trim()];
    return [`${pad(depth)}<!-- unsupported step "${escapeXml(step.name)}" (imported from YAML) -->`];
  }
  const p = step.props;
  const d1 = depth + 1;
  switch (step.type) {
    case 'to':
    case 'toD':
    case 'wireTap':
      return [`${pad(depth)}<${step.type}${attrs({ uri: p.uri })}/>`];
    case 'log':
      return [`${pad(depth)}<log${attrs({ message: p.message, loggingLevel: p.loggingLevel, logName: p.logName })}/>`];
    case 'setBody':
    case 'transform':
    case 'delay':
      return block(step.type, '', exprXml(step.expression, d1), depth);
    case 'setHeader':
    case 'setProperty':
      return block(step.type, attrs({ name: p.name }), exprXml(step.expression, d1), depth);
    case 'removeHeader':
      return [`${pad(depth)}<removeHeader${attrs({ name: p.name })}/>`];
    case 'convertBodyTo':
      return [`${pad(depth)}<convertBodyTo${attrs({ type: p.type })}/>`];
    case 'marshal':
    case 'unmarshal':
      return block(step.type, '', [`${pad(d1)}<${p.format || 'json'}/>`], depth);
    case 'bean':
      return [`${pad(depth)}<bean${attrs({ ref: p.ref, method: p.method })}/>`];
    case 'process':
      return [`${pad(depth)}<process${attrs({ ref: p.ref })}/>`];
    case 'filter':
    case 'loop':
      return block(step.type, '', [...exprXml(step.expression, d1), ...stepsXml(step.steps, d1)], depth);
    case 'split':
      return block('split', attrs({ parallelProcessing: p.parallelProcessing, streaming: p.streaming, stopOnException: p.stopOnException }), [...exprXml(step.expression, d1), ...stepsXml(step.steps, d1)], depth);
    case 'idempotentConsumer':
      return block('idempotentConsumer', attrs({ idempotentRepository: p.idempotentRepository }), [...exprXml(step.expression, d1), ...stepsXml(step.steps, d1)], depth);
    case 'aggregate':
      return block(
        'aggregate',
        attrs({ aggregationStrategy: p.aggregationStrategy, completionSize: p.completionSize, completionTimeout: p.completionTimeout }),
        [...block('correlationExpression', '', exprXml(step.expression, d1 + 1), d1), ...stepsXml(step.steps, d1)],
        depth,
      );
    case 'multicast':
      return block('multicast', attrs({ parallelProcessing: p.parallelProcessing, stopOnException: p.stopOnException }), stepsXml(step.steps, d1), depth);
    case 'choice': {
      const inner: string[] = [];
      for (const b of step.branches ?? []) {
        if (b.kind === 'when') inner.push(...block('when', '', [...exprXml(b.expression, d1 + 1), ...stepsXml(b.steps, d1 + 1)], d1));
      }
      const o = (step.branches ?? []).find((b) => b.kind === 'otherwise');
      if (o) inner.push(...block('otherwise', '', stepsXml(o.steps, d1 + 1), d1));
      return block('choice', '', inner, depth);
    }
    case 'doTry': {
      const inner = stepsXml(step.steps, d1);
      for (const b of step.branches ?? []) {
        if (b.kind === 'doCatch') {
          inner.push(...block('doCatch', '', [...(b.exceptions ?? []).map((e) => `${pad(d1 + 1)}<exception>${escapeXml(e)}</exception>`), ...stepsXml(b.steps, d1 + 1)], d1));
        }
      }
      const f = (step.branches ?? []).find((b) => b.kind === 'doFinally');
      if (f) inner.push(...block('doFinally', '', stepsXml(f.steps, d1 + 1), d1));
      return block('doTry', '', inner, depth);
    }
    case 'transacted':
    case 'stop':
      return [`${pad(depth)}<${step.type}/>`];
    case 'throttle':
      return block('throttle', attrs({ asyncDelayed: p.asyncDelayed, rejectExecution: p.rejectExecution }), exprXml(step.expression, d1), depth);
    case 'enrich':
      return block('enrich', attrs({ aggregationStrategy: p.aggregationStrategy }), exprXml(step.expression, d1), depth);
    case 'pollEnrich':
      return block('pollEnrich', attrs({ timeout: p.timeout, aggregationStrategy: p.aggregationStrategy }), exprXml(step.expression, d1), depth);
    case 'recipientList':
      return block('recipientList', attrs({ delimiter: p.delimiter, parallelProcessing: p.parallelProcessing, stopOnException: p.stopOnException }), exprXml(step.expression, d1), depth);
    case 'routingSlip':
      return block('routingSlip', attrs({ uriDelimiter: p.uriDelimiter }), exprXml(step.expression, d1), depth);
    case 'dynamicRouter':
      return block('dynamicRouter', '', exprXml(step.expression, d1), depth);
    case 'threads':
      return [`${pad(depth)}<threads${attrs({ poolSize: p.poolSize, maxPoolSize: p.maxPoolSize })}/>`];
    case 'circuitBreaker': {
      const inner = stepsXml(step.steps, d1);
      const fb = (step.branches ?? []).find((b) => b.kind === 'onFallback');
      if (fb) inner.push(...block('onFallback', '', stepsXml(fb.steps, d1 + 1), d1));
      return block('circuitBreaker', '', inner, depth);
    }
  }
}

function routeXml(r: Route): string[] {
  return [
    `${pad(1)}<route${attrs({ id: r.routeId })}>`,
    ...(r.description ? [`${pad(2)}<description>${escapeXml(r.description)}</description>`] : []),
    `${pad(2)}<from${attrs({ uri: r.from.uri })}/>`,
    ...stepsXml(r.steps, 2),
    `${pad(1)}</route>`,
  ];
}

function onExceptionXml(ex: OnException): string[] {
  return [
    `${pad(1)}<onException>`,
    ...ex.exceptions.map((e) => `${pad(2)}<exception>${escapeXml(e)}</exception>`),
    ...(ex.maximumRedeliveries || ex.redeliveryDelay || ex.useExponentialBackOff || ex.backOffMultiplier || ex.maximumRedeliveryDelay
      ? [
          `${pad(2)}<redeliveryPolicy${attrs({
            maximumRedeliveries: ex.maximumRedeliveries,
            redeliveryDelay: ex.redeliveryDelay,
            useExponentialBackOff: ex.useExponentialBackOff ? 'true' : undefined,
            backOffMultiplier: ex.backOffMultiplier,
            maximumRedeliveryDelay: ex.maximumRedeliveryDelay,
          })}/>`,
        ]
      : []),
    ...(ex.handled ? [`${pad(2)}<handled><constant>true</constant></handled>`] : []),
    ...stepsXml(ex.steps, 2),
    `${pad(1)}</onException>`,
  ];
}

function restXml(r: RestDef): string[] {
  const verbs = r.verbs.flatMap((v) =>
    block(v.method, attrs({ path: v.path, consumes: v.consumes, produces: v.produces }), [...(v.description ? [`${pad(3)}<description>${escapeXml(v.description)}</description>`] : []), `${pad(3)}<to${attrs({ uri: v.to })}/>`], 2),
  );
  return block('rest', attrs({ path: r.path }), [...(r.description ? [`${pad(2)}<description>${escapeXml(r.description)}</description>`] : []), ...verbs], 1);
}

export function toXml(file: CamelFile): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<routes xmlns="http://camel.apache.org/schema/xml-io">',
    ...file.onExceptions.flatMap(onExceptionXml),
    ...(file.rests ?? []).flatMap(restXml),
    ...file.routes.flatMap(routeXml),
  ];
  if (file.extras?.length) lines.push(`${pad(1)}<!-- ${file.extras.length} top-level YAML element(s) have no XML equivalent in the builder and were omitted -->`);
  lines.push('</routes>');
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- parse

const LANG_SET = new Set<string>(LANGUAGES);
const STEP_SET = new Set<string>(STEP_TYPES);

function exprOf(n: XmlNode | undefined): Expression | undefined {
  if (!n) return undefined;
  const e = n.children.find((c) => LANG_SET.has(c.name));
  return e ? { language: e.name as Language, expression: e.text } : undefined;
}

function stepChildren(n: XmlNode, src: string, skip: string[] = []): Step[] {
  return n.children.filter((c) => !LANG_SET.has(c.name) && !skip.includes(c.name)).map((c) => parseStepXml(c, src));
}

function parseStepXml(n: XmlNode, src: string): Step {
  if (!STEP_SET.has(n.name)) return { id: uid('u'), type: 'unknown', name: n.name, xml: src.slice(n.start, n.end) };
  const type = n.name as StepType;
  const a = n.attrs;
  const step: KnownStep = { id: uid('s'), type, props: {} };
  const pick = (...keys: string[]) => {
    for (const k of keys) if (a[k] !== undefined) step.props[k] = a[k];
  };
  switch (type) {
    case 'to':
    case 'toD':
    case 'wireTap':
      pick('uri');
      break;
    case 'log':
      pick('message', 'loggingLevel', 'logName');
      break;
    case 'setBody':
    case 'transform':
    case 'delay':
      step.expression = exprOf(n);
      break;
    case 'setHeader':
    case 'setProperty':
      pick('name');
      step.expression = exprOf(n);
      break;
    case 'removeHeader':
      pick('name');
      break;
    case 'convertBodyTo':
      pick('type');
      break;
    case 'marshal':
    case 'unmarshal':
      step.props.format = n.children[0]?.name ?? 'json';
      break;
    case 'bean':
      pick('ref', 'method');
      break;
    case 'process':
      pick('ref');
      break;
    case 'filter':
    case 'loop':
      step.expression = exprOf(n);
      step.steps = stepChildren(n, src);
      break;
    case 'split':
      pick('parallelProcessing', 'streaming', 'stopOnException');
      step.expression = exprOf(n);
      step.steps = stepChildren(n, src);
      break;
    case 'idempotentConsumer':
      pick('idempotentRepository');
      step.expression = exprOf(n);
      step.steps = stepChildren(n, src);
      break;
    case 'aggregate':
      pick('aggregationStrategy', 'completionSize', 'completionTimeout');
      step.expression = exprOf(n.children.find((c) => c.name === 'correlationExpression'));
      step.steps = stepChildren(n, src, ['correlationExpression']);
      break;
    case 'multicast':
      pick('parallelProcessing', 'stopOnException');
      step.steps = stepChildren(n, src);
      break;
    case 'choice': {
      const branches: Branch[] = [];
      for (const c of n.children) {
        if (c.name === 'when') branches.push({ id: uid('b'), kind: 'when', expression: exprOf(c), steps: stepChildren(c, src) });
        if (c.name === 'otherwise') branches.push({ id: uid('b'), kind: 'otherwise', steps: stepChildren(c, src) });
      }
      step.branches = branches;
      break;
    }
    case 'doTry': {
      step.steps = stepChildren(n, src, ['doCatch', 'doFinally']);
      const branches: Branch[] = [];
      for (const c of n.children) {
        if (c.name === 'doCatch') {
          branches.push({ id: uid('b'), kind: 'doCatch', exceptions: c.children.filter((x) => x.name === 'exception').map((x) => x.text), steps: stepChildren(c, src, ['exception', 'onWhen']) });
        }
        if (c.name === 'doFinally') branches.push({ id: uid('b'), kind: 'doFinally', steps: stepChildren(c, src) });
      }
      step.branches = branches;
      break;
    }
    case 'transacted':
    case 'stop':
      break;
    case 'throttle':
      pick('asyncDelayed', 'rejectExecution');
      step.expression = exprOf(n);
      break;
    case 'enrich':
      pick('aggregationStrategy');
      step.expression = exprOf(n) ?? (a.uri ? { language: 'constant', expression: a.uri } : undefined);
      break;
    case 'pollEnrich':
      pick('timeout', 'aggregationStrategy');
      step.expression = exprOf(n) ?? (a.uri ? { language: 'constant', expression: a.uri } : undefined);
      break;
    case 'recipientList':
      pick('delimiter', 'parallelProcessing', 'stopOnException');
      step.expression = exprOf(n);
      break;
    case 'routingSlip':
      pick('uriDelimiter');
      step.expression = exprOf(n);
      break;
    case 'dynamicRouter':
      step.expression = exprOf(n);
      break;
    case 'threads':
      pick('poolSize', 'maxPoolSize');
      break;
    case 'circuitBreaker': {
      step.steps = stepChildren(n, src, ['onFallback', 'resilience4jConfiguration', 'faultToleranceConfiguration']);
      const fb = n.children.find((c) => c.name === 'onFallback');
      step.branches = fb ? [{ id: uid('b'), kind: 'onFallback', steps: stepChildren(fb, src) }] : [];
      break;
    }
  }
  return step;
}

function parseRouteXml(n: XmlNode, src: string, index: number): Route {
  const from = n.children.find((c) => c.name === 'from');
  if (!from) throw new DslParseError(`<route> #${index + 1} has no <from>`);
  return {
    id: uid('r'),
    kind: 'route',
    routeId: n.attrs.id || `route-${index + 1}`,
    description: n.children.find((c) => c.name === 'description')?.text || undefined,
    from: { uri: from.attrs.uri ?? '' },
    steps: n.children.filter((c) => c.name !== 'from' && c.name !== 'description').map((c) => parseStepXml(c, src)),
  };
}

function parseOnExceptionXml(n: XmlNode, src: string): OnException {
  const rp = n.children.find((c) => c.name === 'redeliveryPolicy');
  const handled = exprOf(n.children.find((c) => c.name === 'handled'));
  return {
    id: uid('ex'),
    kind: 'onException',
    exceptions: n.children.filter((c) => c.name === 'exception').map((c) => c.text),
    handled: handled?.expression === 'true',
    maximumRedeliveries: rp?.attrs.maximumRedeliveries,
    redeliveryDelay: rp?.attrs.redeliveryDelay,
    useExponentialBackOff: rp?.attrs.useExponentialBackOff === 'true' ? true : undefined,
    backOffMultiplier: rp?.attrs.backOffMultiplier,
    maximumRedeliveryDelay: rp?.attrs.maximumRedeliveryDelay,
    steps: stepChildren(n, src, ['exception', 'redeliveryPolicy', 'handled', 'onWhen']),
  };
}

const VERB_SET = new Set<string>(HTTP_VERBS);

function parseRestXml(n: XmlNode): RestDef {
  return {
    id: uid('rest'),
    kind: 'rest',
    path: n.attrs.path ?? '/',
    description: n.children.find((c) => c.name === 'description')?.text || undefined,
    verbs: n.children
      .filter((c) => VERB_SET.has(c.name))
      .map((c) => ({
        id: uid('verb'),
        method: c.name as HttpVerb,
        path: c.attrs.path ?? '/',
        to: c.children.find((x) => x.name === 'to')?.attrs.uri ?? c.attrs.to ?? '',
        consumes: c.attrs.consumes,
        produces: c.attrs.produces,
        description: c.children.find((x) => x.name === 'description')?.text || undefined,
      })),
  };
}

export function fromXml(text: string): CamelFile {
  let root: XmlNode;
  try {
    root = parseXml(text);
  } catch (e) {
    const err = e as Error & { line?: number };
    throw new DslParseError(err.message, err.line);
  }
  const file: CamelFile = { routes: [], onExceptions: [] };
  const collect = (n: XmlNode) => {
    for (const c of n.children) {
      if (c.name === 'route') file.routes.push(parseRouteXml(c, text, file.routes.length));
      else if (c.name === 'onException') file.onExceptions.push(parseOnExceptionXml(c, text));
      else if (c.name === 'rest') (file.rests ??= []).push(parseRestXml(c));
      else if (c.name === 'rests') c.children.filter((x) => x.name === 'rest').forEach((x) => (file.rests ??= []).push(parseRestXml(x)));
      else if (c.name === 'camelContext' || c.name === 'routes' || c.name === 'routeContext') collect(c);
    }
  };
  if (root.name === 'route') file.routes.push(parseRouteXml(root, text, 0));
  else collect(root);
  return file;
}

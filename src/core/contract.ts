/**
 * Contract-first scaffolding: OpenAPI (2/3), AsyncAPI (2/3) and WSDL 1.1 → route skeletons.
 * The generated routes are a starting point: every operation gets its own route with a TODO body.
 */
import YAML from 'yaml';
import { newStep } from './eip';
import { HTTP_VERBS, newRoute, uid, type CamelFile, type HttpVerb, type RestVerb, type Route } from './model';
import { parseXml, type XmlNode } from './xmlparse';
import { DslParseError } from './yaml';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export function slug(s: string): string {
  return (
    s
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[{}]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'operation'
  );
}

function unique(base: string, used: Set<string>): string {
  let s = base;
  for (let i = 2; used.has(s); i++) s = `${base}-${i}`;
  used.add(s);
  return s;
}

function todoRoute(routeId: string, uri: string, what: string, body?: string): Route {
  const r = newRoute(routeId, uri);
  r.description = what;
  const log = newStep('log');
  log.props.message = `${what}: \${body}`;
  r.steps.push(log);
  if (body !== undefined) {
    const sb = newStep('setBody');
    sb.expression = { language: 'constant', expression: body };
    r.steps.push(sb);
  }
  return r;
}

export function parseStructured(text: string): Obj {
  let doc: unknown;
  try {
    doc = text.trimStart().startsWith('{') ? JSON.parse(text) : YAML.parse(text);
  } catch (e) {
    throw new DslParseError(`Cannot parse the contract: ${(e as Error).message.split('\n')[0]}`);
  }
  if (!isObj(doc)) throw new DslParseError('The contract must be a JSON/YAML object');
  return doc;
}

// ---------------------------------------------------------------- OpenAPI

export function fromOpenApi(doc: Obj): CamelFile {
  const paths = isObj(doc.paths) ? doc.paths : {};
  let base = typeof doc.basePath === 'string' ? doc.basePath : '';
  const servers = Array.isArray(doc.servers) ? doc.servers : [];
  if (!base && isObj(servers[0]) && typeof servers[0].url === 'string') {
    try {
      base = new URL(servers[0].url, 'http://x').pathname;
    } catch {
      base = '';
    }
  }
  const used = new Set<string>();
  const verbs: RestVerb[] = [];
  const routes: Route[] = [];
  for (const [path, item] of Object.entries(paths)) {
    if (!isObj(item)) continue;
    for (const method of HTTP_VERBS) {
      const op = item[method];
      if (!isObj(op)) continue;
      const id = unique(slug(typeof op.operationId === 'string' ? op.operationId : `${method} ${path}`), used);
      const summary = typeof op.summary === 'string' ? op.summary : `${method.toUpperCase()} ${path}`;
      const responses = isObj(op.responses) ? op.responses : {};
      const json = JSON.stringify(responses).includes('application/json') || Array.isArray(op.produces);
      verbs.push({ id: uid('verb'), method: method as HttpVerb, path, to: `direct:${id}`, description: summary, produces: json ? 'application/json' : undefined });
      routes.push(todoRoute(id, `direct:${id}`, summary, `{"todo":"implement ${id}"}`));
    }
  }
  if (!verbs.length) throw new DslParseError('No operations found in the OpenAPI document');
  // YAML/XML group operations by HTTP method — keep the same order in the model
  verbs.sort((a, b) => HTTP_VERBS.indexOf(a.method) - HTTP_VERBS.indexOf(b.method));
  const info = isObj(doc.info) ? doc.info : {};
  return { routes, onExceptions: [], rests: [{ id: uid('rest'), kind: 'rest', path: base || '/', description: typeof info.title === 'string' ? info.title : undefined, verbs }] };
}

// ---------------------------------------------------------------- AsyncAPI

const PROTOCOLS: Record<string, (channel: string) => string> = {
  kafka: (c) => `kafka:${c}?brokers={{kafka.brokers}}`,
  'kafka-secure': (c) => `kafka:${c}?brokers={{kafka.brokers}}`,
  amqp: (c) => `amqp:queue:${c}`,
  amqps: (c) => `amqp:queue:${c}`,
  jms: (c) => `jms:queue:${c}`,
  mqtt: (c) => `paho-mqtt5:${c}?brokerUrl={{mqtt.url}}`,
  'secure-mqtt': (c) => `paho-mqtt5:${c}?brokerUrl={{mqtt.url}}`,
};

export function fromAsyncApi(doc: Obj): CamelFile {
  const servers = isObj(doc.servers) ? Object.values(doc.servers) : [];
  const protocol = isObj(servers[0]) && typeof servers[0].protocol === 'string' ? servers[0].protocol : 'kafka';
  const endpoint = PROTOCOLS[protocol] ?? PROTOCOLS.kafka;
  const channels = isObj(doc.channels) ? doc.channels : {};
  const used = new Set<string>();
  const routes: Route[] = [];
  const consume = (address: string, name: string) => {
    const id = unique(`consume-${slug(name)}`, used);
    const r = todoRoute(id, endpoint(address), `Receive ${address}`);
    r.steps.push(newStep('to', `direct:handle-${slug(name)}`));
    routes.push(r, todoRoute(unique(`handle-${slug(name)}`, used), `direct:handle-${slug(name)}`, `Handle ${address}`));
  };
  const produce = (address: string, name: string) => {
    const id = unique(`send-${slug(name)}`, used);
    const r = todoRoute(id, `direct:${id}`, `Send to ${address}`);
    r.steps.push(newStep('marshal'), newStep('to', endpoint(address)));
    routes.push(r);
  };
  const major = String(doc.asyncapi ?? '2').split('.')[0];
  if (major === '3') {
    const ops = isObj(doc.operations) ? doc.operations : {};
    for (const [name, op] of Object.entries(ops)) {
      if (!isObj(op)) continue;
      const ref = isObj(op.channel) && typeof op.channel.$ref === 'string' ? op.channel.$ref.split('/').pop()! : name;
      const ch = channels[ref];
      const address = isObj(ch) && typeof ch.address === 'string' ? ch.address : ref;
      if (op.action === 'receive') consume(address, name);
      else produce(address, name);
    }
  } else {
    for (const [address, ch] of Object.entries(channels)) {
      if (!isObj(ch)) continue;
      // AsyncAPI 2: "publish" = clients publish → the application receives
      if (ch.publish) consume(address, address);
      if (ch.subscribe) produce(address, address);
    }
  }
  if (!routes.length) throw new DslParseError('No channels/operations found in the AsyncAPI document');
  return { routes, onExceptions: [] };
}

// ---------------------------------------------------------------- WSDL 1.1

function children(n: XmlNode, name: string): XmlNode[] {
  return n.children.filter((c) => c.name === name);
}

export function fromWsdl(root: XmlNode, fileName = 'service.wsdl'): CamelFile {
  const ops = new Set<string>();
  for (const pt of children(root, 'portType')) for (const op of children(pt, 'operation')) if (op.attrs.name) ops.add(op.attrs.name);
  if (!ops.size) throw new DslParseError('No operations found in the WSDL (portType/operation)');
  const service = children(root, 'service')[0];
  const serviceName = service?.attrs.name ?? root.attrs.name ?? 'Service';
  const used = new Set<string>();
  const entry = newRoute(unique(slug(serviceName), used), `cxf:/${serviceName}?wsdlURL=classpath:wsdl/${fileName}&dataFormat=PAYLOAD`);
  entry.description = `SOAP endpoint for ${serviceName}`;
  const choice = newStep('choice');
  const routes: Route[] = [];
  choice.branches = [...ops].map((op) => {
    const id = unique(slug(op), used);
    routes.push(todoRoute(id, `direct:${id}`, `SOAP operation ${op}`));
    return { id: uid('b'), kind: 'when' as const, expression: { language: 'simple' as const, expression: `\${header.operationName} == '${op}'` }, steps: [newStep('to', `direct:${id}`)] };
  });
  const fault = newStep('log');
  fault.props.message = 'Unknown operation ${header.operationName}';
  fault.props.loggingLevel = 'WARN';
  choice.branches.push({ id: uid('b'), kind: 'otherwise', steps: [fault] });
  entry.steps.push(choice);
  return { routes: [entry, ...routes], onExceptions: [] };
}

// ---------------------------------------------------------------- detection

export type ContractKind = 'openapi' | 'asyncapi' | 'wsdl';

export function detectContract(name: string, text: string): ContractKind | undefined {
  const t = text.trimStart();
  if (t.startsWith('<')) return /<(\w+:)?definitions[\s>]/.test(t.slice(0, 4000)) && /wsdl/i.test(t.slice(0, 4000)) ? 'wsdl' : undefined;
  if (/^\s*["']?(openapi|swagger)["']?\s*:/m.test(t.slice(0, 2000))) return 'openapi';
  if (/^\s*["']?asyncapi["']?\s*:/m.test(t.slice(0, 2000))) return 'asyncapi';
  if (/\.wsdl$/i.test(name)) return 'wsdl';
  return undefined;
}

export function fromContract(kind: ContractKind, name: string, text: string): CamelFile {
  if (kind === 'wsdl') return fromWsdl(parseXml(text), name.split('/').pop() || 'service.wsdl');
  const doc = parseStructured(text);
  return kind === 'openapi' ? fromOpenApi(doc) : fromAsyncApi(doc);
}

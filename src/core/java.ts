import { isKnown, type CamelFile, type Expression, type OnException, type RestDef, type Route, type Step } from './model';

const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;

function expr(e?: Expression): string {
  if (!e) return 'simple("")';
  return `${e.language}(${q(e.expression)})`;
}

function cls(name: string): string {
  const n = name.trim() || 'java.lang.Exception';
  return `${n.includes('.') ? n : `java.lang.${n}`}.class`;
}

export function className(name: string): string {
  const base = name
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
  const n = base || 'Camel';
  return /^[0-9]/.test(n) ? `R${n}RouteBuilder` : `${n}RouteBuilder`;
}

const DATA_FORMATS: Record<string, string> = { json: 'json()', jacksonXml: 'jacksonXml()', jaxb: 'jaxb()', csv: 'csv()', base64: 'base64()' };

function steps(list: Step[] | undefined, depth: number, out: string[]): void {
  for (const s of list ?? []) step(s, depth, out);
}

function step(s: Step, depth: number, out: string[]): void {
  const ind = '    '.repeat(depth);
  const line = (code: string) => out.push(ind + code);
  if (!isKnown(s)) {
    line(`// TODO: unsupported step "${s.name}" — add it manually`);
    return;
  }
  const p = s.props;
  const flags = (names: string[]) => names.filter((n) => p[n] === 'true').map((n) => `.${n}()`).join('');
  switch (s.type) {
    case 'to':
    case 'toD':
    case 'wireTap':
      line(`.${s.type}(${q(p.uri ?? '')})`);
      return;
    case 'log': {
      const msg = q(p.message ?? '');
      if (p.logName) line(`.log(LoggingLevel.${p.loggingLevel || 'INFO'}, ${q(p.logName)}, ${msg})`);
      else if (p.loggingLevel) line(`.log(LoggingLevel.${p.loggingLevel}, ${msg})`);
      else line(`.log(${msg})`);
      return;
    }
    case 'setBody':
    case 'transform':
    case 'delay':
      line(`.${s.type}(${expr(s.expression)})`);
      return;
    case 'setHeader':
    case 'setProperty':
      line(`.${s.type}(${q(p.name ?? '')}, ${expr(s.expression)})`);
      return;
    case 'removeHeader':
      line(`.removeHeader(${q(p.name ?? '')})`);
      return;
    case 'convertBodyTo':
      line(`.convertBodyTo(${(p.type || 'java.lang.String')}.class)`);
      return;
    case 'marshal':
    case 'unmarshal':
      line(`.${s.type}().${DATA_FORMATS[p.format] ?? `custom(${q(p.format ?? '')})`}`);
      return;
    case 'bean':
      line(`.to(${q(`bean:${p.ref ?? ''}${p.method ? `?method=${p.method}` : ''}`)})`);
      return;
    case 'process':
      line(`.process(${q(p.ref ?? '')})`);
      return;
    case 'transacted':
      line('.transacted()');
      return;
    case 'stop':
      line('.stop()');
      return;
    case 'throttle':
      line(`.throttle(${expr(s.expression)})${p.asyncDelayed === 'true' ? '.asyncDelayed()' : ''}${p.rejectExecution === 'true' ? '.rejectExecution(true)' : ''}`);
      return;
    case 'enrich':
    case 'pollEnrich': {
      const e = s.expression;
      let c = e?.language === 'constant' ? `.${s.type}(${q(e.expression)})` : `.${s.type}().${e?.language ?? 'simple'}(${q(e?.expression ?? '')})`;
      if (s.type === 'pollEnrich' && p.timeout) c += `.timeout(${p.timeout})`;
      if (p.aggregationStrategy) c += `.aggregationStrategy(${q(p.aggregationStrategy.replace(/^#/, ''))})`;
      line(c);
      return;
    }
    case 'recipientList':
      line(`.recipientList(${expr(s.expression)})${p.delimiter ? `.delimiter(${q(p.delimiter)})` : ''}${flags(['parallelProcessing', 'stopOnException'])}`);
      return;
    case 'routingSlip':
      line(`.routingSlip(${expr(s.expression)})${p.uriDelimiter ? `.uriDelimiter(${q(p.uriDelimiter)})` : ''}`);
      return;
    case 'dynamicRouter':
      line(`.dynamicRouter(${expr(s.expression)})`);
      return;
    case 'threads':
      line(`.threads(${[p.poolSize, p.poolSize && p.maxPoolSize].filter(Boolean).join(', ')})`);
      return;
    case 'circuitBreaker':
      line('.circuitBreaker()');
      steps(s.steps, depth + 1, out);
      for (const b of s.branches ?? []) {
        if (b.kind === 'onFallback') {
          line('.onFallback()');
          steps(b.steps, depth + 1, out);
        }
      }
      line('.end()');
      return;
    case 'filter':
    case 'loop':
      line(`.${s.type}(${expr(s.expression)})`);
      break;
    case 'split':
      line(`.split(${expr(s.expression)})${flags(['parallelProcessing', 'streaming', 'stopOnException'])}`);
      break;
    case 'idempotentConsumer':
      line(`.idempotentConsumer(${expr(s.expression)})${p.idempotentRepository ? `.idempotentRepository(${q(p.idempotentRepository.replace(/^#/, ''))})` : ''}`);
      break;
    case 'aggregate': {
      let c = `.aggregate(${expr(s.expression)})`;
      if (p.aggregationStrategy) c += `.aggregationStrategy(${q(p.aggregationStrategy.replace(/^#/, ''))})`;
      if (p.completionSize) c += `.completionSize(${p.completionSize})`;
      if (p.completionTimeout) c += `.completionTimeout(${p.completionTimeout})`;
      line(c);
      break;
    }
    case 'multicast':
      line(`.multicast()${flags(['parallelProcessing', 'stopOnException'])}`);
      break;
    case 'choice':
      line('.choice()');
      for (const b of s.branches ?? []) {
        if (b.kind === 'when') {
          out.push(`${ind}    .when(${expr(b.expression)})`);
          steps(b.steps, depth + 2, out);
        }
      }
      for (const b of s.branches ?? []) {
        if (b.kind === 'otherwise') {
          out.push(`${ind}    .otherwise()`);
          steps(b.steps, depth + 2, out);
        }
      }
      line('.end()');
      return;
    case 'doTry':
      line('.doTry()');
      steps(s.steps, depth + 1, out);
      for (const b of s.branches ?? []) {
        if (b.kind === 'doCatch') {
          line(`.doCatch(${(b.exceptions?.length ? b.exceptions : ['java.lang.Exception']).map(cls).join(', ')})`);
          steps(b.steps, depth + 1, out);
        }
      }
      for (const b of s.branches ?? []) {
        if (b.kind === 'doFinally') {
          line('.doFinally()');
          steps(b.steps, depth + 1, out);
        }
      }
      line('.end()');
      return;
  }
  // container with plain inner steps
  steps(s.steps, depth + 1, out);
  line('.end()');
}

function onException(ex: OnException, out: string[]): void {
  let head = `        onException(${(ex.exceptions.length ? ex.exceptions : ['java.lang.Exception']).map(cls).join(', ')})`;
  if (ex.handled) head += '\n            .handled(true)';
  if (ex.maximumRedeliveries) head += `\n            .maximumRedeliveries(${ex.maximumRedeliveries})`;
  if (ex.redeliveryDelay) head += `\n            .redeliveryDelay(${ex.redeliveryDelay})`;
  if (ex.useExponentialBackOff) head += '\n            .useExponentialBackOff()';
  if (ex.backOffMultiplier) head += `\n            .backOffMultiplier(${ex.backOffMultiplier})`;
  if (ex.maximumRedeliveryDelay) head += `\n            .maximumRedeliveryDelay(${ex.maximumRedeliveryDelay})`;
  out.push(head);
  steps(ex.steps, 3, out);
  out[out.length - 1] += ';';
  out.push('');
}

function rest(r: RestDef, out: string[]): void {
  out.push(`        rest(${q(r.path)})${r.description ? `.description(${q(r.description)})` : ''}`);
  for (const v of r.verbs) {
    let c = `            .${v.method}(${q(v.path)})`;
    if (v.description) c += `.description(${q(v.description)})`;
    if (v.consumes) c += `.consumes(${q(v.consumes)})`;
    if (v.produces) c += `.produces(${q(v.produces)})`;
    out.push(`${c}.to(${q(v.to)})`);
  }
  out[out.length - 1] += ';';
  out.push('');
}

function route(r: Route, out: string[]): void {
  out.push(`        from(${q(r.from.uri)})`);
  out.push(`            .routeId(${q(r.routeId)})`);
  if (r.description) out.push(`            .routeDescription(${q(r.description)})`);
  steps(r.steps, 3, out);
  out[out.length - 1] += ';';
  out.push('');
}

export function toJava(file: CamelFile, projectName = 'Camel', pkg = 'com.example.integration'): string {
  const name = className(projectName);
  const json = JSON.stringify(file);
  const usesLevel = /"loggingLevel":"[A-Z]/.test(json) || /"logName":"[^"]/.test(json);
  const out: string[] = [
    `package ${pkg};`,
    '',
    ...(usesLevel ? ['import org.apache.camel.LoggingLevel;'] : []),
    'import org.apache.camel.builder.RouteBuilder;',
    'import org.springframework.stereotype.Component;',
    '',
    '@Component',
    `public class ${name} extends RouteBuilder {`,
    '',
    '    @Override',
    '    public void configure() throws Exception {',
  ];
  file.onExceptions.forEach((ex) => onException(ex, out));
  (file.rests ?? []).forEach((r) => rest(r, out));
  file.routes.forEach((r) => route(r, out));
  if (!file.routes.length && !file.onExceptions.length) out.push('        // No routes yet');
  if (out[out.length - 1] === '') out.pop();
  out.push('    }', '}', '');
  return out.join('\n');
}

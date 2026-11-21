import { COMPONENT_BY_SCHEME, parseUri } from './catalog';
import { EIP_BY_TYPE } from './eip';
import { isKnown, type CamelFile, type Step } from './model';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  message: string;
  /** Id of the route / step / branch the issue belongs to (for click-to-select). */
  target?: string;
  rule: string;
}

const HTTP_TIMEOUTS = ['connectTimeout', 'connectionRequestTimeout', 'responseTimeout', 'soTimeout'];

function checkUri(uri: string, target: string, role: 'consumer' | 'producer', issues: Issue[]): void {
  if (!uri.trim()) {
    issues.push({ severity: 'error', message: 'Endpoint URI is empty', target, rule: 'uri-required' });
    return;
  }
  if (!uri.includes(':')) {
    issues.push({ severity: 'error', message: `"${uri}" is not a valid endpoint URI (expected scheme:path)`, target, rule: 'uri-scheme' });
    return;
  }
  const p = parseUri(uri);
  const comp = COMPONENT_BY_SCHEME[p.scheme];
  if (!comp) {
    issues.push({ severity: 'info', message: `Component "${p.scheme}" is not in the built-in catalog — options are not checked`, target, rule: 'uri-unknown-component' });
    return;
  }
  if (role === 'consumer' && !comp.consumer) issues.push({ severity: 'error', message: `${comp.title} cannot be used in "from" (producer only)`, target, rule: 'uri-consumer' });
  if (role === 'producer' && !comp.producer) issues.push({ severity: 'error', message: `${comp.title} cannot be used as a producer (consumer only)`, target, rule: 'uri-producer' });
  if (!p.path && !p.scheme.startsWith('http')) issues.push({ severity: 'warning', message: `${comp.title} endpoint has no path (${comp.syntax})`, target, rule: 'uri-path' });
  if ((p.scheme === 'http' || p.scheme === 'https') && role === 'producer' && !p.params.some(([k]) => HTTP_TIMEOUTS.includes(k))) {
    issues.push({ severity: 'warning', message: `HTTP call without timeout — add connectTimeout / responseTimeout`, target, rule: 'http-timeout' });
  }
  for (const [k, v] of p.params) {
    if (/password|secret|token/i.test(k) && v && !v.startsWith('{{') && !v.startsWith('RAW({{')) {
      issues.push({ severity: 'warning', message: `"${k}" looks like a hard-coded secret — use a {{property}} placeholder`, target, rule: 'uri-secret' });
    }
  }
}

function checkSteps(steps: Step[], issues: Issue[]): void {
  for (const s of steps) {
    if (!isKnown(s)) {
      issues.push({ severity: 'info', message: `"${s.name}" is not supported by the visual builder yet — kept as-is in YAML`, target: s.id, rule: 'unknown-step' });
      continue;
    }
    const def = EIP_BY_TYPE[s.type];
    if (def.uri) checkUri(s.props.uri ?? '', s.id, 'producer', issues);
    if (def.expression === 'required' && !s.expression?.expression.trim()) {
      issues.push({ severity: 'error', message: `${def.label}: ${def.expressionLabel ?? 'expression'} is required`, target: s.id, rule: 'expression-required' });
    }
    for (const p of def.props) {
      if (p.required && !(s.props[p.name] ?? '').trim()) issues.push({ severity: 'error', message: `${def.label}: "${p.label}" is required`, target: s.id, rule: 'prop-required' });
    }
    if ((def.container === 'steps' || def.container === 'circuitBreaker') && !(s.steps ?? []).length) {
      issues.push({ severity: 'warning', message: `${def.label} has no inner steps`, target: s.id, rule: 'empty-branch' });
    }
    if (s.type === 'aggregate' && !s.props.completionSize && !s.props.completionTimeout) {
      issues.push({ severity: 'error', message: 'aggregate needs a completion condition (size or timeout)', target: s.id, rule: 'aggregate-completion' });
    }
    if (s.type === 'choice') {
      const whens = (s.branches ?? []).filter((b) => b.kind === 'when');
      if (!whens.length) issues.push({ severity: 'error', message: 'choice needs at least one "when"', target: s.id, rule: 'choice-when' });
      for (const b of s.branches ?? []) {
        if (b.kind === 'when' && !b.expression?.expression.trim()) issues.push({ severity: 'error', message: 'when: condition is required', target: b.id, rule: 'expression-required' });
        if (!b.steps.length) issues.push({ severity: 'warning', message: `choice: empty "${b.kind}" branch`, target: b.id, rule: 'empty-branch' });
      }
    }
    if (s.type === 'doTry') {
      if (!(s.branches ?? []).length) issues.push({ severity: 'error', message: 'doTry needs a doCatch or doFinally', target: s.id, rule: 'dotry-catch' });
      if (!(s.steps ?? []).length) issues.push({ severity: 'warning', message: 'doTry block is empty', target: s.id, rule: 'empty-branch' });
      for (const b of s.branches ?? []) {
        if (b.kind === 'doCatch' && !(b.exceptions ?? []).length) issues.push({ severity: 'error', message: 'doCatch: at least one exception class is required', target: b.id, rule: 'docatch-exception' });
      }
    }
    if (s.type === 'split' && s.props.parallelProcessing === 'true' && s.props.streaming !== 'true') {
      issues.push({ severity: 'info', message: 'Parallel split without streaming loads all parts into memory', target: s.id, rule: 'split-streaming' });
    }
    if (s.steps) checkSteps(s.steps, issues);
    for (const b of s.branches ?? []) checkSteps(b.steps, issues);
  }
}

function hasDoTry(steps: Step[]): boolean {
  return steps.some((s) => isKnown(s) && (s.type === 'doTry' || hasDoTry(s.steps ?? []) || (s.branches ?? []).some((b) => hasDoTry(b.steps))));
}

export function validate(file: CamelFile): Issue[] {
  const issues: Issue[] = [];
  const ids = new Map<string, number>();
  for (const r of file.routes) {
    ids.set(r.routeId, (ids.get(r.routeId) ?? 0) + 1);
    if (!r.routeId.trim()) issues.push({ severity: 'warning', message: 'Route has no id — Camel will generate one', target: r.id, rule: 'route-id' });
    checkUri(r.from.uri, r.id, 'consumer', issues);
    if (!r.steps.length) issues.push({ severity: 'warning', message: `Route "${r.routeId}" has no steps`, target: r.id, rule: 'empty-route' });
    checkSteps(r.steps, issues);
  }
  for (const [id, n] of ids) if (n > 1 && id) issues.push({ severity: 'error', message: `Duplicate route id "${id}"`, rule: 'route-id-unique', target: file.routes.find((r) => r.routeId === id)?.id });
  for (const ex of file.onExceptions) {
    if (!ex.exceptions.length) issues.push({ severity: 'error', message: 'onException: at least one exception class is required', target: ex.id, rule: 'onexception-class' });
    checkSteps(ex.steps, issues);
  }
  const consumers = new Set(file.routes.map((r) => r.from.uri.split('?')[0]));
  for (const r of file.rests ?? []) {
    if (!r.verbs.length) issues.push({ severity: 'warning', message: `REST ${r.path} has no operations`, target: r.id, rule: 'rest-empty' });
    const seen = new Set<string>();
    for (const v of r.verbs) {
      const key = `${v.method} ${v.path}`;
      if (seen.has(key)) issues.push({ severity: 'error', message: `Duplicate REST operation ${v.method.toUpperCase()} ${v.path}`, target: r.id, rule: 'rest-duplicate' });
      seen.add(key);
      if (!v.to.trim()) issues.push({ severity: 'error', message: `${v.method.toUpperCase()} ${v.path}: target endpoint is required`, target: r.id, rule: 'rest-to' });
      else if (v.to.startsWith('direct:') && !consumers.has(v.to.split('?')[0])) {
        issues.push({ severity: 'warning', message: `${v.method.toUpperCase()} ${v.path} → ${v.to}: no route in this file consumes it`, target: r.id, rule: 'rest-target' });
      }
    }
  }
  if ((file.rests ?? []).length) issues.push({ severity: 'info', message: 'REST DSL needs a restConfiguration (e.g. component: platform-http) in application.properties — the Spring Boot export adds it', rule: 'rest-configuration' });
  if (file.routes.length && !file.onExceptions.length && !file.routes.every((r) => hasDoTry(r.steps))) {
    issues.push({ severity: 'warning', message: 'No error handling — consider adding an onException block or doTry', rule: 'error-handler' });
  }
  return issues;
}

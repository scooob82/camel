/**
 * Run & Debug: everything that happens around a sandbox run on the client side —
 * preparing the routes (start endpoint, mocks, injected faults), the wire protocol with the
 * runner service, coverage and generating a JUnit test from a recorded run.
 */
import { EIP_BY_TYPE } from './eip';
import { className } from './java';
import { allOnExceptions, isKnown, schemeOf, uid, walkSteps, type CamelFile, type KnownStep, type Step, type UnknownStep } from './model';
import { toRunYaml } from './yaml';

// ---------------------------------------------------------------- protocol

export type MockMode = 'external' | 'all' | 'none';
export type FaultKind = 'exception' | 'timeout' | 'http500' | 'invalid-data';

export interface Fault {
  nodeId: string;
  kind: FaultKind;
}

export interface RunInput {
  body: string;
  headers: Record<string, string>;
}

export interface RunRequest {
  yaml: string;
  /** Endpoint the input is sent to (the start route's consumer is rewritten to it). */
  start: string;
  input: RunInput;
  timeoutMs: number;
}

export interface TraceEvent {
  seq: number;
  nodeId: string;
  routeId: string;
  label: string;
  /** Time since the run started (ms). */
  atMs: number;
  /** Time spent in this processor (ms). */
  tookMs: number;
  body: string;
  headers: Record<string, string>;
  properties: Record<string, string>;
  exception?: string;
}

export interface MockResult {
  uri: string;
  /** The real endpoint this mock replaced. */
  original?: string;
  count: number;
  bodies: string[];
}

export interface RunResult {
  ok: boolean;
  durationMs: number;
  trace: TraceEvent[];
  output?: { body: string; headers: Record<string, string> };
  error?: string;
  mocks: MockResult[];
  logs: string[];
}

export interface TransformRequest {
  kind: 'xslt' | 'xquery';
  source: string;
  input: string;
  params?: Record<string, string>;
  trace?: boolean;
}

export interface TransformTraceEntry {
  line: number;
  column?: number;
  instruction: string;
  depth: number;
  tookMs?: number;
}

export interface TransformResult {
  ok: boolean;
  output: string;
  messages: string[];
  durationMs: number;
  trace?: TransformTraceEntry[];
  error?: { message: string; line?: number };
}

// ---------------------------------------------------------------- preparing a run

/** Components that never leave the JVM — kept real in "external" mock mode. */
const INTERNAL = new Set(['direct', 'seda', 'log', 'mock', 'bean', 'class', 'xslt', 'xslt-saxon', 'xquery', 'validator', 'dataformat', 'language', 'stub']);

/** Components the sandbox refuses to run (code execution, host access). */
export const BLOCKED = ['exec', 'ssh', 'scp', 'docker', 'kubernetes', 'file', 'ftp', 'ftps', 'sftp', 'jdbc', 'sql', 'groovy', 'joor', 'jsh', 'mvel', 'ognl', 'spel', 'python', 'js'];

export const START_URI = 'direct:cas-start';

const mockName = (uri: string) =>
  'mock:' +
  uri
    .replace(/\?.*$/, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

function rewriteSteps(steps: Step[], fn: (s: KnownStep) => void): void {
  for (const s of steps) {
    if (!isKnown(s)) continue;
    fn(s);
    rewriteSteps(s.steps ?? [], fn);
    for (const b of s.branches ?? []) rewriteSteps(b.steps, fn);
  }
}

const FAULT_EXCEPTION: Record<FaultKind, [string, string]> = {
  exception: ['java.lang.IllegalStateException', 'Chaos: injected failure'],
  timeout: ['java.net.SocketTimeoutException', 'Chaos: simulated timeout'],
  http500: ['java.io.IOException', 'Chaos: HTTP 500 Internal Server Error'],
  'invalid-data': ['java.lang.IllegalArgumentException', 'Chaos: invalid data'],
};

/** A step that throws — inserted right before the faulty node. */
function faultStep(f: Fault): UnknownStep {
  const [type, message] = FAULT_EXCEPTION[f.kind];
  return { id: uid('chaos'), type: 'unknown', name: 'throwException', yaml: { exceptionType: type, message } };
}

export interface PreparedRun {
  request: RunRequest;
  /** mock uri → original uri */
  mocks: Record<string, string>;
  /** Problems that prevent running (blocked components…). */
  blocked: string[];
}

export function prepareRun(file: CamelFile, routeId: string, input: RunInput, opts: { mocks?: MockMode; faults?: Fault[]; timeoutMs?: number } = {}): PreparedRun {
  const f: CamelFile = structuredClone(file);
  const mocks: Record<string, string> = {};
  const blocked: string[] = [];
  const mode = opts.mocks ?? 'external';
  const mockUri = (uri: string): string => {
    const scheme = schemeOf(uri);
    const internal = INTERNAL.has(scheme);
    if (mode === 'none' || (mode === 'external' && internal)) {
      if (BLOCKED.includes(scheme)) blocked.push(`"${scheme}" is not allowed in the sandbox (${uri}) — use mocks`);
      return uri;
    }
    if (scheme === 'mock' || scheme === 'log') return uri;
    const m = mockName(uri);
    mocks[m] = uri;
    return m;
  };
  const target = f.routes.find((r) => r.routeId === routeId) ?? f.routes[0];
  if (!target) throw new Error('The project has no route to run');
  for (const r of f.routes) {
    const scheme = schemeOf(r.from.uri);
    if (r === target) r.from.uri = START_URI;
    else if (!['direct', 'seda'].includes(scheme)) r.from.uri = `direct:cas-disabled-${r.routeId.replace(/\W+/g, '-')}`; // pollers (timer, kafka…) stay idle
  }
  const all = [...f.routes, ...allOnExceptions(f)];
  for (const c of all) {
    rewriteSteps(c.steps, (s) => {
      if (s.props.uri !== undefined) s.props.uri = mockUri(s.props.uri);
      if ((s.type === 'enrich' || s.type === 'pollEnrich') && s.expression?.language === 'constant') s.expression = { ...s.expression, expression: mockUri(s.expression.expression) };
      if (s.type === 'saga') {
        if (s.props.compensation) s.props.compensation = mockUri(s.props.compensation);
        if (s.props.completion) s.props.completion = mockUri(s.props.completion);
      }
    });
  }
  for (const v of (f.rests ?? []).flatMap((r) => r.verbs)) v.to = mockUri(v.to);
  delete f.rests; // REST endpoints are not started in the sandbox; call the target route directly

  // chaos: insert a throwing step before each faulty node
  for (const fault of opts.faults ?? []) {
    const visit = (owner: { steps: Step[] }): boolean => {
      const i = owner.steps.findIndex((s) => s.id === fault.nodeId);
      if (i >= 0) {
        owner.steps.splice(i, 0, faultStep(fault));
        return true;
      }
      return owner.steps.some((s) => isKnown(s) && ((s.steps && visit(s as { steps: Step[] })) || (s.branches ?? []).some(visit)));
    };
    all.some(visit);
  }
  const yaml = toRunYaml(f);
  for (const lang of ['groovy', 'joor', 'java', 'mvel', 'ognl', 'spel', 'python', 'js']) {
    if (new RegExp(`^\\s*-?\\s*${lang}:`, 'm').test(yaml)) blocked.push(`The "${lang}" language runs arbitrary code and is not allowed in the sandbox`);
  }
  if ((f.beans ?? []).length) blocked.push('Custom beans are not instantiated in the sandbox — remove them or replace bean calls with mocks');
  return { request: { yaml, start: START_URI, input, timeoutMs: Math.min(Math.max(opts.timeoutMs ?? 5000, 500), 15000) }, mocks, blocked: [...new Set(blocked)] };
}

// ---------------------------------------------------------------- coverage

export interface Coverage {
  total: number;
  covered: number;
  percent: number;
  uncovered: string[];
  /** Branch ids (when/otherwise/catch…) that were never entered. */
  uncoveredBranches: string[];
}

export function coverage(file: CamelFile, runs: RunResult[], routeIds?: string[]): Coverage {
  const visited = new Set(runs.flatMap((r) => r.trace.map((e) => e.nodeId)));
  const ids: string[] = [];
  const branchesMissed: string[] = [];
  const routes = routeIds ? file.routes.filter((r) => routeIds.includes(r.routeId)) : file.routes;
  const visit = (steps: Step[]) => {
    for (const s of steps) {
      if (!isKnown(s)) continue;
      ids.push(s.id);
      visit(s.steps ?? []);
      for (const b of s.branches ?? []) {
        if (b.steps.length && !b.steps.some((x) => visited.has(x.id)) && !(b.id && visited.has(b.id))) branchesMissed.push(b.id);
        visit(b.steps);
      }
    }
  };
  routes.forEach((r) => visit(r.steps));
  const covered = ids.filter((id) => visited.has(id)).length;
  return { total: ids.length, covered, percent: ids.length ? Math.round((covered / ids.length) * 100) : 0, uncovered: ids.filter((id) => !visited.has(id)), uncoveredBranches: branchesMissed };
}

// ---------------------------------------------------------------- JUnit test from a run

const jstr = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;

export function generateJUnitTest(file: CamelFile, routeId: string, prepared: PreparedRun, result: RunResult, projectName: string): string {
  const route = file.routes.find((r) => r.routeId === routeId) ?? file.routes[0];
  const cls = className(projectName).replace(/RouteBuilder$/, '') + 'RouteTest';
  const mocks = result.mocks.filter((m) => prepared.mocks[m.uri]);
  const headers = Object.entries(prepared.request.input.headers);
  const lines = [
    'package com.example.integration;',
    '',
    'import org.apache.camel.CamelContext;',
    'import org.apache.camel.EndpointInject;',
    'import org.apache.camel.ProducerTemplate;',
    'import org.apache.camel.builder.AdviceWith;',
    'import org.apache.camel.component.mock.MockEndpoint;',
    'import org.apache.camel.test.spring.junit5.CamelSpringBootTest;',
    'import org.apache.camel.test.spring.junit5.UseAdviceWith;',
    'import org.junit.jupiter.api.Test;',
    'import org.springframework.beans.factory.annotation.Autowired;',
    'import org.springframework.boot.test.context.SpringBootTest;',
    '',
    ...(headers.length ? ['import java.util.Map;', ''] : []),
    '/**',
    ` * Generated from a sandbox run of route "${route.routeId}" (${new Date().toISOString().slice(0, 10)}).`,
    ' * External endpoints are replaced by mocks exactly like in the run.',
    ' */',
    '@CamelSpringBootTest',
    '@SpringBootTest',
    '@UseAdviceWith',
    `class ${cls} {`,
    '',
    '    @Autowired',
    '    CamelContext context;',
    '',
    '    @Autowired',
    '    ProducerTemplate template;',
    '',
    ...mocks.flatMap((m, i) => [`    @EndpointInject(${jstr(m.uri)})`, `    MockEndpoint mock${i + 1};`, '']),
    '    @Test',
    `    void ${route.routeId.replace(/\W+(\w)/g, (_m, c: string) => c.toUpperCase()).replace(/\W/g, '')}Run() throws Exception {`,
    `        AdviceWith.adviceWith(context, ${jstr(route.routeId)}, a -> {`,
    `            a.replaceFromWith(${jstr(START_URI)});`,
    ...Object.entries(prepared.mocks).map(([mock, original]) => `            a.interceptSendToEndpoint(${jstr(original.replace(/\?.*$/, '') + '*')}).skipSendToOriginalEndpoint().to(${jstr(mock)});`),
    '        });',
    '        context.start();',
    '',
    ...mocks.map((m, i) => `        mock${i + 1}.expectedMessageCount(${m.count});`),
    ...mocks.flatMap((m, i) => (m.count === 1 && m.bodies[0] !== undefined && m.bodies[0].length < 2000 ? [`        mock${i + 1}.expectedBodiesReceived(${jstr(m.bodies[0])});`] : [])),
    '',
    headers.length
      ? `        Object out = template.requestBodyAndHeaders(${jstr(START_URI)}, ${jstr(prepared.request.input.body)}, Map.of(${headers.map(([k, v]) => `${jstr(k)}, ${jstr(v)}`).join(', ')}));`
      : `        Object out = template.requestBody(${jstr(START_URI)}, ${jstr(prepared.request.input.body)});`,
    '',
    ...(result.ok && result.output && result.output.body.length < 2000 ? [`        org.junit.jupiter.api.Assertions.assertEquals(${jstr(result.output.body)}, context.getTypeConverter().convertTo(String.class, out));`] : ['        // the recorded run ended with an error — assert the expected exception here']),
    '        MockEndpoint.assertIsSatisfied(context);',
    '    }',
    '}',
    '',
  ];
  return lines.join('\n');
}

/** Human label of a node for trace lists. */
export function nodeLabel(file: CamelFile, nodeId: string): string {
  let label = nodeId;
  walkSteps(file, (s) => {
    if (s.id !== nodeId) return;
    label = isKnown(s) ? `${EIP_BY_TYPE[s.type]?.label ?? s.type}${s.props.uri ? ` ${s.props.uri}` : s.props.message ? ` ${s.props.message}` : ''}` : s.name;
  });
  return label;
}

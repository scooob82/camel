import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECIPES } from '../content/recipes';
import { buildUri, parseUri, setUriParam } from './catalog';
import { toMermaid } from './docs';
import { insertStep, moveStep, removeNode, findNode } from './edit';
import { newStep } from './eip';
import { placeholders, requiredStarters, springBootProject } from './export';
import { toJava } from './java';
import { jsonPath } from './jsonpath';
import { newRoute, type CamelFile } from './model';
import { validate } from './validate';
import { fromXml, toXml } from './xml';
import { fromYaml, toYaml } from './yaml';

/** Strip generated ids so models can be compared structurally. */
function norm(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (k !== 'id' && x !== undefined) out[k] = norm(x);
    return out;
  }
  return v;
}

for (const r of RECIPES) {
  test(`recipe "${r.slug}" round-trips YAML → model → YAML`, () => {
    const m1 = fromYaml(r.yaml);
    assert.ok(m1.routes.length > 0, 'has routes');
    const m2 = fromYaml(toYaml(m1));
    assert.deepEqual(norm(m2), norm(m1));
  });
  test(`recipe "${r.slug}" round-trips via XML`, () => {
    const m1 = fromYaml(r.yaml);
    const m2 = fromXml(toXml(m1));
    assert.deepEqual(norm(m2), norm(m1));
  });
  test(`recipe "${r.slug}" has no validation errors`, () => {
    const errors = validate(fromYaml(r.yaml)).filter((i) => i.severity === 'error');
    assert.deepEqual(errors, []);
  });
}

test('YAML shorthand "- from:" and string steps are accepted', () => {
  const f = fromYaml(`- from:
    uri: timer:x
    steps:
      - log: hello
      - to: "log:out"
      - setBody:
          expression:
            constant:
              expression: abc
`);
  assert.equal(f.routes[0].from.uri, 'timer:x');
  const [log, to, sb] = f.routes[0].steps as any[];
  assert.equal(log.props.message, 'hello');
  assert.equal(to.props.uri, 'log:out');
  assert.deepEqual(sb.expression, { language: 'constant', expression: 'abc' });
});

test('unknown steps and top-level elements are preserved in YAML', () => {
  const src = `- beans:
    - name: myBean
      type: com.example.Foo
- route:
    id: r
    from:
      uri: direct:a
      steps:
        - throttle:
            constant: 10
`;
  const f = fromYaml(src);
  assert.equal(f.extras?.length, 1);
  assert.equal(f.routes[0].steps[0].type, 'unknown');
  const again = fromYaml(toYaml(f));
  assert.deepEqual(norm(again), norm(f));
  assert.match(toYaml(f), /throttle/);
});

test('YAML errors are reported', () => {
  assert.throws(() => fromYaml('- route: [\n'), /./);
  assert.throws(() => fromYaml('route: {}'), /must be a list/);
});

test('XML import of a classic Spring-style file', () => {
  const f = fromXml(`<?xml version="1.0"?>
<camelContext xmlns="http://camel.apache.org/schema/spring">
  <route id="a">
    <from uri="direct:a"/>
    <choice>
      <when><xpath>/order/@type = 'B2B'</xpath><to uri="jms:queue:b2b"/></when>
      <otherwise><log message="other &amp; stuff"/></otherwise>
    </choice>
  </route>
</camelContext>`);
  assert.equal(f.routes[0].routeId, 'a');
  const choice = f.routes[0].steps[0] as any;
  assert.equal(choice.branches[0].expression.language, 'xpath');
  assert.equal(choice.branches[1].steps[0].props.message, 'other & stuff');
});

test('Java DSL export', () => {
  const java = toJava(fromYaml(RECIPES.find((r) => r.slug === 'retry-and-redelivery')!.yaml), 'Partner calls');
  assert.match(java, /public class PartnerCallsRouteBuilder extends RouteBuilder/);
  assert.match(java, /onException\(java\.io\.IOException\.class\)/);
  assert.match(java, /\.maximumRedeliveries\(5\)/);
  assert.match(java, /from\("direct:partner"\)/);
  assert.match(java, /import org\.apache\.camel\.LoggingLevel;/);
  const choice = toJava(fromYaml(RECIPES[0].yaml), 'x');
  assert.match(choice, /\.choice\(\)\n\s+\.when\(simple\(/);
  assert.match(choice, /\.otherwise\(\)/);
});

test('validation rules', () => {
  const f: CamelFile = { routes: [newRoute('r', 'nope')], onExceptions: [] };
  let rules = validate(f).map((i) => i.rule);
  assert.ok(rules.includes('uri-scheme'));
  assert.ok(rules.includes('error-handler'));
  assert.ok(rules.includes('empty-route'));
  const r = f.routes[0];
  r.from.uri = 'log:x';
  const agg = newStep('aggregate');
  agg.props.completionSize = '';
  r.steps.push(newStep('to', 'https://api.example.com?password=secret'), agg);
  rules = validate(f).map((i) => i.rule);
  assert.ok(rules.includes('uri-consumer'));
  assert.ok(rules.includes('http-timeout'));
  assert.ok(rules.includes('uri-secret'));
  assert.ok(rules.includes('aggregate-completion'));
});

test('edit operations', () => {
  let f: CamelFile = { routes: [newRoute()], onExceptions: [] };
  const rid = f.routes[0].id;
  const a = newStep('log');
  const filter = newStep('filter');
  f = insertStep(f, rid, 0, a);
  f = insertStep(f, rid, 1, filter);
  f = moveStep(f, a.id, filter.id, 0);
  assert.equal(f.routes[0].steps.length, 1);
  assert.equal((f.routes[0].steps[0] as any).steps[0].id, a.id);
  // cannot move a container into itself
  assert.equal(moveStep(f, filter.id, filter.id, 0), f);
  f = removeNode(f, a.id);
  assert.equal(findNode(f, a.id), undefined);
});

test('URI helpers keep placeholders untouched', () => {
  const u = 'kafka:orders?brokers={{kafka.brokers}}&groupId=g';
  assert.equal(buildUri(parseUri(u)), u);
  assert.equal(setUriParam(u, 'groupId', ''), 'kafka:orders?brokers={{kafka.brokers}}');
  assert.equal(setUriParam('timer:t', 'period', '1000'), 'timer:t?period=1000');
});

test('JSONPath subset', () => {
  const data = { lines: [{ sku: 'a', qty: 1 }, { sku: 'b', qty: 5 }], meta: { sku: 'x' } };
  assert.deepEqual(jsonPath(data, '$.lines[*].sku'), ['a', 'b']);
  assert.deepEqual(jsonPath(data, '$.lines[?(@.qty > 2)].sku'), ['b']);
  assert.deepEqual([...(jsonPath(data, '$..sku') as string[])].sort(), ['a', 'b', 'x']);
  assert.deepEqual(jsonPath(data, '$.lines[-1].qty'), [5]);
  assert.throws(() => jsonPath(data, 'lines'), /start with \$/);
});

test('Spring Boot export', () => {
  const f = fromYaml(RECIPES.find((r) => r.slug === 'file-to-kafka')!.yaml);
  const starters = requiredStarters(f, 'yaml');
  for (const s of ['camel-spring-boot-starter', 'camel-yaml-dsl-starter', 'camel-file-starter', 'camel-kafka-starter', 'camel-csv-starter', 'camel-jackson-starter']) assert.ok(starters.includes(s), s);
  assert.deepEqual(placeholders(f), ['kafka.brokers']);
  const files = springBootProject(f, 'CSV import', 'yaml');
  assert.ok(files.some((x) => x.path === 'src/main/resources/camel/routes.camel.yaml'));
  assert.match(files.find((x) => x.path === 'pom.xml')!.content, /<artifactId>csv-import<\/artifactId>/);
});

test('Mermaid output', () => {
  const m = toMermaid(fromYaml(RECIPES[0].yaml));
  assert.match(m, /^flowchart LR/);
  assert.match(m, /\{"choice"\}/);
});

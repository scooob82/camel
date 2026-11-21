import assert from 'node:assert/strict';
import { test } from 'node:test';
import YAML from 'yaml';
import { coverage, generateJUnitTest, prepareRun, START_URI, type RunResult } from './runner';
import { fromYaml } from './yaml';

const SRC = `- route:
    id: orders
    from:
      uri: kafka:orders?brokers=x
      steps:
        - choice:
            when:
              - simple: \${header.vip} == 'true'
                steps:
                  - to:
                      uri: https://crm.example.com/vip?connectTimeout=1000
            otherwise:
              steps:
                - log:
                    message: normal
        - to:
            uri: direct:audit
        - to:
            uri: jms:queue:out
- route:
    id: audit
    from:
      uri: direct:audit
      steps:
        - log:
            message: audit
- route:
    id: poller
    from:
      uri: timer:tick
      steps:
        - log:
            message: tick
`;

test('prepareRun rewrites start, mocks external endpoints and injects faults', () => {
  const file = fromYaml(SRC);
  const jms = (file.routes[0].steps[2] as any).id;
  const p = prepareRun(file, 'orders', { body: '{}', headers: { vip: 'true' } }, { faults: [{ nodeId: jms, kind: 'timeout' }] });
  const doc = YAML.parse(p.request.yaml);
  const orders = doc.find((d: any) => d.route?.id === 'orders').route;
  assert.equal(orders.from.uri, START_URI);
  assert.equal(doc.find((d: any) => d.route?.id === 'poller').route.from.uri, 'direct:cas-disabled-poller');
  assert.equal(doc.find((d: any) => d.route?.id === 'audit').route.from.uri, 'direct:audit');
  const steps = orders.from.steps;
  assert.equal(steps[0].choice.id, (file.routes[0].steps[0] as any).id, 'ids are emitted for tracing');
  assert.match(steps[0].choice.when[0].steps[0].to.uri, /^mock:https-crm-example-com-vip$/);
  assert.equal(steps[1].to.uri, 'direct:audit', 'internal endpoints stay real');
  assert.deepEqual(steps[2], { throwException: { exceptionType: 'java.net.SocketTimeoutException', message: 'Chaos: simulated timeout' } });
  assert.match(steps[3].to.uri, /^mock:jms-queue-out$/);
  assert.equal(p.mocks['mock:jms-queue-out'], 'jms:queue:out');
  assert.deepEqual(p.blocked, []);
});

test('blocked components and languages are reported', () => {
  const f = fromYaml(`- from:
    uri: direct:a
    steps:
      - to: "exec:rm?args=-rf"
      - script:
          groovy: "'x'.execute()"
`);
  const p = prepareRun(f, 'route-1', { body: '', headers: {} }, { mocks: 'none' });
  assert.equal(p.blocked.length, 2);
});

test('coverage and JUnit generation', () => {
  const file = fromYaml(SRC);
  const [choice, audit, jms] = file.routes[0].steps as any[];
  const vip = choice.branches[0].steps[0];
  const p = prepareRun(file, 'orders', { body: 'hello', headers: { vip: 'true' } });
  const result: RunResult = {
    ok: true,
    durationMs: 12,
    trace: [choice, vip, audit, jms].map((s, i) => ({ seq: i, nodeId: s.id, routeId: 'orders', label: s.type, atMs: i, tookMs: 1, body: 'hello', headers: {}, properties: {} })),
    output: { body: 'hello', headers: {} },
    mocks: [
      { uri: 'mock:https-crm-example-com-vip', count: 1, bodies: ['hello'] },
      { uri: 'mock:jms-queue-out', count: 1, bodies: ['hello'] },
    ],
    logs: [],
  };
  const c = coverage(file, [result], ['orders']);
  assert.equal(c.total, 5);
  assert.equal(c.covered, 4);
  assert.equal(c.uncoveredBranches.length, 1, 'otherwise branch not entered');
  const java = generateJUnitTest(file, 'orders', p, result, 'Orders');
  assert.match(java, /class OrdersRouteTest/);
  assert.match(java, /a\.replaceFromWith\("direct:cas-start"\)/);
  assert.match(java, /interceptSendToEndpoint\("jms:queue:out\*"\)\.skipSendToOriginalEndpoint\(\)\.to\("mock:jms-queue-out"\)/);
  assert.match(java, /requestBodyAndHeaders\("direct:cas-start", "hello", Map\.of\("vip", "true"\)\)/);
  assert.match(java, /mock2\.expectedBodiesReceived\("hello"\)/);
});

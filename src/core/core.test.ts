import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECIPES } from '../content/recipes';
import { importAny } from './importer';
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
        - kamelet:
            name: my-kamelet
`;
  const f = fromYaml(src);
  assert.equal(f.beans?.length, 1);
  assert.equal(f.routes[0].steps[0].type, 'unknown');
  const again = fromYaml(toYaml(f));
  assert.deepEqual(norm(again), norm(f));
  assert.match(toYaml(f), /kamelet:/);
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

const KITCHEN_SINK = `- onException:
    exception:
      - java.io.IOException
    handled:
      constant: "true"
    redeliveryPolicy:
      maximumRedeliveries: 4
      redeliveryDelay: 500
      useExponentialBackOff: true
      backOffMultiplier: 2
      maximumRedeliveryDelay: 10000
    steps:
      - log:
          message: failed
- rest:
    path: /api
    get:
      - path: /orders/{id}
        produces: application/json
        to: direct:get-order
    post:
      - path: /orders
        to: direct:create-order
- route:
    id: get-order
    from:
      uri: direct:get-order
      steps:
        - throttle:
            constant: "5"
            rejectExecution: true
        - circuitBreaker:
            steps:
              - to:
                  uri: http://inventory:8080/api?connectTimeout=1000
            onFallback:
              steps:
                - setBody:
                    constant: unavailable
        - enrich:
            constant: direct:customer
            aggregationStrategy: "#merge"
        - pollEnrich:
            constant: file:data/prices?noop=true
            timeout: 2000
        - recipientList:
            header: recipients
            delimiter: ";"
            parallelProcessing: true
        - routingSlip:
            header: slip
        - dynamicRouter:
            simple: \${bean:router?method=next}
        - threads:
            poolSize: 5
            maxPoolSize: 10
- route:
    id: create-order
    from:
      uri: direct:create-order
      steps:
        - log:
            message: created
`;

test('new EIPs, REST DSL and back-off round-trip via YAML and XML', () => {
  const m1 = fromYaml(KITCHEN_SINK);
  assert.equal(m1.rests?.length, 1);
  assert.equal(m1.rests![0].verbs.length, 2);
  assert.equal(m1.onExceptions[0].useExponentialBackOff, true);
  assert.deepEqual(norm(fromYaml(toYaml(m1))), norm(m1));
  assert.deepEqual(norm(fromXml(toXml(m1))), norm(m1));
  const errors = validate(m1).filter((i) => i.severity === 'error');
  assert.deepEqual(errors, []);
});

test('Java export of new EIPs and REST DSL', () => {
  const java = toJava(fromYaml(KITCHEN_SINK), 'Sink');
  assert.match(java, /rest\("\/api"\)/);
  assert.match(java, /\.get\("\/orders\/\{id\}"\)\.produces\("application\/json"\)\.to\("direct:get-order"\)/);
  assert.match(java, /\.circuitBreaker\(\)[\s\S]*\.onFallback\(\)[\s\S]*\.end\(\)/);
  assert.match(java, /\.useExponentialBackOff\(\)/);
  assert.match(java, /\.enrich\("direct:customer"\)\.aggregationStrategy\("merge"\)/);
  assert.match(java, /\.threads\(5, 10\)/);
  const starters = requiredStarters(fromYaml(KITCHEN_SINK), 'yaml');
  assert.ok(starters.includes('camel-resilience4j-starter'));
  assert.ok(starters.includes('camel-rest-starter'));
});

test('REST target without consuming route is flagged', () => {
  const f = fromYaml(KITCHEN_SINK);
  f.rests![0].verbs[0].to = 'direct:missing';
  assert.ok(validate(f).some((i) => i.rule === 'rest-target'));
});

test('contract-first: OpenAPI 3 → REST DSL + routes', () => {
  const { file, contract } = importAny('petstore.yaml', `openapi: 3.0.3
info:
  title: Orders API
servers:
  - url: https://api.example.com/v1
paths:
  /orders:
    get:
      operationId: listOrders
      responses:
        "200":
          content:
            application/json: {}
    post:
      operationId: createOrder
  /orders/{id}:
    get:
      summary: Get one order
`);
  assert.equal(contract, 'openapi');
  assert.equal(file.rests![0].path, '/v1');
  assert.deepEqual(file.rests![0].verbs.map((v) => `${v.method} ${v.path} ${v.to}`), ['get /orders direct:list-orders', 'get /orders/{id} direct:get-orders-id', 'post /orders direct:create-order']);
  assert.equal(file.routes.length, 3);
  assert.deepEqual(validate(file).filter((i) => i.severity === 'error'), []);
  assert.deepEqual(norm(fromYaml(toYaml(file))), norm(file));
});

test('contract-first: AsyncAPI 2 and 3', () => {
  const v2 = importAny('events.yaml', `asyncapi: 2.6.0
servers:
  prod:
    url: broker:9092
    protocol: kafka
channels:
  orders.created:
    publish: {}
  invoices.sent:
    subscribe: {}
`).file;
  assert.ok(v2.routes.some((r) => r.from.uri.startsWith('kafka:orders.created')));
  assert.ok(v2.routes.some((r) => r.routeId === 'send-invoices-sent'));
  const v3 = importAny('events.yaml', `asyncapi: 3.0.0
servers:
  prod:
    host: mq:1883
    protocol: mqtt
channels:
  temp:
    address: sensors/temperature
operations:
  onTemp:
    action: receive
    channel:
      $ref: '#/channels/temp'
`).file;
  assert.ok(v3.routes[0].from.uri.startsWith('paho-mqtt5:sensors/temperature'));
});

test('contract-first: WSDL → cxf route with operation choice', () => {
  const { file, contract } = importAny('orders.wsdl', `<?xml version="1.0"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" name="OrderService">
  <wsdl:portType name="OrderPort">
    <wsdl:operation name="GetOrder"/>
    <wsdl:operation name="CancelOrder"/>
  </wsdl:portType>
  <wsdl:service name="OrderService"/>
</wsdl:definitions>`);
  assert.equal(contract, 'wsdl');
  assert.match(file.routes[0].from.uri, /^cxf:\/OrderService\?wsdlURL=classpath:wsdl\/orders.wsdl/);
  const choice = file.routes[0].steps[0] as any;
  assert.equal(choice.branches.length, 3);
  assert.equal(file.routes.length, 3);
});

const BEANS_AND_CONFIG = `- beans:
    - name: orderService
      type: com.example.OrderService
      properties:
        retries: 3
        endpoint: http://orders
- routeConfiguration:
    id: shared-errors
    onException:
      - onException:
          exception:
            - java.lang.Exception
          handled:
            constant: "true"
          redeliveryPolicy:
            maximumRedeliveries: 2
          steps:
            - log:
                message: config handler
- route:
    id: order-saga
    routeConfigurationId: shared-errors
    from:
      uri: direct:order
      steps:
        - saga:
            propagation: REQUIRED
            timeout: 30000
            compensation:
              uri: direct:cancel
            completion:
              uri: direct:done
            steps:
              - to:
                  uri: direct:reserve
        - onCompletion:
            onFailureOnly: true
            steps:
              - log:
                  message: failed
`;

test('beans, routeConfiguration, saga and onCompletion round-trip', () => {
  const m1 = fromYaml(BEANS_AND_CONFIG);
  assert.equal(m1.beans?.[0].name, 'orderService');
  assert.deepEqual(m1.beans?.[0].properties, [['retries', '3'], ['endpoint', 'http://orders']]);
  assert.equal(m1.routeConfigurations?.[0].onExceptions.length, 1);
  assert.equal(m1.routes[0].routeConfigurationId, 'shared-errors');
  assert.deepEqual(norm(fromYaml(toYaml(m1))), norm(m1));
  const xml = toXml(m1);
  assert.match(xml, /^<camel xmlns/m);
  assert.deepEqual(norm(fromXml(xml)), norm(m1));
  const rules = validate(m1).map((i) => i.rule);
  assert.ok(!rules.includes('error-handler'), 'route with routeConfiguration counts as handled');
  assert.ok(rules.includes('saga-service'));
  const java = toJava(m1, 'Orders');
  assert.match(java, /\.saga\(\)\.propagation\(SagaPropagation\.REQUIRED\)\.timeout\(java\.time\.Duration\.ofMillis\(30000\)\)\.compensation\("direct:cancel"\)/);
  assert.match(java, /\.onCompletion\(\)\.onFailureOnly\(\)/);
  assert.match(java, /public static class SharedErrorsConfiguration extends RouteConfigurationBuilder/);
  assert.match(java, /routeConfiguration\("shared-errors"\)\.onException\(java\.lang\.Exception\.class\)/);
  assert.match(java, /\.routeConfigurationId\("shared-errors"\)/);
});

test('beans with nested properties are kept verbatim', () => {
  const f = fromYaml(`- beans:
    - name: ds
      type: org.example.DataSource
      properties:
        pool:
          size: 5
`);
  assert.equal(f.beans, undefined);
  assert.match(toYaml(f), /pool:/);
});

test('steps with expression languages the builder does not model are preserved', () => {
  const f = fromYaml(`- from:
    uri: direct:a
    steps:
      - setBody:
          jq: .order.id
`);
  assert.equal(f.routes[0].steps[0].type, 'unknown');
  assert.match(toYaml(f), /jq: \.order\.id/);
});

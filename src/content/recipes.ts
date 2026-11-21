/**
 * Knowledge Base recipes. Each example is plain Camel YAML DSL; the KB renders
 * the XML and Java variants from it through the same converters the builder uses.
 */
export interface Recipe {
  slug: string;
  title: string;
  category: 'EIP' | 'Reliability' | 'Transformation' | 'Messaging' | 'Files' | 'HTTP & API';
  tags: string[];
  summary: string;
  /** Paragraphs explaining the pattern. */
  body: string[];
  tips: string[];
  yaml: string;
}

export const RECIPES: Recipe[] = [
  {
    slug: 'content-based-router',
    title: 'Content-Based Router',
    category: 'EIP',
    tags: ['choice', 'routing'],
    summary: 'Route messages to different destinations based on their content.',
    body: [
      'The content-based router inspects each message and sends it to one of several destinations. In Camel it is the choice EIP: a list of when conditions evaluated in order, plus an optional otherwise branch.',
      'Conditions are predicates in any Camel language. Simple is enough for most cases; use JSONPath or XPath when you need to look deep into JSON or XML bodies.',
    ],
    tips: ['Always add an otherwise branch — unmatched messages are otherwise silently passed through.', 'Keep predicates cheap; they run for every message.'],
    yaml: `- route:
    id: order-router
    from:
      uri: direct:orders
      steps:
        - choice:
            when:
              - simple: \${header.priority} == 'high'
                steps:
                  - to:
                      uri: jms:queue:orders.priority
              - simple: \${header.country} != 'CZ'
                steps:
                  - to:
                      uri: jms:queue:orders.international
            otherwise:
              steps:
                - to:
                    uri: jms:queue:orders.standard
`,
  },
  {
    slug: 'retry-and-redelivery',
    title: 'Retry & redelivery',
    category: 'Reliability',
    tags: ['onException', 'error handling', 'redelivery'],
    summary: 'Retry failed calls with a delay before giving up.',
    body: [
      'Transient failures — a timeout, a 503, a dropped connection — usually succeed on a second attempt. onException with a redelivery policy retries only the failed step, not the whole route.',
      'Combine a maximum number of redeliveries with a delay so you do not hammer a struggling system.',
    ],
    tips: ['Retry only exceptions that are actually transient (IOException, timeouts) — never validation errors.', 'Mark the exception as handled when you route it somewhere safe afterwards.'],
    yaml: `- onException:
    exception:
      - java.io.IOException
    handled:
      constant: "true"
    redeliveryPolicy:
      maximumRedeliveries: 5
      redeliveryDelay: 2000
    steps:
      - log:
          message: "Giving up after retries: \${exception.message}"
          loggingLevel: ERROR
      - to:
          uri: jms:queue:orders.failed
- route:
    id: call-partner
    from:
      uri: direct:partner
      steps:
        - to:
            uri: https://partner.example.com/api/orders?connectTimeout=3000&responseTimeout=10000
`,
  },
  {
    slug: 'dead-letter-channel',
    title: 'Dead Letter Channel',
    category: 'Reliability',
    tags: ['onException', 'DLQ'],
    summary: 'Park messages that cannot be processed so nothing is lost.',
    body: [
      'A dead letter channel is a safe place for messages that failed even after retries. Instead of losing them, Camel moves them to a dedicated queue together with the error details.',
      'Operations can inspect the DLQ, fix the cause and replay the messages later.',
    ],
    tips: ['Store the exception message in a header before sending to the DLQ.', 'Monitor the DLQ depth — a growing queue is an incident.'],
    yaml: `- onException:
    exception:
      - java.lang.Exception
    handled:
      constant: "true"
    redeliveryPolicy:
      maximumRedeliveries: 3
      redeliveryDelay: 1000
    steps:
      - setHeader:
          name: errorMessage
          simple: \${exception.message}
      - to:
          uri: kafka:orders.dlq?brokers={{kafka.brokers}}
- route:
    id: process-orders
    from:
      uri: kafka:orders?brokers={{kafka.brokers}}&groupId=order-service
      steps:
        - unmarshal:
            json: {}
        - bean:
            ref: orderService
            method: process
`,
  },
  {
    slug: 'idempotent-consumer',
    title: 'Idempotent Consumer',
    category: 'Reliability',
    tags: ['duplicates', 'idempotency'],
    summary: 'Prevent duplicate message processing.',
    body: [
      'Most brokers deliver at least once, so duplicates will happen. The idempotent consumer remembers message ids it has already processed and skips repeats.',
      'Use a persistent repository (JDBC, Redis, Infinispan) in production; the in-memory one forgets everything on restart.',
    ],
    tips: ['Pick a business id (order number) rather than a technical one when possible.'],
    yaml: `- route:
    id: dedup-payments
    from:
      uri: jms:queue:payments
      steps:
        - idempotentConsumer:
            header: paymentId
            idempotentRepository: "#paymentRepository"
            steps:
              - to:
                  uri: direct:book-payment
`,
  },
  {
    slug: 'split-and-aggregate',
    title: 'Split & aggregate',
    category: 'EIP',
    tags: ['split', 'aggregate'],
    summary: 'Process items one by one and combine the results.',
    body: [
      'The splitter breaks a message — a JSON array, a CSV file, an XML document — into parts that are processed individually. The aggregator collects related messages back into one.',
      'Correlate parts with a header, and always define a completion condition: a size, a timeout or both.',
    ],
    tips: ['Use streaming for large files so the whole body is never in memory.', 'Parallel processing speeds things up but loses ordering.'],
    yaml: `- route:
    id: split-order-lines
    from:
      uri: direct:order
      steps:
        - split:
            jsonpath: $.lines[*]
            streaming: true
            steps:
              - to:
                  uri: direct:price-line
        - log:
            message: All lines processed
- route:
    id: collect-prices
    from:
      uri: seda:priced
      steps:
        - aggregate:
            correlationExpression:
              header: orderId
            aggregationStrategy: "#groupedBodyStrategy"
            completionSize: 50
            completionTimeout: 5000
            steps:
              - to:
                  uri: direct:invoice
`,
  },
  {
    slug: 'message-filter',
    title: 'Message Filter',
    category: 'EIP',
    tags: ['filter'],
    summary: 'Let only relevant messages continue.',
    body: ['The filter EIP evaluates a predicate and only passes matching messages to its inner steps. Non-matching messages continue after the filter untouched.'],
    tips: ['If non-matching messages should stop entirely, use a choice with a stop in otherwise.'],
    yaml: `- route:
    id: only-paid
    from:
      uri: kafka:invoices?brokers={{kafka.brokers}}
      steps:
        - filter:
            jsonpath: $[?(@.status == 'PAID')]
            steps:
              - to:
                  uri: direct:accounting
`,
  },
  {
    slug: 'wire-tap-audit',
    title: 'Wire Tap for auditing',
    category: 'Messaging',
    tags: ['wireTap', 'audit'],
    summary: 'Send a copy of every message to an audit log without slowing the main flow.',
    body: ['A wire tap sends a copy of the message to another endpoint asynchronously. The main route continues immediately, which makes it ideal for auditing and monitoring.'],
    tips: ['Do not change the body in the tapped route if it is shared — the copy is shallow.'],
    yaml: `- route:
    id: orders-with-audit
    from:
      uri: platform-http:/api/orders
      steps:
        - wireTap:
            uri: seda:audit
        - to:
            uri: direct:create-order
- route:
    id: audit
    from:
      uri: seda:audit
      steps:
        - to:
            uri: file:audit?fileName=\${date:now:yyyyMMdd}/\${exchangeId}.json
`,
  },
  {
    slug: 'file-to-kafka',
    title: 'Pick up files and publish to Kafka',
    category: 'Files',
    tags: ['file', 'kafka', 'csv'],
    summary: 'Poll a directory, split a CSV and publish each row.',
    body: ['A classic batch-to-streaming bridge: Camel polls a folder, parses each CSV file, splits it into rows and sends every row to a Kafka topic as JSON.'],
    tips: ['Use move=.done (or delete=true) so files are not processed twice.', 'Add include=.*\\.csv to ignore partial uploads with other extensions.'],
    yaml: `- route:
    id: csv-import
    from:
      uri: file:data/inbox?move=.done&include=.*\\.csv
      steps:
        - unmarshal:
            csv: {}
        - split:
            simple: \${body}
            streaming: true
            steps:
              - marshal:
                  json: {}
              - to:
                  uri: kafka:customers?brokers={{kafka.brokers}}
`,
  },
  {
    slug: 'rest-to-jms',
    title: 'Expose REST, process via JMS',
    category: 'HTTP & API',
    tags: ['platform-http', 'jms', 'json'],
    summary: 'Accept JSON over HTTP and hand it off to a queue.',
    body: ['Decouple a public API from back-end processing: the HTTP route validates and enqueues, a separate consumer does the heavy lifting at its own pace.'],
    tips: ['Return 202 Accepted with a correlation id so the client can poll for the result.'],
    yaml: `- route:
    id: orders-api
    from:
      uri: platform-http:/api/orders?httpMethodRestrict=POST
      steps:
        - setHeader:
            name: correlationId
            simple: \${exchangeId}
        - to:
            uri: jms:queue:orders.incoming
        - setHeader:
            name: CamelHttpResponseCode
            constant: "202"
        - setBody:
            simple: '{"correlationId":"\${header.correlationId}"}'
`,
  },
  {
    slug: 'xslt-saxon-transform',
    title: 'XML transformation with Saxon XSLT 3.0',
    category: 'Transformation',
    tags: ['xslt', 'saxon', 'xml'],
    summary: 'Transform XML with XSLT 3.0 and validate the result.',
    body: [
      'For anything beyond trivial mappings, XSLT is still the most robust way to transform XML. The xslt-saxon component brings XSLT 2.0/3.0 support.',
      'Validate the output against an XSD before sending it on — schema errors are much cheaper to catch here than at the partner.',
    ],
    tips: ['Keep stylesheets on the classpath and enable contentCache in production.'],
    yaml: `- route:
    id: order-to-partner
    from:
      uri: jms:queue:orders.xml
      steps:
        - to:
            uri: xslt-saxon:classpath:xslt/order-to-partner.xsl
        - to:
            uri: validator:classpath:xsd/partner-order.xsd
        - to:
            uri: sftp:sftp.partner.example.com/inbox?username={{partner.user}}&password={{partner.password}}
`,
  },
  {
    slug: 'try-catch-inside-route',
    title: 'Try / catch inside a route',
    category: 'Reliability',
    tags: ['doTry', 'doCatch'],
    summary: 'Handle an error locally without a global handler.',
    body: ['doTry works like try/catch in Java: steps inside the try block are protected and a matching doCatch handles the failure. doFinally always runs.'],
    tips: ['Prefer onException for cross-cutting policies; use doTry for local fallbacks.'],
    yaml: `- route:
    id: price-with-fallback
    from:
      uri: direct:price
      steps:
        - doTry:
            steps:
              - to:
                  uri: http://pricing:8080/api/price?connectTimeout=2000&responseTimeout=5000
            doCatch:
              - exception:
                  - java.io.IOException
                steps:
                  - log:
                      message: "Pricing unavailable, using cached price"
                      loggingLevel: WARN
                  - bean:
                      ref: priceCache
                      method: lookup
`,
  },
  {
    slug: 'timer-heartbeat',
    title: 'Scheduled heartbeat',
    category: 'Messaging',
    tags: ['timer', 'scheduling'],
    summary: 'Run something periodically — a health ping, a sync, a cleanup.',
    body: ['The timer component fires on a fixed interval. For calendar-based schedules use cron or quartz instead.'],
    tips: ['In a cluster, use quartz with a clustered job store (or a master route) so only one node fires.'],
    yaml: `- route:
    id: heartbeat
    from:
      uri: timer:heartbeat?period=60000
      steps:
        - setBody:
            simple: '{"service":"orders","time":"\${date:now:yyyy-MM-dd HH:mm:ss}"}'
        - to:
            uri: kafka:heartbeats?brokers={{kafka.brokers}}
`,
  },
  {
    slug: 'rest-api-dsl',
    title: 'REST API with the REST DSL',
    category: 'HTTP & API',
    tags: ['rest', 'platform-http', 'json'],
    summary: 'Expose HTTP operations and route each one to its own Camel route.',
    body: [
      'The REST DSL describes your HTTP API — paths, methods, content types — separately from the integration logic. Every operation hands the request to a route, usually through a direct: endpoint.',
      'Keeping the API surface in one place makes it easy to review, document and later generate from (or into) an OpenAPI contract.',
    ],
    tips: ['Set camel.rest.component=platform-http (the Spring Boot export does it for you).', 'Start from an OpenAPI file: import it on the Projects page and the REST DSL and routes are generated.'],
    yaml: `- rest:
    path: /api
    get:
      - path: /orders/{id}
        produces: application/json
        to: direct:get-order
    post:
      - path: /orders
        consumes: application/json
        to: direct:create-order
- route:
    id: get-order
    from:
      uri: direct:get-order
      steps:
        - to:
            uri: sql:select * from orders where id = :#\${header.id}?outputType=SelectOne
        - marshal:
            json: {}
- route:
    id: create-order
    from:
      uri: direct:create-order
      steps:
        - unmarshal:
            json: {}
        - to:
            uri: jms:queue:orders.incoming
        - setHeader:
            name: CamelHttpResponseCode
            constant: "202"
`,
  },
  {
    slug: 'circuit-breaker',
    title: 'Circuit breaker with fallback',
    category: 'Reliability',
    tags: ['circuitBreaker', 'resilience4j'],
    summary: 'Stop hammering a failing service and answer from a fallback instead.',
    body: [
      'When a downstream service is struggling, retries make it worse. A circuit breaker counts failures and, once a threshold is reached, opens the circuit: calls fail fast and the onFallback steps run instead.',
      'After a cool-down the breaker lets a few calls through to test whether the service has recovered.',
    ],
    tips: ['Tune thresholds with camel.resilience4j.* properties.', 'Combine with a timeout on the HTTP call — a slow service is as harmful as a failing one.'],
    yaml: `- route:
    id: price-with-breaker
    from:
      uri: direct:price
      steps:
        - circuitBreaker:
            steps:
              - to:
                  uri: http://pricing:8080/api/price?connectTimeout=1000&responseTimeout=3000
            onFallback:
              steps:
                - log:
                    message: Pricing circuit open, using default price
                    loggingLevel: WARN
                - setBody:
                    constant: '{"price":null,"source":"fallback"}'
`,
  },
  {
    slug: 'throttle-calls',
    title: 'Throttle calls to a partner',
    category: 'Reliability',
    tags: ['throttle', 'rate limit'],
    summary: 'Respect a partner’s rate limit by capping concurrent requests.',
    body: ['Partner APIs often allow only a few parallel calls. The throttle EIP limits how many exchanges pass at the same time, so bursts are smoothed out instead of rejected by the partner.'],
    tips: ['Use rejectExecution if you prefer failing fast over queueing.'],
    yaml: `- route:
    id: partner-throttled
    from:
      uri: seda:partner-calls?concurrentConsumers=20
      steps:
        - throttle:
            constant: "5"
        - to:
            uri: https://partner.example.com/api?connectTimeout=2000&responseTimeout=10000
`,
  },
  {
    slug: 'content-enricher',
    title: 'Content Enricher',
    category: 'EIP',
    tags: ['enrich', 'pollEnrich'],
    summary: 'Add data from another system to the message you are processing.',
    body: [
      'The content enricher calls another endpoint and merges its reply into the current message. enrich does a request/reply call; pollEnrich consumes a message (a file, a queue entry) instead.',
      'Without an aggregation strategy the reply replaces the body — usually you want a strategy that merges both.',
    ],
    tips: ['Use pollEnrich with a timeout, otherwise it may wait forever.'],
    yaml: `- route:
    id: enrich-order
    from:
      uri: jms:queue:orders
      steps:
        - setHeader:
            name: customerId
            jsonpath: $.customerId
        - enrich:
            constant: direct:customer-lookup
            aggregationStrategy: "#customerMerge"
        - pollEnrich:
            constant: file:data/discounts?noop=true&fileName=current.json
            timeout: 2000
            aggregationStrategy: "#discountMerge"
        - to:
            uri: direct:price-order
`,
  },
  {
    slug: 'recipient-list',
    title: 'Recipient List',
    category: 'EIP',
    tags: ['recipientList', 'dynamic routing'],
    summary: 'Send each message to a list of destinations decided at runtime.',
    body: ['Where a multicast has a fixed list of outputs, the recipient list computes it per message — from a header, a database lookup or a bean.'],
    tips: ['Enable parallelProcessing when the recipients are independent.'],
    yaml: `- route:
    id: notify-subscribers
    from:
      uri: kafka:events?brokers={{kafka.brokers}}
      steps:
        - setHeader:
            name: recipients
            simple: \${bean:subscriptions?method=endpointsFor(\${header.type})}
        - recipientList:
            header: recipients
            delimiter: ","
            parallelProcessing: true
`,
  },
  {
    slug: 'sftp-polling',
    title: 'Poll an SFTP server',
    category: 'Files',
    tags: ['sftp', 'file transfer'],
    summary: 'Download files from a partner SFTP and archive them locally.',
    body: ['File transfer is still the backbone of many B2B integrations. Camel polls the remote directory, downloads new files and moves them to an archive folder on the server so they are not picked up twice.'],
    tips: ['Never put the password in the URI — use {{placeholders}} or a private key.', 'Use readLock=changed on folders where the partner writes slowly.'],
    yaml: `- route:
    id: partner-sftp
    from:
      uri: sftp:sftp.partner.example.com:22/outbox?username={{partner.user}}&privateKeyFile={{partner.key}}&move=.archive&delay=60000
      steps:
        - log:
            message: Downloaded \${header.CamelFileName}
        - to:
            uri: file:data/inbox
`,
  },
  {
    slug: 'json-to-xml',
    title: 'JSON to XML',
    category: 'Transformation',
    tags: ['marshal', 'jackson', 'xml'],
    summary: 'Receive JSON, convert it to XML and send it to a legacy system.',
    body: ['Many legacy systems still speak XML. Unmarshal the JSON into a Java structure, then marshal it as XML — or use an XSLT for anything more than a 1:1 mapping.'],
    tips: ['For complex mappings, generate the target XML with XSLT 3.0 instead of relying on default bean mapping.'],
    yaml: `- route:
    id: json-to-legacy
    from:
      uri: platform-http:/api/legacy/orders?httpMethodRestrict=POST
      steps:
        - unmarshal:
            json: {}
        - marshal:
            jacksonXml: {}
        - to:
            uri: jms:queue:legacy.orders
`,
  },
  {
    slug: 'sql-to-kafka',
    title: 'Database changes to Kafka',
    category: 'Messaging',
    tags: ['sql', 'kafka', 'polling'],
    summary: 'Poll new rows from a table and publish them as events.',
    body: ['A simple outbox pattern: the application writes events into a table, Camel polls unprocessed rows, publishes them to Kafka and marks them as sent in the same transaction.'],
    tips: ['Use onConsume to flag rows as processed.', 'For high volumes prefer CDC (Debezium) over polling.'],
    yaml: `- route:
    id: outbox-publisher
    from:
      uri: sql:select * from outbox where sent = false order by id?onConsume=update outbox set sent = true where id = :#id&delay=5000
      steps:
        - marshal:
            json: {}
        - to:
            uri: kafka:outbox-events?brokers={{kafka.brokers}}
`,
  },
];

export const RECIPE_BY_SLUG: Record<string, Recipe> = Object.fromEntries(RECIPES.map((r) => [r.slug, r]));

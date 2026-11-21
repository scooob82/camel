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
];

export const RECIPE_BY_SLUG: Record<string, Recipe> = Object.fromEntries(RECIPES.map((r) => [r.slug, r]));

/**
 * Curated component catalog.
 *
 * MVP: a hand-picked subset with the most used options. The data shape mirrors
 * camel-catalog so it can later be replaced by a file generated from the
 * official catalog (see scripts/README in docs/ARCHITECTURE.md).
 */
export type ComponentCategory = 'Core' | 'Messaging' | 'Files' | 'HTTP & API' | 'Database' | 'Cloud' | 'Mail' | 'Transformation' | 'Scheduling' | 'Testing';

export interface ComponentOption {
  name: string;
  description: string;
  default?: string;
  enum?: string[];
}

export interface ComponentDef {
  scheme: string;
  /** Docs slug (camel.apache.org/components/next/<docs>-component.html). */
  docs: string;
  title: string;
  category: ComponentCategory;
  description: string;
  syntax: string;
  example: string;
  consumer: boolean;
  producer: boolean;
  /** Maven artifact of the Spring Boot starter. */
  starter: string;
  options: ComponentOption[];
}

const o = (name: string, description: string, def?: string, en?: string[]): ComponentOption => ({ name, description, default: def, enum: en });

export const COMPONENTS: ComponentDef[] = [
  { scheme: 'direct', docs: 'direct', title: 'Direct', category: 'Core', description: 'Synchronous call to another route in the same CamelContext.', syntax: 'direct:name', example: 'direct:orders', consumer: true, producer: true, starter: 'camel-direct-starter', options: [o('timeout', 'Producer timeout (ms) when no consumer is active', '30000')] },
  { scheme: 'seda', docs: 'seda', title: 'SEDA', category: 'Core', description: 'Asynchronous in-memory queue between routes.', syntax: 'seda:name', example: 'seda:work', consumer: true, producer: true, starter: 'camel-seda-starter', options: [o('concurrentConsumers', 'Number of concurrent consumers', '1'), o('size', 'Maximum queue capacity'), o('waitForTaskToComplete', 'Wait for async task', 'IfReplyExpected', ['Never', 'IfReplyExpected', 'Always'])] },
  { scheme: 'log', docs: 'log', title: 'Log', category: 'Core', description: 'Log message exchanges to the underlying logger.', syntax: 'log:loggerName', example: 'log:orders', consumer: false, producer: true, starter: 'camel-log-starter', options: [o('level', 'Logging level', 'INFO', ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'OFF']), o('showHeaders', 'Show headers', 'false'), o('showBody', 'Show body', 'true'), o('showAll', 'Show everything', 'false')] },
  { scheme: 'bean', docs: 'bean', title: 'Bean', category: 'Core', description: 'Invoke a method on a Java bean.', syntax: 'bean:beanName', example: 'bean:orderService', consumer: false, producer: true, starter: 'camel-bean-starter', options: [o('method', 'Method name to invoke')] },
  { scheme: 'kamelet', docs: 'kamelet', title: 'Kamelet', category: 'Core', description: 'Use a Kamelet route template as an endpoint.', syntax: 'kamelet:templateId', example: 'kamelet:http-sink', consumer: true, producer: true, starter: 'camel-kamelet-starter', options: [] },

  { scheme: 'timer', docs: 'timer', title: 'Timer', category: 'Scheduling', description: 'Generate messages at fixed intervals.', syntax: 'timer:name', example: 'timer:tick?period=5000', consumer: true, producer: false, starter: 'camel-timer-starter', options: [o('period', 'Interval in ms', '1000'), o('delay', 'Initial delay in ms', '1000'), o('repeatCount', 'Max number of fires (0 = forever)', '0'), o('fixedRate', 'Fixed-rate execution', 'false')] },
  { scheme: 'scheduler', docs: 'scheduler', title: 'Scheduler', category: 'Scheduling', description: 'Scheduled polling with a thread pool.', syntax: 'scheduler:name', example: 'scheduler:poll?delay=10000', consumer: true, producer: false, starter: 'camel-scheduler-starter', options: [o('delay', 'Delay between polls (ms)', '500'), o('initialDelay', 'Initial delay (ms)', '1000')] },
  { scheme: 'cron', docs: 'cron', title: 'Cron', category: 'Scheduling', description: 'Trigger by a cron expression.', syntax: 'cron:name', example: 'cron:nightly?schedule=0+0+2+*+*+?', consumer: true, producer: false, starter: 'camel-cron-starter', options: [o('schedule', 'Cron expression')] },
  { scheme: 'quartz', docs: 'quartz', title: 'Quartz', category: 'Scheduling', description: 'Quartz scheduler triggers (clustering supported).', syntax: 'quartz:groupName/timerName', example: 'quartz:reports/daily?cron=0+0+6+*+*+?', consumer: true, producer: false, starter: 'camel-quartz-starter', options: [o('cron', 'Cron expression'), o('triggerStartDelay', 'Start delay (ms)', '500')] },

  { scheme: 'kafka', docs: 'kafka', title: 'Kafka', category: 'Messaging', description: 'Send and receive messages from Apache Kafka.', syntax: 'kafka:topic', example: 'kafka:orders?brokers=localhost:9092', consumer: true, producer: true, starter: 'camel-kafka-starter', options: [o('brokers', 'Bootstrap servers'), o('groupId', 'Consumer group'), o('autoOffsetReset', 'Offset reset', 'latest', ['earliest', 'latest', 'none']), o('clientId', 'Client id'), o('maxPollRecords', 'Max records per poll', '500'), o('consumersCount', 'Number of consumers', '1')] },
  { scheme: 'jms', docs: 'jms', title: 'JMS', category: 'Messaging', description: 'Send and receive from a JMS queue or topic.', syntax: 'jms:destinationType:destinationName', example: 'jms:queue:orders', consumer: true, producer: true, starter: 'camel-jms-starter', options: [o('concurrentConsumers', 'Concurrent consumers', '1'), o('transacted', 'Transacted', 'false'), o('replyTo', 'Reply destination'), o('requestTimeout', 'Request/reply timeout (ms)', '20000'), o('deliveryPersistent', 'Persistent delivery', 'true')] },
  { scheme: 'amqp', docs: 'amqp', title: 'AMQP', category: 'Messaging', description: 'AMQP 1.0 messaging (Qpid JMS).', syntax: 'amqp:destinationType:destinationName', example: 'amqp:queue:orders', consumer: true, producer: true, starter: 'camel-amqp-starter', options: [o('concurrentConsumers', 'Concurrent consumers', '1'), o('transacted', 'Transacted', 'false')] },
  { scheme: 'spring-rabbitmq', docs: 'spring-rabbitmq', title: 'RabbitMQ (Spring)', category: 'Messaging', description: 'RabbitMQ via Spring AMQP.', syntax: 'spring-rabbitmq:exchangeName', example: 'spring-rabbitmq:orders?queues=orders.q', consumer: true, producer: true, starter: 'camel-spring-rabbitmq-starter', options: [o('queues', 'Queues to consume'), o('routingKey', 'Routing key'), o('autoDeclare', 'Declare exchange/queues', 'false')] },
  { scheme: 'paho-mqtt5', docs: 'paho-mqtt5', title: 'MQTT 5', category: 'Messaging', description: 'MQTT v5 messaging via Eclipse Paho.', syntax: 'paho-mqtt5:topic', example: 'paho-mqtt5:sensors/#?brokerUrl=tcp://localhost:1883', consumer: true, producer: true, starter: 'camel-paho-mqtt5-starter', options: [o('brokerUrl', 'Broker URL', 'tcp://localhost:1883'), o('qos', 'Quality of service', '2')] },
  { scheme: 'google-pubsub', docs: 'google-pubsub', title: 'Google Pub/Sub', category: 'Cloud', description: 'Google Cloud Pub/Sub topics and subscriptions.', syntax: 'google-pubsub:projectId:destinationName', example: 'google-pubsub:my-project:orders', consumer: true, producer: true, starter: 'camel-google-pubsub-starter', options: [o('serviceAccountKey', 'Service account key resource')] },

  { scheme: 'file', docs: 'file', title: 'File', category: 'Files', description: 'Read and write files on the file system.', syntax: 'file:directoryName', example: 'file:data/inbox?noop=true', consumer: true, producer: true, starter: 'camel-file-starter', options: [o('noop', 'Leave files in place', 'false'), o('delete', 'Delete after processing', 'false'), o('move', 'Move after processing'), o('include', 'Regex of files to include'), o('antInclude', 'Ant pattern of files to include'), o('fileName', 'File name (expression)'), o('recursive', 'Scan sub-directories', 'false'), o('delay', 'Poll delay (ms)', '500')] },
  { scheme: 'ftp', docs: 'ftp', title: 'FTP', category: 'Files', description: 'Upload and download files via FTP.', syntax: 'ftp:host:port/directoryName', example: 'ftp:ftp.example.com/inbox', consumer: true, producer: true, starter: 'camel-ftp-starter', options: [o('username', 'User name'), o('password', 'Password (use {{placeholder}})'), o('binary', 'Binary mode', 'false'), o('passiveMode', 'Passive mode', 'false'), o('noop', 'Leave files in place', 'false'), o('delete', 'Delete after download', 'false')] },
  { scheme: 'sftp', docs: 'sftp', title: 'SFTP', category: 'Files', description: 'Upload and download files via SFTP.', syntax: 'sftp:host:port/directoryName', example: 'sftp:sftp.example.com:22/inbox', consumer: true, producer: true, starter: 'camel-ftp-starter', options: [o('username', 'User name'), o('password', 'Password (use {{placeholder}})'), o('privateKeyFile', 'Private key file'), o('knownHostsFile', 'known_hosts file'), o('strictHostKeyChecking', 'Strict host key checking', 'no', ['yes', 'no']), o('delete', 'Delete after download', 'false')] },
  { scheme: 'aws2-s3', docs: 'aws2-s3', title: 'AWS S3', category: 'Cloud', description: 'Store and retrieve objects from Amazon S3.', syntax: 'aws2-s3:bucketNameOrArn', example: 'aws2-s3:my-bucket?region=eu-central-1', consumer: true, producer: true, starter: 'camel-aws2-s3-starter', options: [o('region', 'AWS region'), o('prefix', 'Key prefix'), o('deleteAfterRead', 'Delete after read', 'true'), o('useDefaultCredentialsProvider', 'Use default credentials chain', 'false')] },
  { scheme: 'aws2-sqs', docs: 'aws2-sqs', title: 'AWS SQS', category: 'Cloud', description: 'Send and receive from Amazon SQS.', syntax: 'aws2-sqs:queueNameOrArn', example: 'aws2-sqs:orders?region=eu-central-1', consumer: true, producer: true, starter: 'camel-aws2-sqs-starter', options: [o('region', 'AWS region'), o('deleteAfterRead', 'Delete after read', 'true'), o('waitTimeSeconds', 'Long polling wait (s)')] },
  { scheme: 'azure-storage-blob', docs: 'azure-storage-blob', title: 'Azure Blob Storage', category: 'Cloud', description: 'Store and retrieve blobs from Azure Storage.', syntax: 'azure-storage-blob:accountName/containerName', example: 'azure-storage-blob:myaccount/orders', consumer: true, producer: true, starter: 'camel-azure-storage-blob-starter', options: [o('blobName', 'Blob name'), o('operation', 'Producer operation', 'listBlobContainers')] },

  { scheme: 'http', docs: 'http', title: 'HTTP', category: 'HTTP & API', description: 'Call external HTTP/HTTPS services (Apache HttpClient 5).', syntax: 'http:httpUri', example: 'http://localhost:8080/api/orders', consumer: false, producer: true, starter: 'camel-http-starter', options: [o('httpMethod', 'HTTP method', undefined, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']), o('connectTimeout', 'Connect timeout (ms)'), o('connectionRequestTimeout', 'Connection pool timeout (ms)'), o('responseTimeout', 'Response timeout (ms)'), o('throwExceptionOnFailure', 'Throw on non-2xx', 'true'), o('bridgeEndpoint', 'Bridge (ignore Exchange.HTTP_URI)', 'false')] },
  { scheme: 'https', docs: 'http', title: 'HTTPS', category: 'HTTP & API', description: 'Call external HTTPS services (same component as HTTP).', syntax: 'https:httpUri', example: 'https://api.example.com/orders', consumer: false, producer: true, starter: 'camel-http-starter', options: [o('httpMethod', 'HTTP method', undefined, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']), o('connectTimeout', 'Connect timeout (ms)'), o('connectionRequestTimeout', 'Connection pool timeout (ms)'), o('responseTimeout', 'Response timeout (ms)'), o('throwExceptionOnFailure', 'Throw on non-2xx', 'true')] },
  { scheme: 'platform-http', docs: 'platform-http', title: 'Platform HTTP', category: 'HTTP & API', description: 'Expose HTTP endpoints using the runtime HTTP server.', syntax: 'platform-http:path', example: 'platform-http:/api/orders', consumer: true, producer: false, starter: 'camel-platform-http-starter', options: [o('httpMethodRestrict', 'Allowed methods (comma separated)'), o('consumes', 'Accepted content type'), o('produces', 'Produced content type')] },
  { scheme: 'rest', docs: 'rest', title: 'REST', category: 'HTTP & API', description: 'REST endpoint (consumer or producer).', syntax: 'rest:method:path:uriTemplate', example: 'rest:get:orders/{id}', consumer: true, producer: true, starter: 'camel-rest-starter', options: [o('consumes', 'Accepted content type'), o('produces', 'Produced content type'), o('host', 'Host for producer')] },
  { scheme: 'cxf', docs: 'cxf', title: 'CXF (SOAP)', category: 'HTTP & API', description: 'SOAP web services with Apache CXF.', syntax: 'cxf:beanId:address', example: 'cxf:bean:orderService', consumer: true, producer: true, starter: 'camel-cxf-soap-starter', options: [o('wsdlURL', 'WSDL location'), o('serviceClass', 'Service endpoint interface'), o('dataFormat', 'Data format', 'POJO', ['POJO', 'PAYLOAD', 'RAW', 'CXF_MESSAGE'])] },
  { scheme: 'graphql', docs: 'graphql', title: 'GraphQL', category: 'HTTP & API', description: 'Send GraphQL queries and mutations.', syntax: 'graphql:httpUri', example: 'graphql:https://api.example.com/graphql', consumer: false, producer: true, starter: 'camel-graphql-starter', options: [o('query', 'GraphQL query'), o('operationName', 'Operation name')] },
  { scheme: 'netty', docs: 'netty', title: 'Netty', category: 'HTTP & API', description: 'TCP/UDP sockets with Netty.', syntax: 'netty:protocol://host:port', example: 'netty:tcp://0.0.0.0:5150?textline=true', consumer: true, producer: true, starter: 'camel-netty-starter', options: [o('sync', 'Request/reply', 'true'), o('textline', 'Text line codec', 'false')] },

  { scheme: 'sql', docs: 'sql', title: 'SQL', category: 'Database', description: 'Run SQL queries using Spring JDBC.', syntax: 'sql:query', example: 'sql:select * from orders where status = :#status', consumer: true, producer: true, starter: 'camel-sql-starter', options: [o('dataSource', 'DataSource bean'), o('outputType', 'Output type', 'SelectList', ['SelectOne', 'SelectList', 'StreamList']), o('batch', 'Batch mode', 'false')] },
  { scheme: 'jdbc', docs: 'jdbc', title: 'JDBC', category: 'Database', description: 'Execute SQL from the message body.', syntax: 'jdbc:dataSourceName', example: 'jdbc:dataSource', consumer: false, producer: true, starter: 'camel-jdbc-starter', options: [o('outputType', 'Output type', 'SelectList', ['SelectOne', 'SelectList', 'StreamList'])] },
  { scheme: 'mongodb', docs: 'mongodb', title: 'MongoDB', category: 'Database', description: 'Read and write MongoDB documents.', syntax: 'mongodb:connectionBean', example: 'mongodb:mongo?database=shop&collection=orders&operation=insert', consumer: true, producer: true, starter: 'camel-mongodb-starter', options: [o('database', 'Database'), o('collection', 'Collection'), o('operation', 'Operation', undefined, ['findById', 'findOneByQuery', 'findAll', 'insert', 'save', 'update', 'remove', 'count'])] },
  { scheme: 'spring-redis', docs: 'spring-redis', title: 'Redis (Spring)', category: 'Database', description: 'Redis commands via Spring Data Redis.', syntax: 'spring-redis:host:port', example: 'spring-redis:localhost:6379?command=SET', consumer: true, producer: true, starter: 'camel-spring-redis-starter', options: [o('command', 'Redis command', 'SET'), o('channels', 'Pub/sub channels')] },

  { scheme: 'smtp', docs: 'mail', title: 'Mail (SMTP)', category: 'Mail', description: 'Send e-mails.', syntax: 'smtp:host:port', example: 'smtp:mail.example.com:587', consumer: false, producer: true, starter: 'camel-mail-starter', options: [o('to', 'Recipients'), o('from', 'Sender'), o('subject', 'Subject'), o('username', 'User name'), o('password', 'Password (use {{placeholder}})')] },
  { scheme: 'imap', docs: 'mail', title: 'Mail (IMAP)', category: 'Mail', description: 'Read e-mails from an IMAP mailbox.', syntax: 'imap:host:port', example: 'imap:mail.example.com:993', consumer: true, producer: false, starter: 'camel-mail-starter', options: [o('username', 'User name'), o('password', 'Password (use {{placeholder}})'), o('unseen', 'Only unseen', 'true'), o('delete', 'Delete after read', 'false'), o('folderName', 'Folder', 'INBOX')] },

  { scheme: 'xslt', docs: 'xslt', title: 'XSLT', category: 'Transformation', description: 'Transform XML with an XSLT template.', syntax: 'xslt:resourceUri', example: 'xslt:classpath:xslt/order.xsl', consumer: false, producer: true, starter: 'camel-xslt-starter', options: [o('contentCache', 'Cache the template', 'true'), o('output', 'Output type', 'string', ['string', 'bytes', 'DOM', 'file'])] },
  { scheme: 'xslt-saxon', docs: 'xslt-saxon', title: 'XSLT Saxon', category: 'Transformation', description: 'XSLT 2.0/3.0 transformations with Saxon.', syntax: 'xslt-saxon:resourceUri', example: 'xslt-saxon:classpath:xslt/order.xsl', consumer: false, producer: true, starter: 'camel-xslt-saxon-starter', options: [o('contentCache', 'Cache the template', 'true'), o('output', 'Output type', 'string', ['string', 'bytes', 'DOM', 'file'])] },
  { scheme: 'xquery', docs: 'xquery', title: 'XQuery', category: 'Transformation', description: 'Query and transform XML with XQuery (Saxon).', syntax: 'xquery:resourceUri', example: 'xquery:classpath:xquery/order.xq', consumer: true, producer: true, starter: 'camel-saxon-starter', options: [o('resultsFormat', 'Results format', 'DOM', ['Bytes', 'BytesSource', 'DOM', 'DOMSource', 'List', 'String', 'StringSource'])] },
  { scheme: 'validator', docs: 'validator', title: 'XML Validator', category: 'Transformation', description: 'Validate XML against an XSD.', syntax: 'validator:resourceUri', example: 'validator:classpath:xsd/order.xsd', consumer: false, producer: true, starter: 'camel-validator-starter', options: [o('failOnNullBody', 'Fail on empty body', 'true')] },

  { scheme: 'mock', docs: 'mock', title: 'Mock', category: 'Testing', description: 'Mock endpoint for unit tests.', syntax: 'mock:name', example: 'mock:result', consumer: false, producer: true, starter: 'camel-mock-starter', options: [] },
];

export const COMPONENT_BY_SCHEME: Record<string, ComponentDef> = Object.fromEntries(COMPONENTS.map((c) => [c.scheme, c]));

export const COMPONENT_CATEGORIES: ComponentCategory[] = ['Core', 'Messaging', 'Files', 'HTTP & API', 'Database', 'Cloud', 'Mail', 'Transformation', 'Scheduling', 'Testing'];

export function docsUrl(c: ComponentDef): string {
  return `https://camel.apache.org/components/next/${c.docs}-component.html`;
}

// ---------------------------------------------------------------- URIs

export interface ParsedUri {
  scheme: string;
  path: string;
  params: [string, string][];
}

/** Split an endpoint URI without URL-encoding (keeps {{placeholders}} and ${simple}). */
export function parseUri(uri: string): ParsedUri {
  const c = uri.indexOf(':');
  const scheme = c > 0 ? uri.slice(0, c) : uri;
  const rest = c > 0 ? uri.slice(c + 1) : '';
  const qi = rest.indexOf('?');
  const path = qi >= 0 ? rest.slice(0, qi) : rest;
  const query = qi >= 0 ? rest.slice(qi + 1) : '';
  const params: [string, string][] = query
    ? query
        .split('&')
        .filter(Boolean)
        .map((kv) => {
          const e = kv.indexOf('=');
          return e >= 0 ? [kv.slice(0, e), kv.slice(e + 1)] : [kv, ''];
        })
    : [];
  return { scheme, path, params };
}

export function buildUri(p: ParsedUri): string {
  const q = p.params.filter(([k]) => k).map(([k, v]) => `${k}=${v}`).join('&');
  return `${p.scheme}:${p.path}${q ? `?${q}` : ''}`;
}

export function setUriParam(uri: string, name: string, value: string): string {
  const p = parseUri(uri);
  const i = p.params.findIndex(([k]) => k === name);
  if (value === '') {
    if (i >= 0) p.params.splice(i, 1);
  } else if (i >= 0) p.params[i] = [name, value];
  else p.params.push([name, value]);
  return buildUri(p);
}

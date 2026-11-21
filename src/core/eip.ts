import { uid, type Branch, type KnownStep, type StepType } from './model';

export type EipCategory = 'Endpoints' | 'Routing' | 'Transformation' | 'Control' | 'Error handling';

export interface PropDef {
  name: string;
  label: string;
  kind: 'text' | 'number' | 'boolean' | 'select';
  required?: boolean;
  options?: string[];
  placeholder?: string;
  help?: string;
}

export interface EipDef {
  type: StepType;
  label: string;
  icon: string;
  category: EipCategory;
  summary: string;
  /** Step has a `uri` endpoint. */
  uri?: boolean;
  expression?: 'required' | 'optional';
  expressionLabel?: string;
  props: PropDef[];
  /** How children are organised. */
  container?: 'steps' | 'choice' | 'doTry';
  docs: string;
}

const docs = (slug: string) => `https://camel.apache.org/components/next/eips/${slug}.html`;

const bool = (name: string, label: string, help?: string): PropDef => ({ name, label, kind: 'boolean', help });

export const EIPS: EipDef[] = [
  // Endpoints
  { type: 'to', label: 'to', icon: '⇢', category: 'Endpoints', summary: 'Send the message to an endpoint.', uri: true, props: [], docs: docs('to-eip') },
  { type: 'toD', label: 'toD', icon: '⇝', category: 'Endpoints', summary: 'Send to a dynamic endpoint computed per message.', uri: true, props: [], docs: docs('toD-eip') },
  { type: 'wireTap', label: 'wireTap', icon: '⑃', category: 'Endpoints', summary: 'Send a copy of the message to an endpoint (fire and forget).', uri: true, props: [], docs: docs('wireTap-eip') },

  // Routing
  { type: 'choice', label: 'choice', icon: '◇', category: 'Routing', summary: 'Content-based router: route by conditions.', container: 'choice', props: [], docs: docs('choice-eip') },
  { type: 'filter', label: 'filter', icon: '◈', category: 'Routing', summary: 'Only continue with messages matching a predicate.', expression: 'required', expressionLabel: 'Predicate', container: 'steps', props: [], docs: docs('filter-eip') },
  {
    type: 'split', label: 'split', icon: '⑂', category: 'Routing', summary: 'Split a message into parts and process each.', expression: 'required', expressionLabel: 'Split by', container: 'steps',
    props: [bool('parallelProcessing', 'Parallel processing'), bool('streaming', 'Streaming', 'Process parts as they are produced, without loading all in memory.'), bool('stopOnException', 'Stop on exception')],
    docs: docs('split-eip'),
  },
  {
    type: 'aggregate', label: 'aggregate', icon: '⊞', category: 'Routing', summary: 'Combine related messages into one.', expression: 'required', expressionLabel: 'Correlation expression', container: 'steps',
    props: [
      { name: 'aggregationStrategy', label: 'Aggregation strategy (bean)', kind: 'text', required: true, placeholder: '#myStrategy' },
      { name: 'completionSize', label: 'Completion size', kind: 'number', placeholder: '10' },
      { name: 'completionTimeout', label: 'Completion timeout (ms)', kind: 'number', placeholder: '5000' },
    ],
    docs: docs('aggregate-eip'),
  },
  { type: 'multicast', label: 'multicast', icon: '⊕', category: 'Routing', summary: 'Send the same message to several steps.', container: 'steps', props: [bool('parallelProcessing', 'Parallel processing'), bool('stopOnException', 'Stop on exception')], docs: docs('multicast-eip') },
  { type: 'loop', label: 'loop', icon: '↻', category: 'Routing', summary: 'Repeat the inner steps N times.', expression: 'required', expressionLabel: 'Iterations', container: 'steps', props: [], docs: docs('loop-eip') },
  {
    type: 'idempotentConsumer', label: 'idempotentConsumer', icon: '⧉', category: 'Routing', summary: 'Skip duplicate messages.', expression: 'required', expressionLabel: 'Message id', container: 'steps',
    props: [{ name: 'idempotentRepository', label: 'Idempotent repository (bean)', kind: 'text', required: true, placeholder: '#myRepo' }],
    docs: docs('idempotentConsumer-eip'),
  },

  // Transformation
  { type: 'setBody', label: 'setBody', icon: 'ƒ', category: 'Transformation', summary: 'Replace the message body.', expression: 'required', props: [], docs: docs('setBody-eip') },
  { type: 'transform', label: 'transform', icon: '⇄', category: 'Transformation', summary: 'Transform the message body.', expression: 'required', props: [], docs: docs('transform-eip') },
  { type: 'setHeader', label: 'setHeader', icon: 'ℎ', category: 'Transformation', summary: 'Set a message header.', expression: 'required', props: [{ name: 'name', label: 'Header name', kind: 'text', required: true }], docs: docs('setHeader-eip') },
  { type: 'setProperty', label: 'setProperty', icon: 'ρ', category: 'Transformation', summary: 'Set an exchange property.', expression: 'required', props: [{ name: 'name', label: 'Property name', kind: 'text', required: true }], docs: docs('setProperty-eip') },
  { type: 'removeHeader', label: 'removeHeader', icon: '⌫', category: 'Transformation', summary: 'Remove a message header.', props: [{ name: 'name', label: 'Header name', kind: 'text', required: true }], docs: docs('removeHeader-eip') },
  { type: 'convertBodyTo', label: 'convertBodyTo', icon: '⇋', category: 'Transformation', summary: 'Convert the body to a Java type.', props: [{ name: 'type', label: 'Type', kind: 'text', required: true, placeholder: 'java.lang.String' }], docs: docs('convertBodyTo-eip') },
  { type: 'marshal', label: 'marshal', icon: '▤', category: 'Transformation', summary: 'Serialize the body with a data format.', props: [{ name: 'format', label: 'Data format', kind: 'select', required: true, options: ['json', 'jacksonXml', 'jaxb', 'csv', 'base64'] }], docs: docs('marshal-eip') },
  { type: 'unmarshal', label: 'unmarshal', icon: '▥', category: 'Transformation', summary: 'Parse the body with a data format.', props: [{ name: 'format', label: 'Data format', kind: 'select', required: true, options: ['json', 'jacksonXml', 'jaxb', 'csv', 'base64'] }], docs: docs('unmarshal-eip') },

  // Control
  { type: 'log', label: 'log', icon: '≡', category: 'Control', summary: 'Log a message.', props: [{ name: 'message', label: 'Message', kind: 'text', required: true, placeholder: '${body}' }, { name: 'loggingLevel', label: 'Level', kind: 'select', options: ['', 'TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR'] }, { name: 'logName', label: 'Logger name', kind: 'text' }], docs: docs('log-eip') },
  { type: 'bean', label: 'bean', icon: '☕', category: 'Control', summary: 'Call a method on a bean.', props: [{ name: 'ref', label: 'Bean', kind: 'text', required: true, placeholder: 'orderService' }, { name: 'method', label: 'Method', kind: 'text' }], docs: docs('bean-eip') },
  { type: 'process', label: 'process', icon: '⚙', category: 'Control', summary: 'Call a custom Processor bean.', props: [{ name: 'ref', label: 'Processor bean', kind: 'text', required: true }], docs: docs('process-eip') },
  { type: 'delay', label: 'delay', icon: '⏱', category: 'Control', summary: 'Delay processing (ms).', expression: 'required', expressionLabel: 'Delay (ms)', props: [], docs: docs('delay-eip') },
  { type: 'transacted', label: 'transacted', icon: '⛁', category: 'Control', summary: 'Run the rest of the route in a transaction.', props: [], docs: docs('transactional-client') },
  { type: 'stop', label: 'stop', icon: '■', category: 'Control', summary: 'Stop routing the current message.', props: [], docs: docs('stop-eip') },

  // Error handling
  { type: 'doTry', label: 'doTry / doCatch', icon: '⚑', category: 'Error handling', summary: 'Try/catch/finally block inside a route.', container: 'doTry', props: [], docs: docs('doTry') },
];

export const EIP_BY_TYPE: Record<string, EipDef> = Object.fromEntries(EIPS.map((d) => [d.type, d]));

export const EIP_CATEGORIES: EipCategory[] = ['Endpoints', 'Routing', 'Transformation', 'Control', 'Error handling'];

export function newBranch(kind: Branch['kind']): Branch {
  const b: Branch = { id: uid('b'), kind, steps: [] };
  if (kind === 'when') b.expression = { language: 'simple', expression: '${body} != null' };
  if (kind === 'doCatch') b.exceptions = ['java.lang.Exception'];
  return b;
}

/** Create a new step with sensible defaults. */
export function newStep(type: StepType, uri?: string): KnownStep {
  const def = EIP_BY_TYPE[type];
  const step: KnownStep = { id: uid('s'), type, props: {} };
  if (def?.uri) step.props.uri = uri ?? 'log:out';
  if (def?.expression) {
    const defaults: Partial<Record<StepType, string>> = {
      setBody: '${body}',
      transform: '${body}',
      setHeader: 'value',
      setProperty: 'value',
      filter: '${header.type} == "order"',
      split: '${body}',
      aggregate: '${header.correlationId}',
      loop: '3',
      idempotentConsumer: '${header.messageId}',
      delay: '1000',
    };
    const constantTypes: StepType[] = ['loop', 'delay', 'setHeader', 'setProperty'];
    step.expression = { language: constantTypes.includes(type) ? 'constant' : 'simple', expression: defaults[type] ?? '' };
  }
  switch (type) {
    case 'log':
      step.props.message = '${body}';
      break;
    case 'setHeader':
    case 'setProperty':
    case 'removeHeader':
      step.props.name = 'myHeader';
      break;
    case 'convertBodyTo':
      step.props.type = 'java.lang.String';
      break;
    case 'marshal':
    case 'unmarshal':
      step.props.format = 'json';
      break;
    case 'aggregate':
      step.props.aggregationStrategy = '#myStrategy';
      step.props.completionSize = '10';
      break;
    case 'idempotentConsumer':
      step.props.idempotentRepository = '#myRepo';
      break;
    case 'bean':
      step.props.ref = 'myBean';
      break;
    case 'process':
      step.props.ref = 'myProcessor';
      break;
  }
  if (def?.container === 'steps') step.steps = [];
  if (def?.container === 'choice') step.branches = [newBranch('when'), newBranch('otherwise')];
  if (def?.container === 'doTry') {
    step.steps = [];
    step.branches = [newBranch('doCatch')];
  }
  return step;
}
